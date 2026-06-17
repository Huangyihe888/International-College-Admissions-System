import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { BusinessException } from "../common/errors/business.exception";
import { ErrorCode } from "../common/errors/error-code";
import { PromService } from "../common/metrics/prom.service";
import { RedisService } from "../redis/redis.service";
import { TypedConfigService } from "../config/typed-config.service";
import { EmbeddingItem, EmbeddingResponse } from "./types";
import {
  OpenAiCompatibleProvider,
  UpstreamError,
} from "./providers/openai-compatible.provider";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

function hashKey(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return true;
  const msg = (err as { message?: string }).message?.toLowerCase() ?? "";
  return msg.includes("timeout") || msg.includes("aborted");
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (isTimeoutLike(err)) return true;
  const status = (err as UpstreamError).status;
  if (status === undefined) return true;
  if (status >= 500) return true;
  if (status === 429) return true;
  return false;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly cfg: TypedConfigService,
    private readonly redis: RedisService,
    private readonly provider: OpenAiCompatibleProvider,
    private readonly prom: PromService,
  ) {}

  private buildConfig() {
    return {
      apiKey: this.cfg.embeddingApiKey,
      baseUrl: this.cfg.embeddingBaseUrl,
      model: this.cfg.embeddingModel,
      dim: this.cfg.embeddingDim,
      batchSize: this.cfg.embeddingBatchSize,
      timeoutMs: this.cfg.llmTimeoutMs,
    };
  }

  private cacheKey(text: string): string {
    return `emb:${this.cfg.embeddingModel}:${hashKey(text)}`;
  }

  private cacheTtl(): number {
    return this.cfg.rag.cacheTtl;
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    if (texts.length === 0) {
      return {
        items: [],
        model: this.cfg.embeddingModel,
        dim: this.cfg.embeddingDim,
        usage: { promptTokens: 0, totalTokens: 0 },
      };
    }

    const model = this.cfg.embeddingModel;
    const ttl = this.cacheTtl();
    const dim = this.cfg.embeddingDim;

    const ordered: Array<EmbeddingItem | null> = new Array(texts.length).fill(
      null,
    );
    const toFetch: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const key = this.cacheKey(text);
      const cached = await this.redis.getJson<number[]>(key);
      if (cached && Array.isArray(cached) && cached.length === dim) {
        ordered[i] = { index: i, embedding: cached };
      } else {
        toFetch.push({ index: i, text });
      }
    }

    if (toFetch.length > 0) {
      const batchSize = Math.max(1, this.cfg.embeddingBatchSize);
      const config = this.buildConfig();
      for (let offset = 0; offset < toFetch.length; offset += batchSize) {
        const batch = toFetch.slice(offset, offset + batchSize);
        const originalTexts = batch.map((b) => b.text);
        const response = await this.callWithRetry(originalTexts, config);
        for (let j = 0; j < batch.length; j++) {
          const item =
            response.items.find((it) => it.index === j) ?? response.items[j];
          if (!item) continue;
          const slot = batch[j];
          ordered[slot.index] = {
            index: slot.index,
            embedding: item.embedding,
          };
          await this.redis.setJson(
            this.cacheKey(slot.text),
            item.embedding,
            ttl,
          );
        }
      }
    }

    const items: EmbeddingItem[] = ordered
      .filter((v): v is EmbeddingItem => v !== null)
      .map((it, idx) => ({ index: idx, embedding: it.embedding }));

    let promptTokens = 0;
    let totalTokens = 0;
    for (let i = 0; i < texts.length; i++) {
      if (!ordered[i]) {
        const est = Math.max(1, Math.ceil(texts[i].length / 4));
        promptTokens += est;
        totalTokens += est;
      }
    }

    return {
      items,
      model,
      dim,
      usage: { promptTokens, totalTokens },
    };
  }

  private async callWithRetry(
    texts: string[],
    config: ReturnType<EmbeddingService["buildConfig"]>,
  ): Promise<EmbeddingResponse> {
    const model = config.model;
    const endTimer = this.prom.llmRequestDuration.startTimer({
      provider: "openai-compatible",
      model,
      kind: "embed",
    });
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.provider.embed(config, texts);
        endTimer();
        if (res.usage.totalTokens > 0) {
          this.prom.llmTokensTotal.inc(
            { provider: "openai-compatible", model, kind: "prompt" },
            res.usage.promptTokens,
          );
          this.prom.llmTokensTotal.inc(
            { provider: "openai-compatible", model, kind: "completion" },
            Math.max(0, res.usage.totalTokens - res.usage.promptTokens),
          );
        }
        return res;
      } catch (err) {
        lastErr = err;
        const status = (err as UpstreamError).status;
        this.prom.llmErrorsTotal.inc({
          provider: "openai-compatible",
          model,
          code: String(status ?? (err as { code?: string }).code ?? "unknown"),
        });
        if (attempt === MAX_ATTEMPTS || !isRetryable(err)) {
          endTimer();
          break;
        }
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `embed attempt ${attempt}/${MAX_ATTEMPTS} failed (status=${status ?? "-"}): ${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    const status = (lastErr as UpstreamError | undefined)?.status;
    if (status === 408 || isTimeoutLike(lastErr)) {
      throw new BusinessException({
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: "Embedding upstream timeout",
        cause: lastErr,
      });
    }
    throw new BusinessException({
      code: ErrorCode.RAG_EMBEDDING_FAILED,
      message: "Embedding upstream failed",
      cause: lastErr,
    });
  }
}
