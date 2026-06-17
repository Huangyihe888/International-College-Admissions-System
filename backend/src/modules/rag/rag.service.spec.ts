/**
 * RagService 单元测试
 * 覆盖:禁答 / FAQ / 向量召回 / rerank / cache / LLM 错误 等核心 pipeline 分支。
 * 外部依赖全部 mock。
 */
import { RagService } from "./rag.service";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import type {
  ForbiddenCheckResult,
  RetrievedChunk,
  RagChunk,
  RagSourceItem,
} from "./types";

jest.mock("prom-client", () => {
  class Counter {
    inc = jest.fn();
  }
  class Histogram {
    startTimer = jest.fn().mockReturnValue(jest.fn());
  }
  return {
    Counter,
    Histogram,
    Registry: class {
      metrics = jest.fn().mockResolvedValue("");
      contentType = "";
    },
    collectDefaultMetrics: jest.fn(),
  };
});

function makeDeps() {
  const prisma = {
    knowledgeBaseVersion: { findFirst: jest.fn() },
    ragLog: { create: jest.fn().mockResolvedValue(undefined) },
  } as any;
  const cfg = {
    llmModel: "m",
    llmProvider: "qwen",
    embeddingModel: "emb-m",
    rerankModel: "rerank-m",
    rag: {
      topK: 3,
      rerankTopK: 3,
      faqThreshold: 0.8,
      rejectThreshold: 0.5,
      maxContextTokens: 2048,
      cacheTtl: 60,
      noAnswerText: "暂时无法从知识库中找到依据，建议加入咨询群：{QR_URL}",
      noAnswerQrUrl: "https://example.com/qrcode",
    },
  } as any;
  const llm = { chatStream: jest.fn() } as any;
  const rerankSvc = { rerank: jest.fn() } as any;
  const redis = { getJson: jest.fn(), setJson: jest.fn() } as any;
  const prom = {
    ragLatency: { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    ragRequestsTotal: { inc: jest.fn() },
  } as any;
  const forbid = { check: jest.fn() } as any;
  const faqRecall = { recall: jest.fn() } as any;
  const vectorRecall = { recall: jest.fn() } as any;
  const promptBuilder = { build: jest.fn() } as any;

  const svc = new RagService(
    prisma,
    cfg,
    llm,
    rerankSvc,
    redis,
    prom,
    forbid,
    faqRecall,
    vectorRecall,
    promptBuilder,
  );
  return {
    svc,
    prisma,
    cfg,
    llm,
    rerankSvc,
    redis,
    prom,
    forbid,
    faqRecall,
    vectorRecall,
    promptBuilder,
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

function kbRow() {
  return { id: "kb-active", isActive: true, activatedAt: new Date() };
}

function chunkRow(over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "c1",
    documentId: "d1",
    content: "内容片段 1",
    index: 0,
    filename: "doc.pdf",
    score: 0.9,
    ...over,
  };
}

describe("RagService.answerStream", () => {
  it("禁答命中:error chunk + RagLog(isAnswered=false)", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: true,
      ruleId: "r1",
      ruleName: "politics",
      reply: "请换个问题",
    } as ForbiddenCheckResult);

    const out = await collect(
      d.svc.answerStream({ question: "sensitive question", sessionId: "s1" }),
    );

    // 期望 chunks: 单个 error
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "error",
      code: ErrorCode.RAG_FORBIDDEN_HIT,
      message: "请换个问题",
    });
    // RagLog 写入
    expect(d.prisma.ragLog.create).toHaveBeenCalledTimes(1);
    const arg = d.prisma.ragLog.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      isAnswered: false,
      faqHit: false,
      sessionId: "s1",
    });
    expect(arg.data.rejectReason).toMatch(/^forbidden:/);
    // ragRequestsTotal 累加 isAnswered=false
    expect(d.prom.ragRequestsTotal.inc).toHaveBeenCalledWith({
      isAnswered: "false",
      faqHit: "false",
    });
  });

  it("FAQ 命中:不调 LLM,直接 yield token+sources+done(faqHit=true)", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: false,
    } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValueOnce(kbRow());
    d.faqRecall.recall.mockResolvedValueOnce({
      faqId: "f1",
      question: "学费多少",
      answer: "5000 元/年",
      score: 0.95,
    });

    const out = await collect(d.svc.answerStream({ question: "学费多少" }));

    expect(d.llm.chatStream).not.toHaveBeenCalled();
    expect(d.vectorRecall.recall).not.toHaveBeenCalled();
    // 3 chunk: token / sources / done
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: "token", content: "5000 元/年" });
    expect(out[1]).toMatchObject({
      type: "sources",
      items: [{ type: "faq", id: "f1", content: "学费多少", score: 0.95 }],
    });
    expect(out[2]).toMatchObject({
      type: "done",
      confidence: 0.95,
      faqHit: true,
    });
    // 写答案缓存
    expect(d.redis.setJson).toHaveBeenCalledTimes(1);
    // RagLog isAnswered=true, faqHit=true
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.isAnswered).toBe(true);
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.faqHit).toBe(true);
  });

  it("向量召回为空:返回 no-answer 文案,log rejectReason=no_relevant_context", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: false,
    } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValueOnce(kbRow());
    d.faqRecall.recall.mockResolvedValueOnce(null);
    d.vectorRecall.recall.mockResolvedValueOnce([]);

    const out = await collect(d.svc.answerStream({ question: "q" }));

    expect(d.llm.chatStream).not.toHaveBeenCalled();
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      type: "token",
      content: expect.stringContaining("加入咨询群"),
    });
    expect(out[1]).toEqual({ type: "sources", items: [] });
    expect(out[2]).toMatchObject({ type: "done", fallback: true, faqHit: false });
    const logArg = d.prisma.ragLog.create.mock.calls[0][0];
    expect(logArg.data).toMatchObject({
      isAnswered: false,
      rejectReason: "no_relevant_context",
    });
  });

  it("rerank 后最高分 < rejectThreshold:返回 no-answer 文案,log rejectReason=low_confidence", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: false,
    } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValueOnce(kbRow());
    d.faqRecall.recall.mockResolvedValueOnce(null);
    d.vectorRecall.recall.mockResolvedValueOnce([chunkRow({ score: 0.6 })]);
    // rerank 返回低分
    d.rerankSvc.rerank.mockResolvedValueOnce({
      model: "r-m",
      results: [{ index: 0, score: 0.3, document: "内容片段 1" }],
    });
    // 拒答阈值 0.5

    const out = await collect(d.svc.answerStream({ question: "q" }));

    expect(d.llm.chatStream).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({
      type: "token",
      content: expect.stringContaining("加入咨询群"),
    });
    expect(out[1]).toEqual({ type: "sources", items: [] });
    expect(out[2]).toMatchObject({
      type: "done",
      fallback: true,
      faqHit: false,
    });
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.rejectReason).toBe(
      "low_confidence",
    );
  });

  it("rerank 抛错:yield error chunk,rejectReason=rerank_failed", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: false,
    } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValueOnce(kbRow());
    d.faqRecall.recall.mockResolvedValueOnce(null);
    d.vectorRecall.recall.mockResolvedValueOnce([chunkRow()]);
    d.rerankSvc.rerank.mockRejectedValueOnce(new Error("upstream 500"));

    const out = await collect(d.svc.answerStream({ question: "q" }));

    expect(out[0]).toMatchObject({
      type: "error",
      code: ErrorCode.RAG_RERANK_FAILED,
      message: "upstream 500",
    });
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.rejectReason).toBe(
      "rerank_failed",
    );
  });

  it("完整 pipeline:vector → rerank → LLM → sources → done", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: false,
    } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValueOnce(kbRow());
    d.faqRecall.recall.mockResolvedValueOnce(null);
    d.vectorRecall.recall.mockResolvedValueOnce([
      chunkRow({ chunkId: "c1", content: "A" }),
      chunkRow({ chunkId: "c2", content: "B" }),
    ]);
    d.rerankSvc.rerank.mockResolvedValueOnce({
      model: "r-m",
      results: [
        { index: 0, score: 0.9, document: "A" },
        { index: 1, score: 0.7, document: "B" },
      ],
    });
    d.promptBuilder.build.mockReturnValueOnce({ system: "S", user: "U" });
    async function* stream(): AsyncIterable<{
      content: string;
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    }> {
      yield { content: "你好" };
      yield { content: "，欢迎" };
      yield {
        content: "。",
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      };
    }
    d.llm.chatStream.mockReturnValueOnce(stream());

    const out = await collect(
      d.svc.answerStream({ question: "q", sessionId: "s1" }),
    );

    // 收集的 token / sources / done
    const tokens = out.filter((c) => c.type === "token") as Array<{
      type: "token";
      content: string;
    }>;
    expect(tokens.map((t) => t.content).join("")).toBe("你好，欢迎。");
    const sources = out.find((c) => c.type === "sources") as
      | { type: "sources"; items: RagSourceItem[] }
      | undefined;
    expect(sources?.items).toHaveLength(2);
    expect(sources?.items[0]).toMatchObject({ type: "chunk", id: "c1" });
    const done = out.find((c) => c.type === "done") as
      | { type: "done"; confidence: number; faqHit: boolean }
      | undefined;
    expect(done?.confidence).toBeCloseTo(0.9, 5);
    expect(done?.faqHit).toBe(false);

    // 缓存写入
    expect(d.redis.setJson).toHaveBeenCalledTimes(1);
    // RagLog isAnswered=true
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.isAnswered).toBe(true);
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.promptTokens).toBe(5);
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.completionTokens).toBe(
      3,
    );
  });

  it("缓存命中:yield done.cached=true,不调下游", async () => {
    const d = makeDeps();
    const cached = {
      answer: "cache-hello",
      sources: [{ type: "chunk" as const, id: "c1", content: "s", score: 0.9 }],
      confidence: 0.91,
      faqHit: false,
      storedAt: 100,
    };
    d.redis.getJson.mockResolvedValueOnce(cached);

    const out = await collect(
      d.svc.answerStream({ question: "q", visitorId: "v1" }),
    );

    // 3 chunks: token / sources / done(cached=true)
    expect(out[0]).toMatchObject({ type: "token", content: "cache-hello" });
    expect(out[1]).toMatchObject({ type: "sources" });
    expect(out[2]).toMatchObject({
      type: "done",
      confidence: 0.91,
      faqHit: false,
      cached: true,
    });
    // 下游都没被调用
    expect(d.forbid.check).not.toHaveBeenCalled();
    expect(d.faqRecall.recall).not.toHaveBeenCalled();
    expect(d.vectorRecall.recall).not.toHaveBeenCalled();
    expect(d.llm.chatStream).not.toHaveBeenCalled();
  });

  it("LLM 抛错:yield error chunk + 写 log rejectReason=llm_error", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValueOnce({
      hit: false,
    } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValueOnce(kbRow());
    d.faqRecall.recall.mockResolvedValueOnce(null);
    d.vectorRecall.recall.mockResolvedValueOnce([chunkRow()]);
    d.rerankSvc.rerank.mockResolvedValueOnce({
      model: "r-m",
      results: [{ index: 0, score: 0.9, document: "内容片段 1" }],
    });
    d.promptBuilder.build.mockReturnValueOnce({ system: "S", user: "U" });
    d.llm.chatStream.mockImplementationOnce(() => {
      throw new BusinessException({
        code: ErrorCode.RAG_LLM_UPSTREAM_ERROR,
        message: "upstream 500",
      });
    });

    const out = await collect(d.svc.answerStream({ question: "q" }));

    const errChunk = out.find((c) => c.type === "error") as
      | { type: "error"; code: number; message: string }
      | undefined;
    expect(errChunk).toBeDefined();
    expect(errChunk!.code).toBe(ErrorCode.RAG_LLM_UPSTREAM_ERROR);
    expect(d.prisma.ragLog.create.mock.calls[0][0].data.rejectReason).toBe(
      "llm_error",
    );
  });

  it("问题为空:yield error(VALIDATION_FAILED) 后立即返回", async () => {
    const d = makeDeps();
    const out = await collect(d.svc.answerStream({ question: "   " }));
    expect(out).toEqual([
      {
        type: "error",
        code: ErrorCode.VALIDATION_FAILED,
        message: "question is required",
      },
    ]);
    // 不该触达任何下游
    expect(d.forbid.check).not.toHaveBeenCalled();
  });

  it("answer() 包装器:无相关内容时返回 no-answer 文案", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValue({ hit: false } as ForbiddenCheckResult);
    d.prisma.knowledgeBaseVersion.findFirst.mockResolvedValue(kbRow());
    d.faqRecall.recall.mockResolvedValue(null);
    d.vectorRecall.recall.mockResolvedValue([]);

    const res = await d.svc.answer({ question: "q" });
    expect(res.answer).toContain("加入咨询群");
    expect(res.sources).toEqual([]);
  });

  it("answer() 包装器:error chunk 转抛 BusinessException", async () => {
    const d = makeDeps();
    d.forbid.check.mockResolvedValue({
      hit: true,
      ruleName: "r",
      reply: "请换个问题",
    } as ForbiddenCheckResult);

    await expect(d.svc.answer({ question: "q" })).rejects.toMatchObject({
      code: ErrorCode.RAG_FORBIDDEN_HIT,
      message: "请换个问题",
    });
  });
});
