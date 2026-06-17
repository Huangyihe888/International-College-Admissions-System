import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppEnv } from "./env.schema";

@Injectable()
export class TypedConfigService {
  constructor(private readonly raw: ConfigService<AppEnv, true>) {}

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.raw.get(key, { infer: true }) as AppEnv[K];
  }

  get nodeEnv(): AppEnv["NODE_ENV"] {
    return this.get("NODE_ENV");
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === "development";
  }

  get appPort(): number {
    return this.get("APP_PORT");
  }

  get globalPrefix(): string {
    return this.get("APP_GLOBAL_PREFIX");
  }

  get logLevel(): AppEnv["LOG_LEVEL"] {
    return this.get("LOG_LEVEL");
  }

  get corsOrigin(): string | string[] {
    const raw = this.get("CORS_ORIGIN");
    if (raw === "*") return "*";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get rateLimitPerMin(): number {
    return this.get("RATE_LIMIT_PER_MIN");
  }

  // LLM
  get llmProvider() {
    return this.get("LLM_PROVIDER");
  }
  get llmApiKey() {
    return this.get("LLM_API_KEY");
  }
  get llmBaseUrl() {
    return this.get("LLM_BASE_URL");
  }
  get llmModel() {
    return this.get("LLM_MODEL");
  }
  get llmTemperature() {
    return this.get("LLM_TEMPERATURE");
  }
  get llmMaxTokens() {
    return this.get("LLM_MAX_TOKENS");
  }
  get llmTimeoutMs() {
    return this.get("LLM_TIMEOUT_MS");
  }
  get llmFallbackProviders(): string[] {
    const raw = this.get("LLM_FALLBACK_PROVIDERS");
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Embedding
  get embeddingApiKey() {
    return this.get("EMBEDDING_API_KEY") || this.llmApiKey;
  }
  get embeddingBaseUrl() {
    return this.get("EMBEDDING_BASE_URL") || this.llmBaseUrl;
  }
  get embeddingModel() {
    return this.get("EMBEDDING_MODEL");
  }
  get embeddingDim() {
    return this.get("EMBEDDING_DIM");
  }
  get embeddingBatchSize() {
    return this.get("EMBEDDING_BATCH_SIZE");
  }

  // Rerank
  get rerankProvider() {
    return this.get("RERANK_PROVIDER");
  }
  get rerankApiKey() {
    return this.get("RERANK_API_KEY");
  }
  get rerankBaseUrl() {
    return this.get("RERANK_BASE_URL");
  }
  get rerankModel() {
    return this.get("RERANK_MODEL");
  }

  // Database
  get databaseUrl() {
    return this.get("DATABASE_URL");
  }

  // Redis
  get redis() {
    return {
      host: this.get("REDIS_HOST"),
      port: this.get("REDIS_PORT"),
      password: this.get("REDIS_PASSWORD") || undefined,
      db: this.get("REDIS_DB"),
      keyPrefix: this.get("REDIS_KEY_PREFIX"),
    };
  }

  // MinIO
  get minio() {
    return {
      endPoint: this.get("MINIO_ENDPOINT"),
      port: this.get("MINIO_PORT"),
      useSSL: this.get("MINIO_USE_SSL"),
      accessKey: this.get("MINIO_ROOT_USER"),
      secretKey: this.get("MINIO_ROOT_PASSWORD"),
      bucket: this.get("MINIO_BUCKET"),
    };
  }

  // JWT
  get jwt() {
    return {
      accessSecret: this.get("JWT_ACCESS_SECRET"),
      refreshSecret: this.get("JWT_REFRESH_SECRET"),
      accessTtl: this.get("JWT_ACCESS_TTL"),
      refreshTtl: this.get("JWT_REFRESH_TTL"),
    };
  }

  // RAG
  get rag() {
    return {
      topK: this.get("RAG_TOP_K"),
      rerankTopK: this.get("RAG_RERANK_TOP_K"),
      faqThreshold: this.get("RAG_FAQ_THRESHOLD"),
      rejectThreshold: this.get("RAG_REJECT_THRESHOLD"),
      maxContextTokens: this.get("RAG_MAX_CONTEXT_TOKENS"),
      cacheTtl: this.get("RAG_CACHE_TTL"),
      noAnswerText: this.get("RAG_NO_ANSWER_TEXT"),
      noAnswerQrUrl: this.get("RAG_NO_ANSWER_QR_URL") || undefined,
    };
  }

  get bullmqPrefix() {
    return this.get("BULLMQ_PREFIX");
  }
}
