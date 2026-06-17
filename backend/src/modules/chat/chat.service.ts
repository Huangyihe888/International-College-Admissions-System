import { Injectable, Logger } from "@nestjs/common";
import {
  Prisma,
  type ChatMessage,
  type ChatSession,
  type FeedbackRating,
} from "@prisma/client";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import { RagService } from "../rag/rag.service";
import type { RagChunk as RagModuleChunk, RagSourceItem } from "../rag/types";
import { CreateSessionDto } from "./dto/create-session.dto";
import { RagAnswerInput, RagChunk, RagSource } from "./types";

const HISTORY_LIMIT = 10;
const FALLBACK_ANSWER = "RAG 暂未接入,请稍后重试。";

export interface ChatSessionRow {
  id: string;
  title: string | null;
  visitorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  citations: RagSource[] | null;
  confidence: number | null;
  ragLogId: string | null;
  createdAt: Date;
}

export interface SendResult {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
  citations: RagSource[];
  confidence: number | null;
  faqHit: boolean;
  isAnswered: boolean;
}

/**
 * ChatModule 业务服务。
 *
 * 几个关键点:
 * 1) visitorId 永远从服务端读(als.visitorId 或 x-visitor-id header,由 VisitorIdMiddleware 兜底),
 *    不接受 body 传 — 否则匿名场景就成笑话。
 * 2) RagService 由另一个 subagent 实现,通过 ModuleRef.get('RagService', { strict: false }) 解析;
 *    解析不到时降级到 FALLBACK_ANSWER(标 isAnswered=false 落 RagLog),让 ChatModule 在 RAG 未就绪时
 *    也能跑通端到端。
 * 3) 流式路径先把 USER 消息落库,再走 RagService 流;ASSISTANT 消息在流结束后一次性写入,
 *    不在每个 token 写库(避免 INSERT 高频,失败也只丢这一条)。
 * 4) feedback 走 upsert(Feedback.messageId @unique),二次提交即更新语义。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
  ) {}

  // ========================= 会话 =========================

  async getOrCreateSession(
    visitorId: string,
    sessionId?: string,
  ): Promise<ChatSession> {
    if (sessionId) {
      const existing = await this.prisma.chatSession.findUnique({
        where: { id: sessionId },
      });
      if (existing) {
        // 归属校验:anonymous 访客只能拿回自己 visitorId 的会话
        if (existing.visitorId && existing.visitorId !== visitorId) {
          throw new BusinessException(
            ErrorCode.NOT_FOUND,
            `Chat session not found: ${sessionId}`,
          );
        }
        // 若该会话先前没 visitorId(老数据 / 跨设备),把当前 visitorId 绑上去
        if (!existing.visitorId) {
          return this.prisma.chatSession.update({
            where: { id: existing.id },
            data: { visitorId },
          });
        }
        return existing;
      }
    }
    return this.prisma.chatSession.create({
      data: { visitorId, title: null },
    });
  }

  async createSession(
    visitorId: string,
    dto: CreateSessionDto,
  ): Promise<ChatSession> {
    return this.prisma.chatSession.create({
      data: { visitorId, title: dto.title ?? null },
    });
  }

  async listSessions(
    visitorId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ChatSessionRow>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.chatSession.findMany({
        where: { visitorId },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.chatSession.count({ where: { visitorId } }),
    ]);
    const rows: ChatSessionRow[] = items.map((s) => ({
      id: s.id,
      title: s.title,
      visitorId: s.visitorId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s._count.messages,
    }));
    return paginate(rows, total, page, pageSize);
  }

  async listMessages(
    visitorId: string,
    sessionId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ChatMessageRow>> {
    await this.assertSessionOwner(visitorId, sessionId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.chatMessage.count({ where: { sessionId } }),
    ]);
    const rows: ChatMessageRow[] = items.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      citations: this.normalizeCitations(m.sources),
      confidence: m.confidence,
      ragLogId: m.ragLogId,
      createdAt: m.createdAt,
    }));
    return paginate(rows, total, page, pageSize);
  }

  private async assertSessionOwner(
    visitorId: string,
    sessionId: string,
  ): Promise<ChatSession> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || (session.visitorId && session.visitorId !== visitorId)) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Chat session not found: ${sessionId}`,
      );
    }
    return session;
  }

  // ========================= 同步问答 =========================

  async send(
    visitorId: string,
    sessionId: string,
    question: string,
  ): Promise<SendResult> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || (session.visitorId && session.visitorId !== visitorId)) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Chat session not found: ${sessionId}`,
      );
    }

    const startedAt = Date.now();
    const userMessage = await this.persistUserMessage(sessionId, question);
    const history = await this.loadHistory(sessionId, HISTORY_LIMIT);

    const stream = this.runRagStream({
      question,
      visitorId,
      sessionId,
      history,
    });

    let answer = "";
    const sources: RagSource[] = [];
    let confidence: number | null = null;
    let faqHit = false;
    let isAnswered = false;
    let rejectReason: string | null = null;
    let ragLogId: string | null = null;

    try {
      for await (const chunk of stream) {
        if (chunk.content) answer += chunk.content;
        if (chunk.sources && chunk.sources.length)
          sources.push(...chunk.sources);
        if (typeof chunk.confidence === "number") confidence = chunk.confidence;
        if (typeof chunk.faqHit === "boolean") faqHit = chunk.faqHit;
        if (typeof chunk.isAnswered === "boolean")
          isAnswered = chunk.isAnswered;
        if (chunk.rejectReason) rejectReason = chunk.rejectReason;
        if (chunk.ragLogId) ragLogId = chunk.ragLogId;
      }
    } catch (err) {
      this.logger.warn(
        `[chat] rag stream failed session=${sessionId} err=${(err as Error).message}; degrade to fallback`,
      );
      // RagService 自身抛错:降级到兜底,isAnswered 走 false
      answer = answer || FALLBACK_ANSWER;
      isAnswered = false;
      rejectReason = rejectReason ?? "rag_stream_error";
    }

    // 流式没回 sources(降级 / 拒答)也要保证响应体字段稳定
    if (sources.length === 0) sources.length = 0;

    const latencyMs = Date.now() - startedAt;
    const assistantMessage = await this.persistAssistantMessage({
      sessionId,
      content: answer || FALLBACK_ANSWER,
      sources,
      confidence,
      ragLogId,
    });

    // RagLog 兜底:RagService 内部可能没落 RagLog,这里在降级路径上补一条
    if (!ragLogId) {
      await this.safeCreateRagLog({
        sessionId,
        query: question,
        isAnswered,
        confidence,
        faqHit,
        rejectReason,
        latencyMs,
      });
    }

    await this.touchSession(sessionId, question, answer);

    return {
      sessionId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      answer: assistantMessage.content,
      citations: sources,
      confidence,
      faqHit,
      isAnswered,
    };
  }

  // ========================= 流式问答 =========================

  /**
   * 流式生成:RagService.answerStream() 的每个 chunk 推一份 SSE MessageEvent 给前端。
   * 失败 / 降级 / 客户端断开一律不影响最终 ASSISTANT 消息的入库。
   */
  async *stream(
    visitorId: string,
    sessionId: string,
    question: string,
  ): AsyncGenerator<RagChunk, void, void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || (session.visitorId && session.visitorId !== visitorId)) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Chat session not found: ${sessionId}`,
      );
    }

    const startedAt = Date.now();
    const userMessage = await this.persistUserMessage(sessionId, question);
    const history = await this.loadHistory(sessionId, HISTORY_LIMIT);

    // 预创建空 assistant 消息,这样 messageId 在流开始时就可用,前端可立即把 local- 占位
    // 替换为真实 DB id,反馈/引用功能就能正确关联
    const placeholder = await this.persistAssistantMessage({
      sessionId,
      content: "",
      sources: [],
      confidence: null,
      ragLogId: null,
    });
    yield { meta: { messageId: placeholder.id, userMessageId: userMessage.id } };

    let answer = "";
    const sources: RagSource[] = [];
    let confidence: number | null = null;
    let faqHit = false;
    let isAnswered = false;
    let rejectReason: string | null = null;
    let ragLogId: string | null = null;

    try {
      for await (const chunk of this.runRagStream({
        question,
        visitorId,
        sessionId,
        history,
      })) {
        if (chunk.content) answer += chunk.content;
        if (chunk.sources && chunk.sources.length)
          sources.push(...chunk.sources);
        if (typeof chunk.confidence === "number") confidence = chunk.confidence;
        if (typeof chunk.faqHit === "boolean") faqHit = chunk.faqHit;
        if (typeof chunk.isAnswered === "boolean")
          isAnswered = chunk.isAnswered;
        if (chunk.rejectReason) rejectReason = chunk.rejectReason;
        if (chunk.ragLogId) ragLogId = chunk.ragLogId;
        yield chunk;
      }
    } catch (err) {
      this.logger.warn(
        `[chat] rag stream errored mid-flight session=${sessionId} err=${(err as Error).message}`,
      );
      rejectReason = rejectReason ?? "rag_stream_error";
      isAnswered = false;
      if (!answer) {
        // 还未向前端发过任何内容:发一条降级回复
        answer = FALLBACK_ANSWER;
        yield { content: answer, isAnswered: false, rejectReason };
      }
      // 已有内容流出时不再重复 yield,避免答案被追加两遍
    }

    const latencyMs = Date.now() - startedAt;
    // 流结束后用真实内容 UPDATE 占位消息
    const assistantMessage = await this.updateAssistantMessage(placeholder.id, {
      content: answer || FALLBACK_ANSWER,
      sources,
      confidence,
      ragLogId,
    });

    if (!ragLogId) {
      await this.safeCreateRagLog({
        sessionId,
        query: question,
        isAnswered,
        confidence,
        faqHit,
        rejectReason,
        latencyMs,
      });
    }

    await this.touchSession(sessionId, question, answer);
    this.logger.debug?.(
      `[chat] stream done session=${sessionId} userMsg=${userMessage.id} assistantMsg=${assistantMessage.id}`,
    );
  }

  // ========================= 反馈 =========================

  async feedback(
    visitorId: string,
    messageId: string,
    rating: "POSITIVE" | "NEGATIVE",
    comment?: string,
  ): Promise<{ messageId: string; rating: FeedbackRating }> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: { session: { select: { visitorId: true } } },
    });
    if (
      !message ||
      (message.session.visitorId && message.session.visitorId !== visitorId)
    ) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `Chat message not found: ${messageId}`,
      );
    }

    const mapped: FeedbackRating = rating === "POSITIVE" ? "UP" : "DOWN";

    // upsert 语义:同 message 多次提交以最新一次为准
    const updated = await this.prisma.feedback.upsert({
      where: { messageId },
      create: { messageId, rating: mapped, comment: comment ?? null },
      update: { rating: mapped, comment: comment ?? null },
      select: { messageId: true, rating: true },
    });
    return updated;
  }

  // ========================= 内部工具 =========================

  private runRagStream(input: RagAnswerInput): AsyncIterable<RagChunk> {
    try {
      const raw = this.rag.answerStream({
        question: input.question,
        visitorId: input.visitorId,
        sessionId: input.sessionId,
        history: input.history,
      });
      return this.adaptRagStream(raw);
    } catch (err) {
      this.logger.warn(
        `[chat] rag.answerStream threw sync err=${(err as Error).message}; degrade`,
      );
      return (async function* () {
        yield {
          content: FALLBACK_ANSWER,
          isAnswered: false,
          rejectReason: "rag_throw_sync",
        };
      })();
    }
  }

  private async *adaptRagStream(
    iter: AsyncIterable<RagModuleChunk>,
  ): AsyncGenerator<RagChunk, void, void> {
    for await (const c of iter) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "token") {
        if (c.content) yield { content: c.content };
        continue;
      }
      if (c.type === "sources") {
        const items = Array.isArray(c.items) ? c.items : [];
        const sources = this.mapSources(items);
        yield { sources };
        continue;
      }
      if (c.type === "done") {
        const confidence =
          typeof c.confidence === "number" ? c.confidence : undefined;
        const faqHit = Boolean(c.faqHit);
        const isAnswered =
          typeof c.isAnswered === "boolean" ? c.isAnswered : !Boolean(c.fallback);
        const rejectReason =
          c.rejectReason !== undefined
            ? c.rejectReason ?? undefined
            : c.fallback
              ? "fallback"
              : undefined;
        yield { confidence, faqHit, isAnswered, rejectReason, ragLogId: c.ragLogId ?? undefined };
        continue;
      }
      if (c.type === "reject") {
        yield { isAnswered: false, rejectReason: c.reason };
        continue;
      }
      if (c.type === "error") {
        yield { isAnswered: false, rejectReason: "rag_error", ragLogId: c.ragLogId ?? undefined };
        continue;
      }
    }
  }

  private mapSources(items: RagSourceItem[]): RagSource[] {
    return items.map((it) => {
      const docId = it.type === "faq" ? "FAQ" : it.filename || "document";
      const chunkId = it.id;
      const score = typeof it.score === "number" ? it.score : 0;
      const snippet = (it.content ?? "").slice(0, 240);
      return { docId, chunkId, score, snippet };
    });
  }

  private normalizeCitations(raw: unknown): RagSource[] | null {
    if (!raw) return null;
    if (!Array.isArray(raw)) return null;
    const out: RagSource[] = [];
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const obj = it as Record<string, unknown>;
      const chunkId = typeof obj.chunkId === "string" ? obj.chunkId : "";
      const docId =
        typeof obj.docId === "string"
          ? obj.docId
          : typeof obj.documentId === "string"
            ? obj.documentId
            : typeof obj.title === "string"
              ? obj.title
              : "";
      const score = typeof obj.score === "number" ? obj.score : 0;
      const snippet =
        typeof obj.snippet === "string"
          ? obj.snippet
          : typeof obj.content === "string"
            ? obj.content.slice(0, 240)
            : "";
      if (!chunkId) continue;
      out.push({ docId: docId || "document", chunkId, score, snippet });
    }
    return out.length ? out : null;
  }

  private async persistUserMessage(
    sessionId: string,
    content: string,
  ): Promise<ChatMessage> {
    return this.prisma.chatMessage.create({
      data: { sessionId, role: "USER", content },
    });
  }

  private async persistAssistantMessage(args: {
    sessionId: string;
    content: string;
    sources: RagSource[];
    confidence: number | null;
    ragLogId: string | null;
  }): Promise<ChatMessage> {
    return this.prisma.chatMessage.create({
      data: {
        sessionId: args.sessionId,
        role: "ASSISTANT",
        content: args.content,
        sources: args.sources.length
          ? (args.sources as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        confidence: args.confidence,
        ragLogId: args.ragLogId,
      },
    });
  }

  /** 流式场景下:用真实内容更新流开始时预创建的空 assistant 消息 */
  private async updateAssistantMessage(
    id: string,
    args: {
      content: string;
      sources: RagSource[];
      confidence: number | null;
      ragLogId: string | null;
    },
  ): Promise<ChatMessage> {
    return this.prisma.chatMessage.update({
      where: { id },
      data: {
        content: args.content,
        sources: args.sources.length
          ? (args.sources as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        confidence: args.confidence,
        ragLogId: args.ragLogId,
      },
    });
  }

  private async loadHistory(
    sessionId: string,
    limit: number,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { role: true, content: true },
    });
    return rows.reverse().map((r) => ({
      role: r.role === "USER" ? "user" : "assistant",
      content: r.content,
    }));
  }

  private async touchSession(
    sessionId: string,
    question: string,
    answer: string,
  ): Promise<void> {
    const title = question.length > 50 ? question.slice(0, 50) : question;
    const data: Prisma.ChatSessionUpdateInput = { updatedAt: new Date() };
    // 仅在 title 仍为空时回填
    const current = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { title: true },
    });
    if (current && !current.title)
      data.title = title || answer.slice(0, 50) || null;
    try {
      await this.prisma.chatSession.update({ where: { id: sessionId }, data });
    } catch (err) {
      this.logger.warn(
        `[chat] touchSession failed session=${sessionId} err=${(err as Error).message}`,
      );
    }
  }

  private async safeCreateRagLog(args: {
    sessionId: string;
    query: string;
    isAnswered: boolean;
    confidence: number | null;
    faqHit: boolean;
    rejectReason: string | null;
    latencyMs: number;
  }): Promise<void> {
    try {
      await this.prisma.ragLog.create({
        data: {
          sessionId: args.sessionId,
          query: args.query,
          isAnswered: args.isAnswered,
          confidence: args.confidence,
          faqHit: args.faqHit,
          rejectReason: args.rejectReason,
          latencyMs: args.latencyMs,
          llmProvider: "unavailable",
        },
      });
    } catch (err) {
      this.logger.warn(
        `[chat] ragLog fallback create failed session=${args.sessionId} err=${(err as Error).message}`,
      );
    }
  }
}
