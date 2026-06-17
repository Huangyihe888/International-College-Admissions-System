import { Injectable, Logger } from "@nestjs/common";
import { BusinessException } from "../common/errors/business.exception";
import { ErrorCode } from "../common/errors/error-code";
import { PromService } from "../common/metrics/prom.service";
import { TypedConfigService } from "../config/typed-config.service";
import {
  ChatChunk,
  ChatOptions,
  ChatResponse,
  LlmProvider,
  LlmProviderConfig,
} from "./types";
import {
  OpenAiCompatibleProvider,
  UpstreamError,
} from "./providers/openai-compatible.provider";

const PROVIDER_BASE_URL: Record<
  LlmProvider,
  (cfg: TypedConfigService) => string
> = {
  qwen: () => "https://dashscope.aliyuncs.com/compatible-mode",
  deepseek: () => "https://api.deepseek.com",
  vllm: (cfg) => cfg.llmBaseUrl,
  openai: () => "https://api.openai.com",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTimeoutLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return true;
  const msg = (err as { message?: string }).message?.toLowerCase() ?? "";
  return msg.includes("timeout") || msg.includes("aborted");
}

function shouldFailover(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (isTimeoutLike(err)) return true;
  const status = (err as UpstreamError).status;
  if (status === undefined) return true;
  if (status >= 500) return true;
  if (status === 429) return true;
  return false;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly cfg: TypedConfigService,
    private readonly provider: OpenAiCompatibleProvider,
    private readonly prom: PromService,
  ) {}

  private buildConfigFor(provider: LlmProvider): LlmProviderConfig {
    return {
      provider,
      apiKey: this.cfg.llmApiKey,
      baseUrl: PROVIDER_BASE_URL[provider](this.cfg),
      model: this.cfg.llmModel,
      timeoutMs: this.cfg.llmTimeoutMs,
    };
  }

  private mergeDefaults(options: ChatOptions): ChatOptions {
    return {
      ...options,
      temperature: options.temperature ?? this.cfg.llmTemperature,
      maxTokens: options.maxTokens ?? this.cfg.llmMaxTokens,
    };
  }

  private buildProviderChain(): LlmProvider[] {
    const primary = this.cfg.llmProvider;
    const fallbacks = this.cfg.llmFallbackProviders.filter(
      (p): p is LlmProvider =>
        p === "qwen" || p === "deepseek" || p === "vllm" || p === "openai",
    );
    return [primary, ...fallbacks.filter((p) => p !== primary)];
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const merged = this.mergeDefaults(options);
    const chain = this.buildProviderChain();
    if (chain.length === 0) {
      throw new BusinessException({
        code: ErrorCode.RAG_LLM_UPSTREAM_ERROR,
        message: "No LLM provider configured",
      });
    }
    let lastErr: unknown;
    for (const provider of chain) {
      const config = this.buildConfigFor(provider);
      const endTimer = this.prom.llmRequestDuration.startTimer({
        provider,
        model: config.model,
        kind: "chat",
      });
      try {
        const res = await this.provider.chat(provider, config, merged);
        endTimer();
        if (res.usage.totalTokens > 0) {
          this.prom.llmTokensTotal.inc(
            { provider, model: res.model, kind: "prompt" },
            res.usage.promptTokens,
          );
          this.prom.llmTokensTotal.inc(
            { provider, model: res.model, kind: "completion" },
            res.usage.completionTokens,
          );
        }
        if (provider !== chain[0]) {
          this.logger.warn(
            `LLM chat succeeded after failover to provider=${provider}`,
          );
        }
        return res;
      } catch (err) {
        lastErr = err;
        const status = (err as UpstreamError).status;
        this.prom.llmErrorsTotal.inc({
          provider,
          model: config.model,
          code: String(status ?? (err as { code?: string }).code ?? "unknown"),
        });
        endTimer();
        if (!shouldFailover(err)) {
          throw this.toBusiness(err);
        }
        this.logger.warn(
          `LLM chat provider=${provider} failed (status=${status ?? "-"}): ${(err as Error).message}; trying next`,
        );
      }
    }
    throw this.toBusiness(lastErr);
  }

  chatStream(options: ChatOptions): AsyncIterable<ChatChunk> {
    const merged = this.mergeDefaults(options);
    const chain = this.buildProviderChain();
    if (chain.length === 0) {
      throw new BusinessException({
        code: ErrorCode.RAG_LLM_UPSTREAM_ERROR,
        message: "No LLM provider configured",
      });
    }
    return this.streamWithFailover(merged, chain);
  }

  private async *streamWithFailover(
    options: ChatOptions,
    chain: LlmProvider[],
  ): AsyncIterable<ChatChunk> {
    let lastErr: unknown;
    for (const provider of chain) {
      const config = this.buildConfigFor(provider);
      const endTimer = this.prom.llmRequestDuration.startTimer({
        provider,
        model: config.model,
        kind: "chat_stream",
      });
      let consumed = false;
      try {
        const stream = this.provider.chatStream(provider, config, options);
        for await (const chunk of stream) {
          consumed = true;
          if (chunk.usage) {
            this.prom.llmTokensTotal.inc(
              { provider, model: config.model, kind: "prompt" },
              chunk.usage.promptTokens ?? 0,
            );
            this.prom.llmTokensTotal.inc(
              { provider, model: config.model, kind: "completion" },
              chunk.usage.completionTokens ?? 0,
            );
          }
          yield chunk;
        }
        if (provider !== chain[0]) {
          this.logger.warn(
            `LLM stream succeeded after failover to provider=${provider}`,
          );
        }
        return;
      } catch (err) {
        lastErr = err;
        const status = (err as UpstreamError).status;
        this.prom.llmErrorsTotal.inc({
          provider,
          model: config.model,
          code: String(status ?? (err as { code?: string }).code ?? "unknown"),
        });
        if (!shouldFailover(err)) {
          throw this.toBusiness(err);
        }
        this.logger.warn(
          `LLM stream provider=${provider} failed (status=${status ?? "-"}, consumed=${consumed}): ${(err as Error).message}; trying next`,
        );
      } finally {
        endTimer();
      }
    }
    throw this.toBusiness(lastErr);
  }

  private toBusiness(err: unknown): BusinessException {
    if (err instanceof BusinessException) return err;
    const status = (err as UpstreamError | undefined)?.status;
    const body = (err as UpstreamError | undefined)?.body;
    if (status === 408 || isTimeoutLike(err)) {
      return new BusinessException({
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: "LLM upstream timeout",
        cause: err,
      });
    }
    if (isRecord(body) && typeof body.message === "string") {
      return new BusinessException({
        code: ErrorCode.RAG_LLM_UPSTREAM_ERROR,
        message: body.message,
        cause: err,
      });
    }
    return new BusinessException({
      code: ErrorCode.RAG_LLM_UPSTREAM_ERROR,
      message: (err as Error)?.message ?? "LLM upstream failed",
      cause: err,
    });
  }
}
