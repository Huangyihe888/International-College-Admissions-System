import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { TypedConfigService } from "../../config/typed-config.service";
import { LlmService } from "../../llm/llm.service";
import { RerankService } from "../../llm/rerank.service";
import { RedisService } from "../../redis/redis.service";
import { PromService } from "../../common/metrics/prom.service";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { FaqRecallService } from "./faq/faq-recall.service";
import { VectorRecallService } from "./recall/vector-recall.service";
import { PromptBuilder } from "./prompts/prompt-builder.service";
import { ForbidChecker } from "./forbidden/forbid-checker.service";
import {
  CachedAnswer,
  RagAnswer,
  RagChunk,
  RagSourceItem,
  RagStreamRequest,
  RetrievedChunk,
} from "./types";

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: TypedConfigService,
    private readonly llm: LlmService,
    private readonly rerank: RerankService,
    private readonly redis: RedisService,
    private readonly prom: PromService,
    private readonly forbid: ForbidChecker,
    private readonly faqRecall: FaqRecallService,
    private readonly vectorRecall: VectorRecallService,
    private readonly promptBuilder: PromptBuilder,
  ) {}

  async *answerStream(req: RagStreamRequest): AsyncIterable<RagChunk> {
    const start = Date.now();
    const endTimer = this.prom.ragLatency.startTimer({ stage: "total" });
    const { question, visitorId, sessionId, history } = req;
    this.logger.log(`[rag] answerStream enter q="${question.slice(0, 40)}"`);

    if (!question || !question.trim()) {
      yield {
        type: "error",
        code: ErrorCode.VALIDATION_FAILED,
        message: "question is required",
      };
      endTimer();
      return;
    }

    const cacheKey = this.answerCacheKey(question, visitorId);
    const cached = await this.tryReadAnswerCache(cacheKey);
    if (cached) {
      yield { type: "token", content: cached.answer };
      yield { type: "sources", items: cached.sources };
      yield {
        type: "done",
        confidence: cached.confidence,
        faqHit: cached.faqHit,
        cached: true,
        isAnswered: true,
        rejectReason: null,
      };
      this.prom.ragRequestsTotal.inc({
        isAnswered: "true",
        faqHit: cached.faqHit ? "true" : "false",
      });
      endTimer();
      return;
    }

    const forbidResult = await this.forbid.check(question);
    if (forbidResult.hit) {
      this.prom.ragRequestsTotal.inc({ isAnswered: "false", faqHit: "false" });
      const logId = await this.safeLog({
        query: question,
        isAnswered: false,
        faqHit: false,
        confidence: null,
        rejectReason: `forbidden:${forbidResult.ruleId ?? forbidResult.ruleName ?? "unknown"}`,
        retrievedTopK: [],
        rerankedTopK: null,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: forbidResult.reply ?? forbidResult.reason ?? "forbidden",
      });
      yield {
        type: "error",
        code: ErrorCode.RAG_FORBIDDEN_HIT,
        message: forbidResult.reply ?? "该问题暂不支持回答",
        ragLogId: logId,
      };
      endTimer();
      return;
    }

    const kbVersion = await this.findActiveKbVersion();
    if (!kbVersion) {
      this.logger.warn(
        `[rag] no active KB version, return no-answer reply for q="${question.slice(0, 40)}"`,
      );
      const reply = this.buildNoAnswerReply();
      this.prom.ragRequestsTotal.inc({ isAnswered: "false", faqHit: "false" });
      const logId = await this.safeLog({
        query: question,
        isAnswered: false,
        faqHit: false,
        confidence: null,
        rejectReason: "no_kb_version",
        retrievedTopK: [],
        rerankedTopK: null,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: null,
        promptTokens: null,
        completionTokens: null,
      });
      yield { type: "token", content: reply };
      yield { type: "sources", items: [] };
      yield {
        type: "done",
        confidence: null,
        faqHit: false,
        fallback: true,
        isAnswered: false,
        rejectReason: "no_kb_version",
        ragLogId: logId,
      };
      endTimer();
      return;
    }

    const faqHit = await this.faqRecall.recall(
      question,
      kbVersion.id,
      this.cfg.rag.faqThreshold,
    );
    if (faqHit) {
      const sources: RagSourceItem[] = [
        {
          type: "faq",
          id: faqHit.faqId,
          content: faqHit.question,
          score: faqHit.score,
        },
      ];

      // FAQ 命中后，把答案作为参考资料传给 LLM，让 LLM 结合用户问题重新组织语言
      const { system, user } = this.promptBuilder.build({
        question,
        history,
        retrievedChunks: [],
        faqAnswer: faqHit.answer,
        forbiddenSummary: "默认禁答规则已开启",
      });

      let answer = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let streamError: unknown;
      try {
        const stream = this.llm.chatStream({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: true,
        });
        for await (const chunk of stream) {
          if (chunk.content) {
            answer += chunk.content;
            yield { type: "token", content: chunk.content };
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.promptTokens ?? promptTokens;
            completionTokens = chunk.usage.completionTokens ?? completionTokens;
          }
        }
      } catch (err) {
        streamError = err;
      }

      if (streamError) {
        // LLM 失败时回退到直接返回 FAQ 答案
        yield { type: "token", content: faqHit.answer };
        answer = faqHit.answer;
      }

      this.prom.ragRequestsTotal.inc({ isAnswered: "true", faqHit: "true" });
      await this.safeWriteAnswerCache(cacheKey, {
        answer: answer || faqHit.answer,
        sources,
        confidence: 0.95,
        faqHit: true,
        storedAt: Date.now(),
      });
      const logId = await this.safeLog({
        query: question,
        isAnswered: true,
        faqHit: true,
        confidence: 0.95,
        rejectReason: null,
        retrievedTopK: sources,
        rerankedTopK: null,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: null,
        promptTokens,
        completionTokens,
      });
      yield { type: "sources", items: sources };
      yield {
        type: "done",
        confidence: 0.95,
        faqHit: true,
        isAnswered: true,
        rejectReason: null,
        ragLogId: logId,
      };
      endTimer();
      return;
    }

    const retrieved = await this.vectorRecall.recall(
      question,
      kbVersion.id,
      this.cfg.rag.topK,
    );
    if (retrieved.length === 0) {
      // 向量检索为空时，让 LLM 用简化提示词尝试推理回答
      this.logger.log(`[rag] vector recall empty, using LLM reasoning for q="${question.slice(0, 40)}"`);
      const fallbackSystem = `你是五邑大学国际教育学院招生问答助手。请根据你所了解的中外联合培养项目信息，尽力回答用户问题。
如果确实无法回答，再建议用户联系招生办。

已知信息：
- 项目有2+2（双学士）和2+2+1（本硕连读）两种模式
- 工科类（计算机、通信、人工智能）学费5710元/年，经管文法类（会计、金融、法学）学费5050元/年，英语（经管文法类）学费5710元/年
- 项目培养费38000元/年，在地国际化48000元/学年
- 住宿费1500-1600元/年
- 2026年共招生750人
- 合作院校：朴次茅斯大学、维多利亚大学、沃隆港大学、萨塞克斯大学、麦考瑞大学、悉尼科技大学、斯旺西大学

禁止编造具体数字（如录取分数线），如不确定请说明。`;

      let answer = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let streamError: unknown;
      try {
        const stream = this.llm.chatStream({
          messages: [
            { role: "system", content: fallbackSystem },
            { role: "user", content: question },
          ],
          stream: true,
        });
        for await (const chunk of stream) {
          if (chunk.content) {
            answer += chunk.content;
            yield { type: "token", content: chunk.content };
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.promptTokens ?? promptTokens;
            completionTokens = chunk.usage.completionTokens ?? completionTokens;
          }
        }
      } catch (err) {
        streamError = err;
      }

      if (streamError) {
        const reply = this.buildNoAnswerReply();
        yield { type: "token", content: reply };
        answer = reply;
      }

      this.prom.ragRequestsTotal.inc({ isAnswered: answer.length > 0 ? "true" : "false", faqHit: "false" });
      const logId = await this.safeLog({
        query: question,
        isAnswered: answer.length > 0,
        faqHit: false,
        confidence: null,
        rejectReason: answer.length > 0 ? null : "no_relevant_context",
        retrievedTopK: [],
        rerankedTopK: null,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: null,
        promptTokens,
        completionTokens,
      });
      yield { type: "sources", items: [] };
      yield {
        type: "done",
        confidence: null,
        faqHit: false,
        fallback: true,
        isAnswered: answer.length > 0,
        rejectReason: answer.length > 0 ? null : "no_relevant_context",
        ragLogId: logId,
      };
      endTimer();
      return;
    }

    let reranked: RetrievedChunk[];
    try {
      reranked = await this.rerankChunks(question, retrieved);
    } catch (err) {
      // Rerank failure is non-fatal: fallback to original vector score order
      this.logger.warn(`[rag] rerank failed, fallback to vector order: ${(err as Error).message}`);
      reranked = retrieved.slice(0, Math.max(1, this.cfg.rag.rerankTopK));
    }

    const topScore = reranked[0]?.score ?? 0;
    if (topScore < this.cfg.rag.rejectThreshold) {
      // 低置信度但仍用正常系统提示词让 LLM 推理，而不是强制说"暂无信息"
      this.logger.log(
        `[rag] low confidence (top=${topScore.toFixed(3)} < ${this.cfg.rag.rejectThreshold}), using LLM with retrieved chunks for q="${question.slice(0, 40)}"`,
      );
      const { system, user } = this.promptBuilder.build({
        question,
        history,
        retrievedChunks: reranked,
        faqAnswer: undefined,
        forbiddenSummary: "默认禁答规则已开启",
      });

      let answer = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let streamError: unknown;
      try {
        const stream = this.llm.chatStream({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: true,
        });
        for await (const chunk of stream) {
          if (chunk.content) {
            answer += chunk.content;
            yield { type: "token", content: chunk.content };
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.promptTokens ?? promptTokens;
            completionTokens = chunk.usage.completionTokens ?? completionTokens;
          }
        }
      } catch (err) {
        streamError = err;
      }

      if (streamError) {
        const reply = this.buildNoAnswerReply();
        yield { type: "token", content: reply };
        answer = reply;
      }

      const sources: RagSourceItem[] = reranked.map((c) => ({
        type: "chunk" as const,
        id: c.chunkId,
        content: c.content.slice(0, 200),
        score: c.score,
      }));
      this.prom.ragRequestsTotal.inc({
        isAnswered: answer.length > 0 ? "true" : "false",
        faqHit: "false",
      });
      const logId = await this.safeLog({
        query: question,
        isAnswered: answer.length > 0,
        faqHit: false,
        confidence: clamp01(topScore),
        rejectReason: "low_confidence_llm_fallback",
        retrievedTopK: retrieved,
        rerankedTopK: reranked,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: null,
        promptTokens,
        completionTokens,
      });
      yield { type: "sources", items: sources };
      yield {
        type: "done",
        confidence: clamp01(topScore),
        faqHit: false,
        fallback: true,
        isAnswered: answer.length > 0,
        rejectReason: null,
        ragLogId: logId,
      };
      endTimer();
      return;
    }

    const { system, user } = this.promptBuilder.build({
      question,
      history,
      retrievedChunks: reranked,
      faqAnswer: undefined,
      forbiddenSummary: "默认禁答规则已开启",
    });

    let answer = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let streamError: unknown;
    try {
      const stream = this.llm.chatStream({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk.content) {
          answer += chunk.content;
          yield { type: "token", content: chunk.content };
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.promptTokens ?? promptTokens;
          completionTokens = chunk.usage.completionTokens ?? completionTokens;
        }
      }
    } catch (err) {
      streamError = err;
    }

    if (streamError) {
      const err = streamError as { code?: string; message?: string };
      const isBusiness = streamError instanceof BusinessException;
      const code = isBusiness
        ? (streamError as BusinessException).code
        : ErrorCode.RAG_LLM_UPSTREAM_ERROR;
      this.prom.ragRequestsTotal.inc({ isAnswered: "false", faqHit: "false" });
      const logId = await this.safeLog({
        query: question,
        isAnswered: false,
        faqHit: false,
        confidence: clamp01(topScore),
        rejectReason: "llm_error",
        retrievedTopK: retrieved,
        rerankedTopK: reranked,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: err?.message ?? "llm error",
      });
      yield {
        type: "error",
        code: code as number,
        message: err?.message ?? "LLM upstream failed",
        ragLogId: logId,
      };
      endTimer();
      return;
    }

    const sources: RagSourceItem[] = reranked.map((c) => ({
      type: "chunk",
      id: c.chunkId,
      filename: c.filename,
      content: c.content,
      score: c.score,
    }));
    const confidence = clamp01(topScore);

    this.prom.ragRequestsTotal.inc({ isAnswered: "true", faqHit: "false" });

    await this.safeWriteAnswerCache(cacheKey, {
      answer,
      sources,
      confidence,
      faqHit: false,
      storedAt: Date.now(),
    });

    const logId = await this.safeLog({
      query: question,
      isAnswered: true,
      faqHit: false,
      confidence,
      rejectReason: null,
      retrievedTopK: retrieved,
      rerankedTopK: reranked,
      latencyMs: Date.now() - start,
      sessionId,
      errorMessage: null,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
    });

    yield { type: "sources", items: sources };
    yield {
      type: "done",
      confidence,
      faqHit: false,
      isAnswered: true,
      rejectReason: null,
      ragLogId: logId,
    };

    endTimer();
  }

  private buildNoAnswerReply(): string {
    const template = this.cfg.rag.noAnswerText || "";
    const qr = this.cfg.rag.noAnswerQrUrl;
    const out = template.replace(/\{QR_URL\}/g, qr ?? "").trim();
    if (qr && !out.includes(qr)) {
      return `${out}\n${qr}`;
    }
    return out;
  }

  async answer(req: RagStreamRequest): Promise<RagAnswer> {
    let answer = "";
    let sources: RagSourceItem[] = [];
    let confidence = 0;
    let faqHit = false;
    let cached = false;
    let rejectReason: "no_relevant_context" | "forbidden" | null = null;
    let errorCode: number | null = null;
    let errorMessage: string | null = null;

    for await (const chunk of this.answerStream(req)) {
      switch (chunk.type) {
        case "token":
          answer += chunk.content;
          break;
        case "sources":
          sources = chunk.items;
          break;
        case "done":
          confidence = chunk.confidence ?? confidence;
          faqHit = chunk.faqHit ?? faqHit;
          cached = chunk.cached ?? cached;
          break;
        case "reject":
          rejectReason = chunk.reason;
          break;
        case "error":
          errorCode = chunk.code;
          errorMessage = chunk.message;
          break;
      }
    }

    if (errorCode !== null) {
      throw new BusinessException({
        code: errorCode as ErrorCode,
        message: errorMessage ?? "RAG error",
      });
    }
    if (rejectReason) {
      throw new BusinessException({
        code:
          rejectReason === "forbidden"
            ? ErrorCode.RAG_FORBIDDEN_HIT
            : ErrorCode.RAG_NO_RELEVANT_CONTEXT,
        message:
          rejectReason === "forbidden"
            ? "该问题暂不支持回答"
            : "未找到相关参考内容",
      });
    }

    return { answer, sources, confidence, faqHit, cached };
  }

  private async rerankChunks(
    question: string,
    retrieved: RetrievedChunk[],
  ): Promise<RetrievedChunk[]> {
    const topN = Math.min(retrieved.length, this.cfg.rag.rerankTopK);
    if (topN <= 0) return retrieved;
    const docs = retrieved.map((r) => r.content);
    const res = await this.rerank.rerank(question, docs);
    const ordered: RetrievedChunk[] = [];
    const used = new Set<number>();
    for (const r of res.results) {
      const idx = Number(r.index);
      if (
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx >= retrieved.length ||
        used.has(idx)
      )
        continue;
      const base = retrieved[idx];
      ordered.push({ ...base, score: Number(r.score) || base.score });
      used.add(idx);
      if (ordered.length >= topN) break;
    }
    if (ordered.length === 0) {
      return retrieved.slice(0, topN);
    }
    return ordered;
  }

  private async findActiveKbVersion() {
    return this.prisma.knowledgeBaseVersion.findFirst({
      where: { isActive: true },
      orderBy: { activatedAt: "desc" },
    });
  }

  /**
   * LLM 兜底:不依赖 KB 召回,用 LLM 直答。
   * 抽出来给"recall 空"和"low confidence"两条路径共用。
   * 内部已经 yield 了 token,调用方不要再 yield。
   */
  private async llmFallback(
    question: string,
    sessionId: string | undefined,
    start: number,
    endTimer: () => number,
  ): Promise<{
    streamedChunks: Array<{ type: "token"; content: string }>;
    yieldError?: { type: "error"; code: number; message: string };
    promptTokens: number | null;
    completionTokens: number | null;
  }> {
    const streamedChunks: Array<{ type: "token"; content: string }> = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let streamError: unknown;
    const fallbackSystem =
      "你是五邑大学国际学院的招生问答助手。当前知识库中暂未找到与用户问题相关或相关性较低的参考资料,必须明确回复:\"当前知识库中暂无此问题的具体信息,建议扫码加入 **2026 中外联培项目咨询群** 或直接联系学院招生办获取最新权威解答。\\n\\n![2026中外联培项目咨询群](/wyu/qr-group.jpg)\"";
    try {
      const stream = this.llm.chatStream({
        messages: [
          { role: "system", content: fallbackSystem },
          { role: "user", content: question },
        ],
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk.content) {
          streamedChunks.push({ type: "token", content: chunk.content });
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.promptTokens ?? promptTokens;
          completionTokens = chunk.usage.completionTokens ?? completionTokens;
        }
      }
    } catch (err) {
      streamError = err;
    }
    if (streamError) {
      const errMsg = (streamError as Error)?.message ?? "LLM upstream failed";
      this.prom.ragRequestsTotal.inc({ isAnswered: "false", faqHit: "false" });
      await this.safeLog({
        query: question,
        isAnswered: false,
        faqHit: false,
        confidence: null,
        rejectReason: "llm_error",
        retrievedTopK: [],
        rerankedTopK: null,
        latencyMs: Date.now() - start,
        sessionId,
        errorMessage: errMsg,
      });
      endTimer();
      return {
        streamedChunks,
        yieldError: {
          type: "error",
          code: ErrorCode.RAG_LLM_UPSTREAM_ERROR,
          message: errMsg,
        },
        promptTokens: null,
        completionTokens: null,
      };
    }
    return {
      streamedChunks,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
    };
  }

  private answerCacheKey(question: string, visitorId?: string): string {
    const model = this.cfg.llmModel;
    const seed = visitorId ? `${question}::${visitorId}` : question;
    return `rag:ans:${model}:${sha1(seed)}`;
  }

  private async tryReadAnswerCache(key: string): Promise<CachedAnswer | null> {
    try {
      const v = await this.redis.getJson<CachedAnswer>(key);
      if (!v || typeof v.answer !== "string") return null;
      return v;
    } catch (err) {
      this.logger.warn(`answer cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async safeWriteAnswerCache(
    key: string,
    value: CachedAnswer,
  ): Promise<void> {
    try {
      await this.redis.setJson(key, value, this.cfg.rag.cacheTtl);
    } catch (err) {
      this.logger.warn(`answer cache write failed: ${(err as Error).message}`);
    }
  }

  private async safeLog(input: {
    query: string;
    isAnswered: boolean;
    faqHit: boolean;
    confidence: number | null;
    rejectReason: string | null;
    retrievedTopK: RetrievedChunk[] | RagSourceItem[];
    rerankedTopK: RetrievedChunk[] | null;
    latencyMs: number;
    sessionId: string | undefined;
    errorMessage: string | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
  }): Promise<string | null> {
    try {
      const row = await this.prisma.ragLog.create({
        data: {
          query: input.query,
          isAnswered: input.isAnswered,
          faqHit: input.faqHit,
          confidence: input.confidence ?? null,
          retrievedTopK:
            input.retrievedTopK as unknown as Prisma.InputJsonValue,
          rerankedTopK: (input.rerankedTopK ??
            null) as unknown as Prisma.InputJsonValue,
          rejectReason: input.rejectReason,
          promptTokens: input.promptTokens ?? null,
          completionTokens: input.completionTokens ?? null,
          latencyMs: Math.max(0, Math.floor(input.latencyMs)),
          llmProvider: this.cfg.llmProvider,
          embeddingModel: this.cfg.embeddingModel,
          rerankModel: this.cfg.rerankModel,
          sessionId: input.sessionId ?? null,
        },
      });
      return row.id;
    } catch (err) {
      this.logger.warn(`RagLog persist failed: ${(err as Error).message}`);
      return null;
    }
  }
}
