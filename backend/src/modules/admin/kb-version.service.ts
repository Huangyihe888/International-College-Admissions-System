import { Injectable } from "@nestjs/common";
import { Prisma, type KnowledgeBaseVersion } from "@prisma/client";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import {
  CreateKbVersionDto,
  KbVersionListQueryDto,
} from "./dto/kb-version.dto";
import { AdminService } from "./admin.service";

@Injectable()
export class KbVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  async list(
    query: KbVersionListQueryDto,
  ): Promise<PaginatedResult<KnowledgeBaseVersion>> {
    const where: Prisma.KnowledgeBaseVersionWhereInput = {};
    if (typeof query.isActive === "boolean") where.isActive = query.isActive;
    if (query.keyword && query.keyword.trim()) {
      where.version = { contains: query.keyword.trim(), mode: "insensitive" };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.knowledgeBaseVersion.findMany({
        where,
        orderBy: [
          { isActive: "desc" },
          { activatedAt: "desc" },
          { createdAt: "desc" },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.knowledgeBaseVersion.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async create(
    input: CreateKbVersionDto,
    user: JwtUser | undefined,
  ): Promise<KnowledgeBaseVersion> {
    // 若要求 isActive=true,需要在事务里把其它 active 全部 deactivate 后再激活
    const wantsActive = input.isActive === true;
    const created = await this.prisma.$transaction(async (tx) => {
      if (wantsActive) {
        await tx.knowledgeBaseVersion.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      try {
        return await tx.knowledgeBaseVersion.create({
          data: {
            version: input.version,
            description: input.description,
            isActive: wantsActive,
            activatedAt: wantsActive ? new Date() : null,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new BusinessException(
            ErrorCode.CONFLICT,
            `Knowledge base version already exists: ${input.version}`,
          );
        }
        throw err;
      }
    });

    await this.admin.recordAction({
      user,
      action: "kb-version.create",
      resource: "kb-version",
      resourceId: created.id,
      payload: { version: input.version, isActive: created.isActive },
    });
    return created;
  }

  /**
   * 事务里先 deactivate 全部 active,再 activate 目标。
   * - target 已是 active → 抛 KB_VERSION_ALREADY_ACTIVE(3102),由调用方决定是否重置后重试
   * - target 不存在 → 抛 KB_VERSION_NOT_FOUND(3101)
   * - 全部动作在单个 $transaction 里,避免双激活 / 漏激活竞态
   */
  async activate(
    id: string,
    user: JwtUser | undefined,
  ): Promise<KnowledgeBaseVersion> {
    const result = await this.prisma.$transaction(async (tx) => {
      const target = await tx.knowledgeBaseVersion.findUnique({
        where: { id },
      });
      if (!target) {
        throw new BusinessException(
          ErrorCode.KB_VERSION_NOT_FOUND,
          `Knowledge base version not found: ${id}`,
        );
      }
      if (target.isActive) {
        throw new BusinessException(
          ErrorCode.KB_VERSION_ALREADY_ACTIVE,
          `Knowledge base version is already active: ${target.version}`,
        );
      }
      await tx.knowledgeBaseVersion.updateMany({
        where: { isActive: true, NOT: { id } },
        data: { isActive: false },
      });
      return tx.knowledgeBaseVersion.update({
        where: { id },
        data: { isActive: true, activatedAt: new Date() },
      });
    });

    await this.admin.recordAction({
      user,
      action: "kb-version.activate",
      resource: "kb-version",
      resourceId: id,
      payload: { version: result.version },
    });
    return result;
  }
}
