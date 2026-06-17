import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type FaqItem } from "@prisma/client";
import { EmbeddingService } from "../../llm/embedding.service";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import { buildCsv, CsvCell } from "../analytics/csv.util";
import { CreateFaqDto, FaqListQueryDto, UpdateFaqDto } from "./dto/faq.dto";
import { AdminService } from "./admin.service";

/**
 * 后台 FAQ 服务。
 * 关键:FaqItem.embedding 是 pgvector 字段,RAG 召回靠它做余弦相似度;
 * create / update 时必须同步算 embedding 并写库,否则新建的 FAQ 永远召回不到。
 */
@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly embed: EmbeddingService,
  ) {}

  /**
   * 把 question 算成 pgvector 字面量(形如 "[0.1,0.2,...]")。
   * 失败时返回 null — 不阻塞主流程;管理员在 UI 重新编辑会再次触发重算。
   * 没 embedding 的 FaqItem 会被 FaqRecallService 跳过(该 SQL 里有
   * "embedding IS NOT NULL" 过滤),等于临时屏蔽,符合预期。
   */
  private async computeFaqEmbedding(
    question: string,
  ): Promise<string | null> {
    try {
      const res = await this.embed.embed([question]);
      const vec = res.items[0]?.embedding;
      if (!vec || vec.length === 0) return null;
      return `[${vec.join(",")}]`;
    } catch (err) {
      this.logger.warn(
        `FAQ embedding failed (id will be saved without embedding): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 用 $executeRaw 把向量字面量写回 FaqItem.embedding。
   * schema 里 FaqItem.embedding 是 Unsupported("vector(1024)"),
   * 普通 create/update 不支持直接传值,沿用 DocumentIngestProcessor 的 raw SQL 模式。
   */
  private async writeFaqEmbedding(
    id: string,
    vecLiteral: string,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "FaqItem"
        SET embedding = ${vecLiteral}::vector
        WHERE id = ${id}
      `;
    } catch (err) {
      this.logger.warn(
        `FAQ embedding write failed for id=${id}: ${(err as Error).message}`,
      );
    }
  }

  async list(query: FaqListQueryDto): Promise<PaginatedResult<FaqItem>> {
    const where: Prisma.FaqItemWhereInput = {};
    if (typeof query.isActive === "boolean") where.isActive = query.isActive;
    if (query.category) where.category = query.category;
    if (query.keyword && query.keyword.trim()) {
      where.question = { contains: query.keyword.trim(), mode: "insensitive" };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.faqItem.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.faqItem.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findById(id: string): Promise<FaqItem> {
    const found = await this.prisma.faqItem.findUnique({ where: { id } });
    if (!found) {
      throw new BusinessException(
        ErrorCode.FAQ_NOT_FOUND,
        `FAQ not found: ${id}`,
      );
    }
    return found;
  }

  /**
   * 公共检索(家长端 /faqs):按 keyword 对 question/answer 做大小写不敏感模糊匹配。
   * 限制:只返回 isActive=true 的,只暴露 id/question/answer/category/hitCount/updatedAt
   * (embedding 字段是 vector(1024),无序列化意义)。
   * 真正的"语义召回"由 RAG FaqRecallService 在 /chat/stream 里走,
   * 这里是给前端做一个公开浏览/搜索的入口。
   */
  async publicSearch(
    keyword: string | undefined,
    limit: number,
  ): Promise<
    Pick<
      FaqItem,
      "id" | "question" | "answer" | "category" | "hitCount" | "updatedAt"
    >[]
  > {
    const where: Prisma.FaqItemWhereInput = { isActive: true };
    if (keyword && keyword.trim()) {
      const kw = keyword.trim();
      where.OR = [
        { question: { contains: kw, mode: "insensitive" } },
        { answer: { contains: kw, mode: "insensitive" } },
      ];
    }
    return this.prisma.faqItem.findMany({
      where,
      orderBy: [{ hitCount: "desc" }, { updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        hitCount: true,
        updatedAt: true,
      },
    });
  }

  async create(
    input: CreateFaqDto,
    user: JwtUser | undefined,
  ): Promise<FaqItem> {
    const created = await this.prisma.faqItem.create({
      data: {
        question: input.question,
        answer: input.answer,
        category: input.category,
        isActive: input.isActive ?? true,
      },
    });
    // 同步算 embedding(失败不阻塞保存,管理员可重编辑触发重算)
    const vec = await this.computeFaqEmbedding(input.question);
    if (vec) await this.writeFaqEmbedding(created.id, vec);
    await this.admin.recordAction({
      user,
      action: "faq.create",
      resource: "faq",
      resourceId: created.id,
      payload: { question: input.question, category: input.category },
    });
    return this.findById(created.id);
  }

  async update(
    id: string,
    input: UpdateFaqDto,
    user: JwtUser | undefined,
  ): Promise<FaqItem> {
    await this.findById(id);
    const updated = await this.prisma.faqItem.update({
      where: { id },
      data: {
        ...(input.question !== undefined && { question: input.question }),
        ...(input.answer !== undefined && { answer: input.answer }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    // question 变了 → 重新算 embedding
    if (
      typeof input.question === "string" &&
      input.question.trim().length > 0
    ) {
      const vec = await this.computeFaqEmbedding(input.question);
      if (vec) await this.writeFaqEmbedding(id, vec);
    }
    await this.admin.recordAction({
      user,
      action: "faq.update",
      resource: "faq",
      resourceId: id,
      payload: { changes: input },
    });
    return updated;
  }

  async remove(id: string, user: JwtUser | undefined): Promise<{ id: string }> {
    const existing = await this.findById(id);
    await this.prisma.faqItem.delete({ where: { id } });
    await this.admin.recordAction({
      user,
      action: "faq.delete",
      resource: "faq",
      resourceId: existing.id,
      payload: { question: existing.question },
    });
    return { id };
  }

  async exportCsv(query: FaqListQueryDto): Promise<string> {
    const where: Prisma.FaqItemWhereInput = {};
    if (typeof query.isActive === "boolean") where.isActive = query.isActive;
    if (query.category) where.category = query.category;
    if (query.keyword && query.keyword.trim()) {
      where.question = { contains: query.keyword.trim(), mode: "insensitive" };
    }

    const items = await this.prisma.faqItem.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    });

    const header = [
      "id", "question", "answer", "category", "isActive",
      "hitCount", "aliases", "keywords", "createdAt", "updatedAt",
    ];
    const rows: CsvCell[][] = items.map((f) => [
      f.id,
      f.question,
      f.answer,
      f.category ?? "",
      f.isActive,
      f.hitCount,
      Array.isArray(f.aliases) ? f.aliases.join("|") : "",
      Array.isArray(f.keywords) ? f.keywords.join("|") : "",
      f.createdAt,
      f.updatedAt,
    ]);
    return buildCsv(header, rows);
  }
}
