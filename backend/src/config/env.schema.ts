import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  APP_GLOBAL_PREFIX: z.string().default("/api/v1"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),

  // LLM
  LLM_PROVIDER: z.enum(["qwen", "deepseek", "vllm", "openai"]).default("qwen"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1).default("qwen-plus"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1500),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  LLM_FALLBACK_PROVIDERS: z.string().default(""),

  // Embedding
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  EMBEDDING_BASE_URL: z.string().url().optional(),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-v3"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(32),

  // Rerank
  RERANK_PROVIDER: z.enum(["bge", "cohere", "none"]).default("bge"),
  RERANK_API_KEY: z.string().optional(),
  RERANK_BASE_URL: z.string().optional(),
  RERANK_MODEL: z.string().default("BAAI/bge-reranker-v2-m3"),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default("redis"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_KEY_PREFIX: z.string().default("wyu:"),

  // MinIO
  MINIO_ROOT_USER: z.string().default("minioadmin"),
  MINIO_ROOT_PASSWORD: z.string().default("changeme"),
  MINIO_ENDPOINT: z.string().default("minio"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_BUCKET: z.string().default("wyu-rag"),
  MINIO_USE_SSL: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "string" ? v === "true" : v))
    .default(false),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  // RAG
  RAG_TOP_K: z.coerce.number().int().positive().default(20),
  RAG_RERANK_TOP_K: z.coerce.number().int().positive().default(5),
  RAG_FAQ_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  RAG_REJECT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  RAG_MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(4000),
  RAG_CACHE_TTL: z.coerce.number().int().positive().default(600),
  RAG_NO_ANSWER_TEXT: z
    .string()
    .default(
      "暂时未能从学院官方招生资料中找到与该问题直接对应的内容。为了给您更准确的答复，建议扫码加入 **2026 中外联培项目咨询群** 或直接联系学院招生办获取最新权威解答。\n\n![2026中外联培项目咨询群](/wyu/qr-group.jpg)",
    ),
  RAG_NO_ANSWER_QR_URL: z.string().url().optional(),

  // BullMQ
  BULLMQ_PREFIX: z.string().default("wyu"),
});

export type AppEnv = z.infer<typeof EnvSchema>;
