import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type FaqItem } from "@prisma/client";
import { EmbeddingService } from "../../llm/embedding.service";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import {
  AnswerLowConfidenceDto,
  LowConfidenceListQueryDto,
} from "./dto/low-confidence.dto";
import { AdminService } from "./admin.service";

/**
 * 低置信度判定阈值:confidence < 该值视为"低置信度"。
 * 与 AnalyticsService 的 LOW_CONFIDENCE_THRESHOLD 保持一致;主会话可抽到 config 统一管理。
 */
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5;

export interface LowConfidenceRow {
  id: string;
  sessionId: string | null;
  query: string;
  rewrittenQuery: string | null;
  isAnswered: boolean;
  faqHit: boolean;
  confidence: number | null;
  rejectReason: string | null;
  llmProvider: string;
  createdAt: Date;
}

@Injectable()
export class LowConfidenceService {
  private readonly logger = new Logger(LowConfidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly embed: EmbeddingService,
  ) {}

  /**
   * 列出低置信度 RagLog。判定条件:
   *  - confidence 不为 NULL 且 < threshold(默认 0.5)
   *  - 客户端可显式覆盖 threshold
   *  - 默认同时过滤 isAnswered=false(LLM 没答好的);客户端可通过 isAnswered 显式覆盖
   */
  async list(
    query: LowConfidenceListQueryDto,
  ): Promise<PaginatedResult<LowConfidenceRow>> {
    const threshold = query.threshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
    const where: Prisma.RagLogWhereInput = {
      confidence: { lt: threshold, not: null },
    };
    if (typeof query.isAnswered === "boolean") {
      where.isAnswered = query.isAnswered;
    } else {
      where.isAnswered = false;
    }
    if (query.keyword && query.keyword.trim()) {
      where.query = { contains: query.keyword.trim(), mode: "insensitive" };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ragLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          sessionId: true,
          query: true,
          rewrittenQuery: true,
          isAnswered: true,
          faqHit: true,
          confidence: true,
          rejectReason: true,
          llmProvider: true,
          createdAt: true,
        },
      }),
      this.prisma.ragLog.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  /**
   * 人工补答:把 ragLog 的 query 作为新 FaqItem 的 question,
   * 入参的 answer 作为 answer,可选 category。
   * 关键:写入新 FaqItem 后必须算 embedding 并写库,否则这条 FAQ 永远不会被 RAG 召回。
   * 返回 { ragLog, faqItem }。
   */
  async answer(
    id: string,
    input: AnswerLowConfidenceDto,
    user: JwtUser | undefined,
  ): Promise<{ ragLog: { id: string; query: string }; faqItem: FaqItem }> {
    const ragLog = await this.prisma.ragLog.findUnique({
      where: { id },
      select: { id: true, query: true, confidence: true },
    });
    if (!ragLog) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `RagLog not found: ${id}`,
      );
    }

    const faqItem = await this.prisma.faqItem.create({
      data: {
        question: ragLog.query,
        answer: input.answer,
        category: input.category,
        isActive: true,
      },
    });

    // 同步算 embedding(失败不阻塞,FaqItem 没 embedding 等于暂时不召回,符合预期)
    try {
      const res = await this.embed.embed([ragLog.query]);
      const vec = res.items[0]?.embedding;
      if (vec && vec.length > 0) {
        const literal = `[${vec.join(",")}]`;
        await this.prisma.$executeRaw`
          UPDATE "FaqItem"
          SET embedding = ${literal}::vector
          WHERE id = ${faqItem.id}
        `;
      }
    } catch (err) {
      this.logger.warn(
        `Low-confidence FAQ embedding failed (id=${faqItem.id}): ${(err as Error).message}`,
      );
    }

    await this.admin.recordAction({
      user,
      action: "low-confidence.answer",
      resource: "rag-log",
      resourceId: id,
      payload: {
        faqId: faqItem.id,
        question: ragLog.query,
        category: input.category,
      },
    });

    return {
      ragLog: { id: ragLog.id, query: ragLog.query },
      faqItem,
    };
  }
}
