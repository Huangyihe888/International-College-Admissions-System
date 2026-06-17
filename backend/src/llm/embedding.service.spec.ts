/**
 * EmbeddingService 单元测试
 * 覆盖:缓存命中/未命中、批处理、retry、cache key 格式。
 * 外部依赖 OpenAiCompatibleProvider、RedisService、PromService、TypedConfigService 全部 mock。
 */
import { EmbeddingService } from "./embedding.service";
import { BusinessException } from "../common/errors/business.exception";
import { ErrorCode } from "../common/errors/error-code";
import { createHash } from "node:crypto";
import type { EmbeddingResponse, EmbeddingItem } from "./types";

// mock OpenAiCompatibleProvider
jest.mock("./providers/openai-compatible.provider", () => ({
  OpenAiCompatibleProvider: jest.fn().mockImplementation(() => ({
    embed: jest.fn(),
  })),
  UpstreamError: class UpstreamError extends Error {
    status?: number;
    body?: unknown;
    code?: string;
  },
}));

// mock prom-client
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

function makeUpstream(message: string, status?: number, code?: string): Error {
  const e: any = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function makeEmbedResponse(items: EmbeddingItem[]): EmbeddingResponse {
  return {
    items,
    model: "m",
    dim: 4,
    usage: { promptTokens: 1, totalTokens: 1 },
  };
}

function makeCfg(
  over: Partial<{
    embeddingApiKey: string;
    embeddingBaseUrl: string;
    embeddingModel: string;
    embeddingDim: number;
    embeddingBatchSize: number;
    llmTimeoutMs: number;
    cacheTtl: number;
  }> = {},
) {
  const s = {
    embeddingApiKey: "k",
    embeddingBaseUrl: "http://embed",
    embeddingModel: "emb-m",
    embeddingDim: 4,
    embeddingBatchSize: 4,
    llmTimeoutMs: 1000,
    cacheTtl: 60,
    ...over,
  };
  return {
    embeddingApiKey: s.embeddingApiKey,
    embeddingBaseUrl: s.embeddingBaseUrl,
    embeddingModel: s.embeddingModel,
    embeddingDim: s.embeddingDim,
    embeddingBatchSize: s.embeddingBatchSize,
    llmTimeoutMs: s.llmTimeoutMs,
    rag: { cacheTtl: s.cacheTtl },
  } as any;
}

function makeService(opts: Parameters<typeof makeCfg>[0] = {}) {
  const cfg = makeCfg(opts);
  const redis = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  } as any;
  const provider = { embed: jest.fn() } as any;
  const prom = {
    llmRequestDuration: { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    llmTokensTotal: { inc: jest.fn() },
    llmErrorsTotal: { inc: jest.fn() },
  } as any;
  const svc = new EmbeddingService(cfg, redis, provider, prom);
  return { svc, cfg, redis, provider, prom };
}

function vec(seed: number, dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => seed + i * 0.01);
}

describe("EmbeddingService", () => {
  it("空输入:不查缓存/不调上游,直接返回空 items", async () => {
    const { svc, redis, provider } = makeService();
    const res = await svc.embed([]);
    expect(res.items).toEqual([]);
    expect(res.usage).toEqual({ promptTokens: 0, totalTokens: 0 });
    expect(redis.getJson).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("全缓存命中:不调上游,按原顺序返回", async () => {
    const { svc, redis, provider } = makeService({ embeddingDim: 4 });
    redis.getJson
      .mockResolvedValueOnce(vec(1, 4)) // idx 0
      .mockResolvedValueOnce(vec(2, 4)) // idx 1
      .mockResolvedValueOnce(vec(3, 4)); // idx 2

    const res = await svc.embed(["a", "b", "c"]);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(res.items.map((it) => it.embedding[0])).toEqual([1, 2, 3]);
    // 全部命中,usage 应当为 0
    expect(res.usage).toEqual({ promptTokens: 0, totalTokens: 0 });
  });

  it("全缓存未命中:走上游,并按原顺序写回缓存", async () => {
    const { svc, redis, provider } = makeService({ embeddingDim: 4 });
    redis.getJson.mockResolvedValue(null);
    provider.embed.mockResolvedValueOnce(
      makeEmbedResponse([
        { index: 0, embedding: vec(10, 4) },
        { index: 1, embedding: vec(20, 4) },
      ]),
    );

    const res = await svc.embed(["x", "y"]);

    expect(provider.embed).toHaveBeenCalledTimes(1);
    // 写回缓存:按原文本数
    expect(redis.setJson).toHaveBeenCalledTimes(2);
    expect(res.items[0].embedding[0]).toBe(10);
    expect(res.items[1].embedding[0]).toBe(20);
  });

  it("部分命中:hit 与 miss 按原 input 顺序合并", async () => {
    const { svc, redis, provider } = makeService({ embeddingDim: 4 });
    // 0 命中, 1 未命中, 2 命中
    redis.getJson
      .mockResolvedValueOnce(vec(100, 4))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(vec(300, 4));
    // 上游只处理 miss(索引 1 那个)
    provider.embed.mockResolvedValueOnce(
      makeEmbedResponse([{ index: 0, embedding: vec(200, 4) }]),
    );

    const res = await svc.embed(["t0", "t1", "t2"]);

    expect(provider.embed).toHaveBeenCalledTimes(1);
    // provider.embed 收到的 texts 应当只含 't1'
    const passedTexts = provider.embed.mock.calls[0][1];
    expect(passedTexts).toEqual(["t1"]);

    // 输出顺序 t0, t1, t2
    expect(res.items.map((it) => it.embedding[0])).toEqual([100, 200, 300]);
    // 写回缓存:只对 miss 写
    expect(redis.setJson).toHaveBeenCalledTimes(1);
  });

  it("批处理超 batchSize:按 batchSize 切片多次调用上游", async () => {
    const { svc, redis, provider } = makeService({
      embeddingDim: 4,
      embeddingBatchSize: 3,
    });
    redis.getJson.mockResolvedValue(null);
    // 7 个文本,batchSize=3 → 3 + 3 + 1 三次调用
    provider.embed
      .mockResolvedValueOnce(
        makeEmbedResponse([
          { index: 0, embedding: vec(1, 4) },
          { index: 1, embedding: vec(2, 4) },
          { index: 2, embedding: vec(3, 4) },
        ]),
      )
      .mockResolvedValueOnce(
        makeEmbedResponse([
          { index: 0, embedding: vec(4, 4) },
          { index: 1, embedding: vec(5, 4) },
          { index: 2, embedding: vec(6, 4) },
        ]),
      )
      .mockResolvedValueOnce(
        makeEmbedResponse([{ index: 0, embedding: vec(7, 4) }]),
      );

    const texts = ["a", "b", "c", "d", "e", "f", "g"];
    const res = await svc.embed(texts);

    expect(provider.embed).toHaveBeenCalledTimes(3);
    expect(provider.embed.mock.calls[0][1]).toEqual(["a", "b", "c"]);
    expect(provider.embed.mock.calls[1][1]).toEqual(["d", "e", "f"]);
    expect(provider.embed.mock.calls[2][1]).toEqual(["g"]);
    expect(res.items).toHaveLength(7);
    expect(res.items[6].embedding[0]).toBe(7);
  });

  it("重试 3 次:前两次 5xx,第三次成功", async () => {
    const { svc, redis, provider, prom } = makeService({ embeddingDim: 4 });
    redis.getJson.mockResolvedValue(null);
    provider.embed
      .mockRejectedValueOnce(makeUpstream("Upstream HTTP 500", 500))
      .mockRejectedValueOnce(makeUpstream("Upstream HTTP 502", 502))
      .mockResolvedValueOnce(
        makeEmbedResponse([{ index: 0, embedding: vec(1, 4) }]),
      );

    const res = await svc.embed(["one-text"]);

    expect(provider.embed).toHaveBeenCalledTimes(3);
    expect(res.items[0].embedding[0]).toBe(1);
    // error 指标累加 2 次(前两次失败)
    expect(prom.llmErrorsTotal.inc).toHaveBeenCalledTimes(2);
  });

  it("重试 3 次全部失败:抛 BusinessException,error 指标累加 3 次", async () => {
    const { svc, redis, provider, prom } = makeService({ embeddingDim: 4 });
    redis.getJson.mockResolvedValue(null);
    // mockRejectedValue 对每次调用都生效
    provider.embed.mockRejectedValue(makeUpstream("Upstream HTTP 500", 500));

    let caught: unknown;
    try {
      await svc.embed(["boom"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BusinessException);
    expect((caught as BusinessException).code).toBe(
      ErrorCode.RAG_EMBEDDING_FAILED,
    );
    // 单次 embed 失败 → error 指标累加 3 次
    expect(prom.llmErrorsTotal.inc).toHaveBeenCalledTimes(3);
    expect(provider.embed).toHaveBeenCalledTimes(3);
  });

  it("重试用尽时为 timeout:抛 UPSTREAM_TIMEOUT", async () => {
    const { svc, redis, provider } = makeService({ embeddingDim: 4 });
    redis.getJson.mockResolvedValue(null);
    provider.embed.mockRejectedValue(
      makeUpstream("timeout exceeded", undefined, "ECONNABORTED"),
    );

    await expect(svc.embed(["slow"])).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
  });

  it("4xx 错误不重试:一次失败后直接抛", async () => {
    const { svc, redis, provider, prom } = makeService({ embeddingDim: 4 });
    redis.getJson.mockResolvedValue(null);
    provider.embed.mockRejectedValue(makeUpstream("Upstream HTTP 400", 400));

    await expect(svc.embed(["bad"])).rejects.toBeInstanceOf(BusinessException);
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(prom.llmErrorsTotal.inc).toHaveBeenCalledTimes(1);
  });

  it("缓存 key 格式:emb:<model>:<sha1(text)>", async () => {
    const { svc, redis, provider } = makeService({ embeddingDim: 4 });
    redis.getJson.mockResolvedValue(null);
    provider.embed.mockResolvedValueOnce(
      makeEmbedResponse([{ index: 0, embedding: vec(9, 4) }]),
    );

    await svc.embed(["hello"]);

    const expectedKey = `emb:emb-m:${createHash("sha1").update("hello").digest("hex")}`;
    expect(redis.getJson).toHaveBeenCalledWith(expectedKey);
    // 写回时也用相同 key
    expect(redis.setJson).toHaveBeenCalledWith(
      expectedKey,
      vec(9, 4),
      60, // cacheTtl
    );
  });

  it("不同 model 的 cache key 不会串", async () => {
    const { svc, redis } = makeService({
      embeddingModel: "other-model",
      embeddingDim: 4,
    });
    redis.getJson.mockResolvedValue(vec(1, 4));
    await svc.embed(["x"]);
    const key = redis.getJson.mock.calls[0][0];
    expect(key.startsWith("emb:other-model:")).toBe(true);
  });
});
