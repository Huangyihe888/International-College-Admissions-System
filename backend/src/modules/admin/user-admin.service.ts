import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { Prisma, type User } from "@prisma/client";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import {
  CreateUserDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./dto/user-admin.dto";
import { AdminService } from "./admin.service";

export type UserWithRole = Omit<User, "passwordHash"> & {
  role: { id: string; name: string };
};

/**
 * 显式 select 字段,避免 passwordHash 泄露。
 * (Prisma `omit` 需 previewFeatures.omitApi,本项目未启用,走 select 更稳。)
 */
const USER_SAFE_SELECT = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  roleId: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const USER_ROLE_SELECT = { id: true, name: true } as const;

@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  async list(query: UserListQueryDto): Promise<PaginatedResult<UserWithRole>> {
    const where: Prisma.UserWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.roleName) where.role = { name: query.roleName };
    if (query.keyword && query.keyword.trim()) {
      const kw = query.keyword.trim();
      where.OR = [
        { username: { contains: kw, mode: "insensitive" } },
        { displayName: { contains: kw, mode: "insensitive" } },
        { email: { contains: kw, mode: "insensitive" } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          ...USER_SAFE_SELECT,
          role: { select: USER_ROLE_SELECT },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findById(id: string): Promise<UserWithRole> {
    const found = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SAFE_SELECT,
        role: { select: USER_ROLE_SELECT },
      },
    });
    if (!found) {
      throw new BusinessException(ErrorCode.NOT_FOUND, `User not found: ${id}`);
    }
    return found;
  }

  async resolveRoleId(roleName: string): Promise<string> {
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      select: { id: true },
    });
    if (!role) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Role not found by name: ${roleName}`,
      );
    }
    return role.id;
  }

  async create(
    input: CreateUserDto,
    user: JwtUser | undefined,
  ): Promise<UserWithRole> {
    const roleId = await this.resolveRoleId(input.roleName);
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    let created: UserWithRole;
    try {
      created = await this.prisma.user.create({
        data: {
          username: input.username,
          passwordHash,
          displayName: input.displayName,
          email: input.email,
          roleId,
          status: "ACTIVE",
        },
        select: {
          ...USER_SAFE_SELECT,
          role: { select: USER_ROLE_SELECT },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const target =
          (err.meta?.target as string[] | undefined)?.join(",") || "field";
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `User ${target} already exists: ${input.username}`,
        );
      }
      throw err;
    }
    await this.admin.recordAction({
      user,
      action: "user.create",
      resource: "user",
      resourceId: created.id,
      payload: { username: input.username, roleName: input.roleName },
    });
    return created;
  }

  async update(
    id: string,
    input: UpdateUserDto,
    user: JwtUser | undefined,
  ): Promise<UserWithRole> {
    const existing = await this.findById(id);
    const data: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.email !== undefined) data.email = input.email;
    if (input.status !== undefined) data.status = input.status;
    if (input.roleName !== undefined) {
      data.role = { connect: { id: await this.resolveRoleId(input.roleName) } };
    }

    let updated: UserWithRole;
    try {
      updated = await this.prisma.user.update({
        where: { id },
        data,
        select: {
          ...USER_SAFE_SELECT,
          role: { select: USER_ROLE_SELECT },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `User email already exists: ${input.email}`,
        );
      }
      throw err;
    }
    await this.admin.recordAction({
      user,
      action: "user.update",
      resource: "user",
      resourceId: id,
      payload: { changes: input, beforeRole: existing.role.name },
    });
    return updated;
  }

  async resetPassword(
    id: string,
    newPassword: string,
    user: JwtUser | undefined,
  ): Promise<{ id: string }> {
    await this.findById(id);
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
    await this.admin.recordAction({
      user,
      action: "user.reset-password",
      resource: "user",
      resourceId: id,
    });
    return { id };
  }
}
