import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import { BusinessException } from "../common/errors/business.exception";
import { ErrorCode } from "../common/errors/error-code";
import { PromService } from "../common/metrics/prom.service";
import { TypedConfigService } from "../config/typed-config.service";
import { RerankItem, RerankResponse } from "./types";
import { UpstreamError } from "./providers/openai-compatible.provider";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

function normalizeRerankResults(raw: unknown, docs: string[]): RerankItem[] {
  let entries: unknown[] = [];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (isRecord(raw) && Array.isArray(raw.results)) {
    entries = raw.results;
  } else {
    return docs.map((d, i) => ({ index: i, score: 1 / (1 + i), document: d }));
  }
  const items: RerankItem[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const idx = Number(entry.index);
    const score = Number(
      entry.relevance_score ??
        entry.score ??
        (isRecord(entry.results) ? entry.results.score : undefined),
    );
    const document =
      typeof entry.document === "string" ? entry.document : docs[idx];
    if (!Number.isFinite(idx) || !Number.isFinite(score)) continue;
    items.push({ index: idx, score, document });
  }
  if (items.length === 0) {
    return docs.map((d, i) => ({ index: i, score: 1 / (1 + i), document: d }));
  }
  return items.sort((a, b) => b.score - a.score);
}

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);

  constructor(
    private readonly cfg: TypedConfigService,
    private readonly prom: PromService,
  ) {}

  async rerank(query: string, docs: string[]): Promise<RerankResponse> {
    if (docs.length === 0) {
      return { results: [], model: this.cfg.rerankModel };
    }
    const provider = this.cfg.rerankProvider;
    if (provider === "none") {
      return {
        results: docs.map((d, i) => ({
          index: i,
          score: 1 / (1 + i),
          document: d,
        })),
        model: this.cfg.rerankModel,
      };
    }
    return this.callWithRetry(query, docs, provider);
  }

  private async callWithRetry(
    query: string,
    docs: string[],
    provider: "bge" | "cohere",
  ): Promise<RerankResponse> {
    const model = this.cfg.rerankModel;
    const endTimer = this.prom.llmRequestDuration.startTimer({
      provider,
      model,
      kind: "rerank",
    });
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.callUpstream(query, docs, provider, model);
        endTimer();
        return res;
      } catch (err) {
        lastErr = err;
        const status = (err as UpstreamError).status;
        this.prom.llmErrorsTotal.inc({
          provider,
          model,
          code: String(status ?? (err as { code?: string }).code ?? "unknown"),
        });
        if (attempt === MAX_ATTEMPTS || !isRetryable(err)) {
          endTimer();
          break;
        }
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `rerank attempt ${attempt}/${MAX_ATTEMPTS} failed (status=${status ?? "-"}): ${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    const status = (lastErr as UpstreamError | undefined)?.status;
    if (status === 408 || isTimeoutLike(lastErr)) {
      throw new BusinessException({
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: "Rerank upstream timeout",
        cause: lastErr,
      });
    }
    throw new BusinessException({
      code: ErrorCode.RAG_RERANK_FAILED,
      message: "Rerank upstream failed",
      cause: lastErr,
    });
  }

  private buildClient(): AxiosInstance {
    return axios.create({ validateStatus: () => true });
  }

  private toUpstream(err: unknown, fallback: string): UpstreamError {
    if (axios.isAxiosError(err)) {
      const wrapped: UpstreamError = new Error(
        err.response?.status
          ? `Upstream HTTP ${err.response.status}: ${typeof err.response.data === "string" ? err.response.data.slice(0, 200) : err.message || fallback}`
          : err.message || fallback,
      ) as UpstreamError;
      wrapped.status = err.response?.status;
      wrapped.body = err.response?.data;
      wrapped.code = err.code;
      return wrapped;
    }
    return new Error((err as Error)?.message ?? fallback) as UpstreamError;
  }

  private async callUpstream(
    query: string,
    docs: string[],
    provider: "bge" | "cohere",
    model: string,
  ): Promise<RerankResponse> {
    const apiKey = this.cfg.rerankApiKey ?? this.cfg.llmApiKey;
    const client = this.buildClient();

    if (provider === "bge") {
      const baseUrl = this.cfg.rerankBaseUrl ?? this.cfg.llmBaseUrl;
      const url = `${baseUrl.replace(/\/+$/, "")}/v1/rerank`;
      try {
        const res = await client.post<unknown>(
          url,
          { query, documents: docs, model, top_n: docs.length },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (res.status < 200 || res.status >= 300) {
          const err: UpstreamError = new Error(
            `Upstream HTTP ${res.status}`,
          ) as UpstreamError;
          err.status = res.status;
          err.body = res.data;
          throw err;
        }
        return { results: normalizeRerankResults(res.data, docs), model };
      } catch (err) {
        throw this.toUpstream(err, "bge rerank failed");
      }
    }

    // cohere
    const baseUrl = this.cfg.rerankBaseUrl ?? "https://api.cohere.com";
    const url = `${baseUrl.replace(/\/+$/, "")}/v1/rerank`;
    try {
      const res = await client.post<unknown>(
        url,
        {
          query,
          documents: docs,
          model,
          top_n: docs.length,
          return_documents: false,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (res.status < 200 || res.status >= 300) {
        const err: UpstreamError = new Error(
          `Upstream HTTP ${res.status}`,
        ) as UpstreamError;
        err.status = res.status;
        err.body = res.data;
        throw err;
      }
      return { results: normalizeRerankResults(res.data, docs), model };
    } catch (err) {
      throw this.toUpstream(err, "cohere rerank failed");
    }
  }
}
