import { Injectable } from "@nestjs/common";
import { Prisma, type ForbiddenRule } from "@prisma/client";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import {
  CreateForbiddenRuleDto,
  ForbiddenRuleListQueryDto,
  UpdateForbiddenRuleDto,
} from "./dto/forbidden-rule.dto";
import { AdminService } from "./admin.service";

@Injectable()
export class ForbiddenRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  async list(
    query: ForbiddenRuleListQueryDto,
  ): Promise<PaginatedResult<ForbiddenRule>> {
    const where: Prisma.ForbiddenRuleWhereInput = {};
    if (typeof query.isActive === "boolean") where.isActive = query.isActive;
    if (query.ruleType) where.ruleType = query.ruleType;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.forbiddenRule.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.forbiddenRule.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findById(id: string): Promise<ForbiddenRule> {
    const found = await this.prisma.forbiddenRule.findUnique({ where: { id } });
    if (!found) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Forbidden rule not found: ${id}`,
      );
    }
    return found;
  }

  async create(
    input: CreateForbiddenRuleDto,
    user: JwtUser | undefined,
  ): Promise<ForbiddenRule> {
    const created = await this.prisma.forbiddenRule.create({
      data: {
        name: input.name,
        pattern: input.pattern,
        ruleType: input.ruleType,
        reply: input.reply,
        isActive: input.isActive ?? true,
      },
    });
    await this.admin.recordAction({
      user,
      action: "forbidden-rule.create",
      resource: "forbidden-rule",
      resourceId: created.id,
      payload: { name: input.name, ruleType: input.ruleType },
    });
    return created;
  }

  async update(
    id: string,
    input: UpdateForbiddenRuleDto,
    user: JwtUser | undefined,
  ): Promise<ForbiddenRule> {
    await this.findById(id);
    const updated = await this.prisma.forbiddenRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.pattern !== undefined && { pattern: input.pattern }),
        ...(input.ruleType !== undefined && { ruleType: input.ruleType }),
        ...(input.reply !== undefined && { reply: input.reply }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    await this.admin.recordAction({
      user,
      action: "forbidden-rule.update",
      resource: "forbidden-rule",
      resourceId: id,
      payload: { changes: input },
    });
    return updated;
  }

  async remove(id: string, user: JwtUser | undefined): Promise<{ id: string }> {
    const existing = await this.findById(id);
    await this.prisma.forbiddenRule.delete({ where: { id } });
    await this.admin.recordAction({
      user,
      action: "forbidden-rule.delete",
      resource: "forbidden-rule",
      resourceId: id,
      payload: { name: existing.name },
    });
    return { id };
  }
}
