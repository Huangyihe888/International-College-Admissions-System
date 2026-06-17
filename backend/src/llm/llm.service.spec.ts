/**
 * LlmService 单元测试
 * 覆盖 chat / chatStream 的主流程与失败转移(provider failover)。
 * 外部依赖 OpenAiCompatibleProvider、TypedConfigService、PromService 全部 mock。
 */
import { LlmService } from "./llm.service";
import { BusinessException } from "../common/errors/business.exception";
import { ErrorCode } from "../common/errors/error-code";
import type { ChatResponse, ChatChunk, LlmProviderConfig } from "./types";
import type { UpstreamError } from "./providers/openai-compatible.provider";

// mock 掉 OpenAiCompatibleProvider(实际由 LlmService 调用,本 spec 不验证其内部逻辑)
jest.mock("./providers/openai-compatible.provider", () => ({
  OpenAiCompatibleProvider: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    chatStream: jest.fn(),
    embed: jest.fn(),
  })),
  UpstreamError: class UpstreamError extends Error {
    status?: number;
    body?: unknown;
    code?: string;
  },
}));

// mock 掉 prom-client 的 metric 实例,只保留方法
jest.mock("prom-client", () => {
  class Counter {
    inc = jest.fn();
    labels = jest.fn().mockReturnThis();
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

function makeUpstreamError(
  message: string,
  status?: number,
  body?: unknown,
  code?: string,
): UpstreamError {
  const err: UpstreamError = new Error(message) as UpstreamError;
  err.status = status;
  err.body = body;
  err.code = code;
  return err;
}

function makeChatResponse(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    content: "hello",
    finishReason: "stop",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "m",
    provider: "qwen",
    ...overrides,
  };
}

function makeCfg(
  over: Partial<{
    llmProvider: string;
    llmFallbackProviders: string[];
    llmApiKey: string;
    llmBaseUrl: string;
    llmModel: string;
    llmTimeoutMs: number;
    llmTemperature: number;
    llmMaxTokens: number;
  }> = {},
) {
  const state = {
    llmProvider: "qwen" as string,
    llmFallbackProviders: [] as string[],
    llmApiKey: "k",
    llmBaseUrl: "http://llm.local",
    llmModel: "m",
    llmTimeoutMs: 1000,
    llmTemperature: 0.7,
    llmMaxTokens: 1024,
    ...over,
  };
  return {
    llmProvider: state.llmProvider,
    llmFallbackProviders: state.llmFallbackProviders,
    llmApiKey: state.llmApiKey,
    llmBaseUrl: state.llmBaseUrl,
    llmModel: state.llmModel,
    llmTimeoutMs: state.llmTimeoutMs,
    llmTemperature: state.llmTemperature,
    llmMaxTokens: state.llmMaxTokens,
  } as any;
}

function makeService(over: Parameters<typeof makeCfg>[0] = {}) {
  const cfg = makeCfg(over);
  const prom = {
    llmRequestDuration: { startTimer: jest.fn().mockReturnValue(jest.fn()) },
    llmTokensTotal: { inc: jest.fn() },
    llmErrorsTotal: { inc: jest.fn() },
  } as any;
  const provider = {
    chat: jest.fn(),
    chatStream: jest.fn(),
    embed: jest.fn(),
  } as any;
  const svc = new LlmService(cfg, provider, prom);
  return { svc, cfg, prom, provider };
}

describe("LlmService", () => {
  describe("chat", () => {
    it("chat 正常路径:返回 provider 结果并累计 token 指标", async () => {
      const { svc, provider, prom } = makeService();
      const ok = makeChatResponse({
        content: "hi",
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      });
      provider.chat.mockResolvedValueOnce(ok);

      const res = await svc.chat({
        messages: [{ role: "user", content: "q" }],
      });

      expect(res).toBe(ok);
      expect(provider.chat).toHaveBeenCalledTimes(1);
      // 确认 primary provider='qwen'
      expect(provider.chat.mock.calls[0][0]).toBe("qwen");
      expect(prom.llmTokensTotal.inc).toHaveBeenCalledWith(
        { provider: "qwen", model: ok.model, kind: "prompt" },
        4,
      );
      expect(prom.llmTokensTotal.inc).toHaveBeenCalledWith(
        { provider: "qwen", model: ok.model, kind: "completion" },
        6,
      );
    });

    it("chat 4xx 不触发 fallback:直接抛 BusinessException", async () => {
      const { svc, provider } = makeService({
        llmProvider: "qwen",
        llmFallbackProviders: ["deepseek"],
      });
      const err = makeUpstreamError("Upstream HTTP 400", 400, {
        message: "bad request",
      });
      provider.chat.mockRejectedValueOnce(err);

      await expect(
        svc.chat({ messages: [{ role: "user", content: "q" }] }),
      ).rejects.toBeInstanceOf(BusinessException);
      // fallback 不应被尝试
      expect(provider.chat).toHaveBeenCalledTimes(1);
    });

    it("chat 5xx 走 fallback:primary 抛 500,fallback 成功", async () => {
      const { svc, provider, prom } = makeService({
        llmProvider: "qwen",
        llmFallbackProviders: ["deepseek"],
      });
      const err5xx = makeUpstreamError("Upstream HTTP 500", 500, {
        error: "oops",
      });
      const ok = makeChatResponse({ provider: "deepseek", model: "d-m" });
      let n = 0;
      provider.chat.mockImplementation((_p: any) => {
        n++;
        return n === 1 ? Promise.reject(err5xx) : Promise.resolve(ok);
      });

      const res = await svc.chat({
        messages: [{ role: "user", content: "q" }],
      });

      expect(res).toBe(ok);
      expect(provider.chat).toHaveBeenCalledTimes(2);
      expect(provider.chat.mock.calls[0][0]).toBe("qwen");
      expect(provider.chat.mock.calls[1][0]).toBe("deepseek");
      expect(prom.llmErrorsTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "qwen", code: "500" }),
      );
    });

    it("chat 全部 provider 失败:抛 BusinessException 并累加 error metric", async () => {
      const { svc, provider, prom } = makeService({
        llmProvider: "qwen",
        llmFallbackProviders: ["deepseek", "openai"],
      });
      const err5xx = makeUpstreamError("Upstream HTTP 500", 500);
      const err429 = makeUpstreamError("Upstream HTTP 429", 429);
      const errTimeout = makeUpstreamError(
        "timeout",
        undefined,
        undefined,
        "ECONNABORTED",
      );
      provider.chat.mockRejectedValueOnce(err5xx);
      provider.chat.mockRejectedValueOnce(err429);
      provider.chat.mockRejectedValueOnce(errTimeout);

      await expect(
        svc.chat({ messages: [{ role: "user", content: "q" }] }),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(provider.chat).toHaveBeenCalledTimes(3);
      expect(prom.llmErrorsTotal.inc).toHaveBeenCalledTimes(3);
    });

    it("chain 内含非法 provider:不会在 chain 里出现(被 filter 剔除)", async () => {
      // 验证 buildProviderChain 的过滤逻辑:
      // primary='qwen' + fallbacks=['invalid', 'deepseek'] => chain=['qwen','deepseek']
      const cfg = makeCfg({
        llmProvider: "qwen",
        llmFallbackProviders: ["invalid", "deepseek"],
      });
      const prom = {
        llmRequestDuration: {
          startTimer: jest.fn().mockReturnValue(jest.fn()),
        },
        llmTokensTotal: { inc: jest.fn() },
        llmErrorsTotal: { inc: jest.fn() },
      } as any;
      const provider = {
        chat: jest.fn(),
        chatStream: jest.fn(),
        embed: jest.fn(),
      } as any;
      const svc = new LlmService(cfg, provider, prom);
      provider.chat
        .mockImplementationOnce(() =>
          Promise.reject(makeUpstreamError("500", 500)),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(makeChatResponse({ provider: "deepseek" })),
        );

      await svc.chat({ messages: [{ role: "user", content: "q" }] });

      const calls = provider.chat.mock.calls.map((c: unknown[]) => c[0]);
      // 只调 qwen 和 deepseek;非法值 'invalid' 被剔除
      expect(calls).toEqual(["qwen", "deepseek"]);
    });
  });

  describe("chatStream", () => {
    it("chatStream 正常:3 chunk + usage 累计 metrics", async () => {
      const { svc, provider, prom } = makeService({ llmProvider: "qwen" });
      async function* stream(): AsyncIterable<ChatChunk> {
        yield { content: "A" };
        yield { content: "B" };
        yield {
          content: "C",
          usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
        };
      }
      provider.chatStream.mockReturnValueOnce(stream());

      const out: ChatChunk[] = [];
      for await (const c of svc.chatStream({
        messages: [{ role: "user", content: "q" }],
      })) {
        out.push(c);
      }

      expect(out.map((c) => c.content)).toEqual(["A", "B", "C"]);
      // 3 次 inc(prompt 0/0/3, completion 0/0/2) — 第一次 inc 是 prompt=0
      expect(prom.llmTokensTotal.inc).toHaveBeenCalledWith(
        { provider: "qwen", model: "m", kind: "prompt" },
        3,
      );
      expect(prom.llmTokensTotal.inc).toHaveBeenCalledWith(
        { provider: "qwen", model: "m", kind: "completion" },
        2,
      );
    });

    it("chatStream mid-stream 失败:consumed=true 后触发 fallback", async () => {
      const { svc, provider, prom } = makeService({
        llmProvider: "qwen",
        llmFallbackProviders: ["deepseek"],
      });
      async function* failStream(): AsyncIterable<ChatChunk> {
        yield { content: "X" };
        throw makeUpstreamError("stream broken", 500);
      }
      async function* okStream(): AsyncIterable<ChatChunk> {
        yield { content: "Y" };
      }
      provider.chatStream.mockReturnValueOnce(failStream());
      provider.chatStream.mockReturnValueOnce(okStream());

      const out: ChatChunk[] = [];
      for await (const c of svc.chatStream({
        messages: [{ role: "user", content: "q" }],
      })) {
        out.push(c);
      }
      // LlmService 在迭代第一个流时已经 yield 了 'X'(consumed=true);
      // failover 后的流继续 yield 'Y'。验证两个 chunk 都被 caller 收到,
      // 关键确认 2 次 chatStream 调用 + 一次 5xx error metric
      expect(out.map((c) => c.content)).toEqual(["X", "Y"]);
      expect(provider.chatStream).toHaveBeenCalledTimes(2);
      expect(prom.llmErrorsTotal.inc).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "qwen", code: "500" }),
      );
    });

    it("chatStream 4xx 不重试:立即抛 BusinessException", async () => {
      const { svc, provider } = makeService({
        llmProvider: "qwen",
        llmFallbackProviders: ["deepseek"],
      });
      async function* bad(): AsyncIterable<ChatChunk> {
        yield { content: "1" };
      }
      // 在第一次 for await 内部抛错(模拟流式响应先 yield 再 4xx 错误)
      provider.chatStream.mockImplementationOnce(async function* () {
        yield { content: "1" };
        throw makeUpstreamError("Upstream HTTP 400", 400);
      });
      await expect(
        (async () => {
          for await (const _c of svc.chatStream({
            messages: [{ role: "user", content: "q" }],
          })) {
            // 消费
          }
        })(),
      ).rejects.toBeInstanceOf(BusinessException);
      // 4xx 不走 fallback
      expect(provider.chatStream).toHaveBeenCalledTimes(1);
      // 静默 ts
      void bad;
    });
  });

  describe("buildProviderChain 与 provider 映射", () => {
    it("fallback 列表里非法值 / 与 primary 重复会被剔除", async () => {
      const { svc, provider } = makeService({
        llmProvider: "qwen",
        llmFallbackProviders: [
          "deepseek",
          "qwen",
          "invalid-provider",
          "openai",
        ],
      });
      // primary qwen 失败 -> deepseek 成功
      provider.chat
        .mockImplementationOnce(() =>
          Promise.reject(makeUpstreamError("500", 500)),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(makeChatResponse({ provider: "deepseek" })),
        );

      await svc.chat({ messages: [{ role: "user", content: "q" }] });

      // chain = qwen -> deepseek (openai 因为不必要不再被调)
      const calls = provider.chat.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toEqual(["qwen", "deepseek"]);
      // 至少确认不会调非法值
      expect(
        calls.every((p: string) =>
          ["qwen", "deepseek", "vllm", "openai"].includes(p),
        ),
      ).toBe(true);
    });

    it("PROVIDER_BASE_URL 映射:每个 provider 的 baseUrl 正确", async () => {
      // 通过注入 cfg.llmBaseUrl 配合 vllm,验证 LlmService 给 provider.chat 的 config.baseUrl
      const cases: Array<[string, (cfg: any) => string]> = [
        ["qwen", () => "https://dashscope.aliyuncs.com/compatible-mode"],
        ["deepseek", () => "https://api.deepseek.com"],
        ["vllm", (cfg) => cfg.llmBaseUrl],
        ["openai", () => "https://api.openai.com"],
      ];

      for (const [providerName, expectedFn] of cases) {
        const cfg = makeCfg({
          llmProvider: providerName as any,
          llmFallbackProviders: [],
        });
        const prom = {
          llmRequestDuration: {
            startTimer: jest.fn().mockReturnValue(jest.fn()),
          },
          llmTokensTotal: { inc: jest.fn() },
          llmErrorsTotal: { inc: jest.fn() },
        } as any;
        const provider = {
          chat: jest.fn(),
          chatStream: jest.fn(),
          embed: jest.fn(),
        } as any;
        const svc = new LlmService(cfg, provider, prom);
        provider.chat.mockResolvedValueOnce(
          makeChatResponse({ provider: providerName as any }),
        );

        await svc.chat({ messages: [{ role: "user", content: "q" }] });

        const passedConfig: LlmProviderConfig = provider.chat.mock.calls[0][1];
        expect(passedConfig.baseUrl).toBe(expectedFn(cfg));
        expect(passedConfig.provider).toBe(providerName);
        expect(passedConfig.apiKey).toBe("k");
        expect(passedConfig.model).toBe("m");
        expect(passedConfig.timeoutMs).toBe(1000);
      }
    });

    it("mergeDefaults 用 cfg 的 temperature/maxTokens 兜底", async () => {
      const { svc, provider } = makeService({
        llmTemperature: 0.3,
        llmMaxTokens: 256,
      });
      provider.chat.mockResolvedValueOnce(makeChatResponse());

      await svc.chat({ messages: [{ role: "user", content: "q" }] });

      // 第二个参数是 config,第三个是 merged options
      const passedOptions = provider.chat.mock.calls[0][2];
      expect(passedOptions.temperature).toBe(0.3);
      expect(passedOptions.maxTokens).toBe(256);
    });
  });
});
