/**
 * jest setupFiles:在测试文件 / setup.ts 之前运行,先注入测试默认 env,
 * 让 src/config/config.module.ts 的 zod 校验在 AppModule import 阶段就过。
 *
 * 注意:此文件必须是 .js(ts-jest 处理不了 jest setupFiles 的纯 .js 早期阶段),
 * 且只做 process.env 注入,不能 import 任何 src/ 模块。
 */

const path = require('path');
const fs = require('fs');

try {
  // dotenv 不覆盖已存在的 key,所以这里的测试默认不会被 .env 里的 dev 值压过
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
} catch {
  // ignore
}

const DEFAULTS = {
  NODE_ENV: 'test',
  APP_PORT: '3001',
  APP_GLOBAL_PREFIX: '/api/v1',
  LOG_LEVEL: 'fatal',
  CORS_ORIGIN: '*',
  RATE_LIMIT_PER_MIN: '10000',

  LLM_PROVIDER: 'qwen',
  LLM_API_KEY: 'dummy-key-for-e2e',
  LLM_BASE_URL: 'http://127.0.0.1:9/v1',
  LLM_MODEL: 'qwen-plus',
  LLM_TEMPERATURE: '0.2',
  LLM_MAX_TOKENS: '1500',
  LLM_TIMEOUT_MS: '5000',
  LLM_FALLBACK_PROVIDERS: '',

  EMBEDDING_API_KEY: 'dummy-key-for-e2e',
  EMBEDDING_BASE_URL: 'http://127.0.0.1:9/v1',
  EMBEDDING_MODEL: 'text-embedding-v3',
  EMBEDDING_DIM: '1024',
  EMBEDDING_BATCH_SIZE: '32',

  RERANK_PROVIDER: 'none',
  RERANK_MODEL: 'BAAI/bge-reranker-v2-m3',

  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgresql://wyu:changeme@127.0.0.1:5432/wyu_rag?schema=public',
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  REDIS_DB: process.env.REDIS_DB || '0',
  REDIS_KEY_PREFIX: 'wyu_test:',

  MINIO_ROOT_USER: process.env.MINIO_ROOT_USER || 'minioadmin',
  MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD || 'changeme',
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || '127.0.0.1',
  MINIO_PORT: process.env.MINIO_PORT || '9000',
  MINIO_BUCKET: process.env.MINIO_BUCKET || 'wyu-rag',
  MINIO_USE_SSL: 'false',

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'test-secret-12345678',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'test-secret-87654321',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',

  RAG_TOP_K: '20',
  RAG_RERANK_TOP_K: '5',
  RAG_FAQ_THRESHOLD: '0.92',
  RAG_REJECT_THRESHOLD: '0.55',
  RAG_MAX_CONTEXT_TOKENS: '4000',
  RAG_CACHE_TTL: '600',
  BULLMQ_PREFIX: 'wyu_test',
};

for (const [k, v] of Object.entries(DEFAULTS)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
