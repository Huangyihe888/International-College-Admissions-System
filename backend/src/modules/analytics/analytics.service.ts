import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { PrismaService } from "../../database/prisma.service";
import {
  AnalyticsQueryDto,
  TopQuestionsQueryDto,
} from "./dto/analytics-query.dto";
import { AnalyticsGranularity, AnalyticsRange } from "./dto/overview-query.dto";
import { resolveRange, startOfDay } from "./date.util";
import { buildCsv, CsvCell } from "./csv.util";

/**
 * 低置信度判定阈值。confidence < 该值视为"低置信度"。
 * TODO: 与 RAG 拒答阈值联动,后续从 config 读,目前硬编码。
 */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export interface RagLogRow {
  id: string;
  sessionId: string | null;
  query: string;
  rewrittenQuery: string | null;
  faqHit: boolean;
  confidence: number | null;
  isAnswered: boolean;
  rejectReason: string | null;
  latencyMs: number;
  llmProvider: string;
  createdAt: Date;
}

export interface FeedbackRow {
  id: string;
  messageId: string;
  rating: "UP" | "DOWN";
  comment: string | null;
  createdAt: Date;
  message?: {
    id: string;
    content: string;
    role: string;
    sessionId: string;
    session?: { visitorId: string | null; title: string | null } | null;
  } | null;
}

export interface OverviewResult {
  totalQuestions: number;
  uniqueVisitors: number;
  hitRate: number;
  positiveRate: number;
  avgLatencyMs: number;
  todayQuestions: number;
}

export interface TrendBucket {
  date: Date;
  total: number;
  answered: number;
  faqHit: number;
  lowConfidence: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 日志查询 ====================

  /**
   * 把 AnalyticsQueryDto 拍平为 Prisma where,供 queryLogs / exportCsv 共用。
   * keyword 用 PostgreSQL 模式大小写不敏感模糊匹配(query 字段)。
   */
  private buildWhere(filter: AnalyticsQueryDto): Prisma.RagLogWhereInput {
    const where: Prisma.RagLogWhereInput = {};
    if (typeof filter.isAnswered === "boolean")
      where.isAnswered = filter.isAnswered;
    if (typeof filter.faqHit === "boolean") where.faqHit = filter.faqHit;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    } else if (filter.range) {
      const { since, until } = resolveRange(filter.range);
      where.createdAt = { gte: since, lte: until };
    }
    if (filter.keyword && filter.keyword.trim()) {
      where.query = { contains: filter.keyword.trim(), mode: "insensitive" };
    }
    return where;
  }

  async queryLogs(
    filter: AnalyticsQueryDto,
    pagination: { page: number; pageSize: number },
  ): Promise<PaginatedResult<RagLogRow>> {
    const where = this.buildWhere(filter);
    const page = pagination.page;
    const pageSize = pagination.pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ragLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // 明确不取 retrievedTopK / rerankedTopK,日志列表只展示元信息;
        // 详情若要看 sources 走 getLogById 之类接口(后续扩展)。
      }),
      this.prisma.ragLog.count({ where }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  // ==================== 概览指标 ====================

  /**
   * 概览指标:
   *  - totalQuestions: 范围内 RagLog 计数
   *  - uniqueVisitors: 通过 RagLog.sessionId 关联 ChatSession 的 distinct visitorId 数(用 $queryRaw)
   *  - hitRate: 范围内 faqHit=true 占比(0~1)
   *  - positiveRate: 范围内 Feedback 中 rating=UP 占比(0~1,无反馈时返回 0)
   *  - avgLatencyMs: 范围内 latencyMs 平均
   *  - todayQuestions: 今日 0 点起 RagLog 计数(不受 range 影响)
   */
  async getOverview(range?: AnalyticsRange): Promise<OverviewResult> {
    const { since, until } = resolveRange(range);
    const startOfToday = startOfDay(new Date());

    const [agg, faqHitAgg, todayCount, uniqueVisitors, positiveRate] =
      await Promise.all([
        this.prisma.ragLog.aggregate({
          where: { createdAt: { gte: since, lte: until } },
          _count: { _all: true },
          _avg: { latencyMs: true },
        }),
        this.prisma.ragLog.count({
          where: { createdAt: { gte: since, lte: until }, faqHit: true },
        }),
        this.prisma.ragLog.count({
          where: { createdAt: { gte: startOfToday } },
        }),
        this.countUniqueVisitors(since, until),
        this.computePositiveRate(since, until),
      ]);

    const total = agg._count._all;
    const hitRate = total > 0 ? faqHitAgg / total : 0;
    const avgLatencyMs = agg._avg.latencyMs ?? 0;

    return {
      totalQuestions: total,
      uniqueVisitors,
      hitRate: roundTo(hitRate, 4),
      positiveRate: roundTo(positiveRate, 4),
      avgLatencyMs: Math.round(avgLatencyMs),
      todayQuestions: todayCount,
    };
  }

  private async countUniqueVisitors(since: Date, until: Date): Promise<number> {
    // RagLog.sessionId 是 denormalized 的外键字段,可直接 join ChatSession。
    // Prisma 不支持对 denormalized 字段的 distinct 关联聚合(relation 不存在),
    // 所以走 $queryRaw。visitorId 可能是 NULL,需要排除。
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT cs."visitorId")::bigint AS count
      FROM "RagLog" rl
      INNER JOIN "ChatSession" cs ON cs.id = rl."sessionId"
      WHERE rl."createdAt" >= ${since}
        AND rl."createdAt" <= ${until}
        AND cs."visitorId" IS NOT NULL
    `);
    const raw = rows[0]?.count ?? 0n;
    return Number(raw);
  }

  private async computePositiveRate(since: Date, until: Date): Promise<number> {
    // 走 Prisma 嵌套 relation 过滤,链路:Feedback -> ChatMessage.ragLog.createdAt
    const [total, positive] = await Promise.all([
      this.prisma.feedback.count({
        where: {
          message: { ragLog: { createdAt: { gte: since, lte: until } } },
        },
      }),
      this.prisma.feedback.count({
        where: {
          rating: "UP",
          message: { ragLog: { createdAt: { gte: since, lte: until } } },
        },
      }),
    ]);
    return total > 0 ? positive / total : 0;
  }

  // ==================== Top 热门问题 ====================

  /**
   * 热门问题:按 query 文本聚合 RagLog,按出现次数降序,同次数按 query 字典序稳定。
   *  - range: 与 overview/trends 一致(24h / 7d / 30d),默认 7d
   *  - isAnswered / faqHit: 可选过滤,避免"拒答但被打字"和"未命中 FAQ"的问题污染 top
   *  - 返回字段:query / count(总提问) / answeredCount(其中被回答的次数)
   *    answeredCount 让前端能直接展示"被回答占比",并给"沉淀 FAQ 候选"提供额外信号
   */
  async getTopQuestions(
    query: TopQuestionsQueryDto,
  ): Promise<{
    items: {
      query: string;
      count: number;
      answeredCount: number;
    }[];
    range: AnalyticsRange;
  }> {
    const { since, until } = resolveRange(query.range);
    const range: AnalyticsRange =
      query.range === "24h" || query.range === "30d" ? query.range : "7d";
    // ↑ 仅用于响应体声明,Prisma 查询用 since/until

    const where: Prisma.RagLogWhereInput = {
      createdAt: { gte: since, lte: until },
    };
    if (typeof query.isAnswered === "boolean")
      where.isAnswered = query.isAnswered;
    if (typeof query.faqHit === "boolean") where.faqHit = query.faqHit;

    const grouped = await this.prisma.ragLog.groupBy({
      by: ["query"],
      where,
      _count: { _all: true, isAnswered: true },
      orderBy: [{ _count: { query: "desc" } }, { query: "asc" }],
      take: query.limit,
    });

    return {
      items: grouped.map((g) => ({
        query: g.query,
        count: g._count._all,
        answeredCount: g._count.isAnswered,
      })),
      range,
    };
  }

  // ==================== 趋势 ====================

  /**
   * 按天/小时分桶,统计 total / answered / faqHit / lowConfidence。
   * 必须走 PostgreSQL 原生 date_trunc,Prisma groupBy 不支持任意时间桶。
   */
  async getTrends(
    range: AnalyticsRange | undefined,
    granularity: AnalyticsGranularity | undefined,
  ): Promise<{
    items: TrendBucket[];
    granularity: AnalyticsGranularity;
    range: AnalyticsRange;
  }> {
    const resolved = resolveRange(range);
    const { since, until } = resolved;
    const bucket = granularity ?? "day";

    const rows = await this.prisma.$queryRaw<
      {
        bucket: Date;
        total: bigint;
        answered: bigint;
        faq_hit: bigint;
        low_confidence: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        date_trunc(${bucket}, rl."createdAt") AS bucket,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE rl."isAnswered" = true)::bigint AS answered,
        COUNT(*) FILTER (WHERE rl."faqHit" = true)::bigint AS faq_hit,
        COUNT(*) FILTER (
          WHERE rl."confidence" IS NOT NULL
            AND rl."confidence" < ${LOW_CONFIDENCE_THRESHOLD}
        )::bigint AS low_confidence
      FROM "RagLog" rl
      WHERE rl."createdAt" >= ${since}
        AND rl."createdAt" <= ${until}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);

    return {
      items: rows.map((r) => ({
        date: r.bucket,
        total: Number(r.total),
        answered: Number(r.answered),
        faqHit: Number(r.faq_hit),
        lowConfidence: Number(r.low_confidence),
      })),
      granularity: bucket,
      range:
        resolved.hours === 24
          ? "24h"
          : resolved.hours === 24 * 30
            ? "30d"
            : "7d",
    };
  }

  // ==================== CSV 导出 ====================

  /**
   * 导出当前过滤条件下的全部日志为 CSV 字符串。
   * 不分页 — 后台导出场景数据量可控(单次最多几十 MB,字符串常驻内存足够)。
   * 若未来需要流式,改成 cursor 拉 + chunked CSV 写到 S3 即可。
   */
  async exportCsv(filter: AnalyticsQueryDto): Promise<string> {
    const where = this.buildWhere(filter);
    const logs = await this.prisma.ragLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    this.logger.log(`Exporting ${logs.length} rag logs to CSV`);

    const header = [
      "id",
      "createdAt",
      "sessionId",
      "query",
      "rewrittenQuery",
      "isAnswered",
      "faqHit",
      "confidence",
      "latencyMs",
      "llmProvider",
      "rejectReason",
    ];
    const rows: CsvCell[][] = logs.map((l) => [
      l.id,
      l.createdAt,
      l.sessionId ?? "",
      l.query,
      l.rewrittenQuery ?? "",
      l.isAnswered,
      l.faqHit,
      l.confidence ?? "",
      l.latencyMs,
      l.llmProvider,
      l.rejectReason ?? "",
    ]);
    return buildCsv(header, rows);
  }

  // ==================== 反馈 ====================

  /** 反馈列表 — 关联 message / session,支持 range 过滤 */
  async listFeedbacks(
    filter: AnalyticsQueryDto,
    pagination: { page: number; pageSize: number },
  ): Promise<PaginatedResult<FeedbackRow>> {
    const where = this.buildFeedbackWhere(filter);
    const page = pagination.page;
    const pageSize = pagination.pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          message: {
            select: {
              id: true,
              content: true,
              role: true,
              sessionId: true,
              session: { select: { visitorId: true, title: true } },
            },
          },
        },
      }),
      this.prisma.feedback.count({ where }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  /** 反馈 CSV 导出 */
  async exportFeedbacksCsv(filter: AnalyticsQueryDto): Promise<string> {
    const where = this.buildFeedbackWhere(filter);
    const items = await this.prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        message: {
          select: {
            id: true,
            content: true,
            role: true,
            sessionId: true,
            session: { select: { visitorId: true, title: true } },
          },
        },
      },
    });
    this.logger.log(`Exporting ${items.length} feedbacks to CSV`);

    const header = [
      "id",
      "createdAt",
      "rating",
      "messageId",
      "sessionId",
      "visitorId",
      "sessionTitle",
      "comment",
      "messageContent",
    ];
    const rows: CsvCell[][] = items.map((f) => [
      f.id,
      f.createdAt,
      f.rating,
      f.messageId,
      f.message?.sessionId ?? "",
      f.message?.session?.visitorId ?? "",
      f.message?.session?.title ?? "",
      f.comment ?? "",
      f.message?.content ?? "",
    ]);
    return buildCsv(header, rows);
  }

  private buildFeedbackWhere(filter: AnalyticsQueryDto): Prisma.FeedbackWhereInput {
    const where: Prisma.FeedbackWhereInput = {};
    if (filter.keyword) {
      where.OR = [
        { comment: { contains: filter.keyword, mode: "insensitive" } },
        { message: { content: { contains: filter.keyword, mode: "insensitive" } } },
      ];
    }
    if (filter.startDate || filter.endDate) {
      where.createdAt = {
        ...(filter.startDate ? { gte: filter.startDate } : {}),
        ...(filter.endDate ? { lte: filter.endDate } : {}),
      };
    } else if (filter.range) {
      const { since, until } = resolveRange(filter.range);
      where.createdAt = { gte: since, lte: until };
    }
    return where;
  }
}

function roundTo(n: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
