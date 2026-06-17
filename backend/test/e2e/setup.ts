import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import Redis from "ioredis";
import { createConnection as netCreateConnection } from "node:net";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { TypedConfigService } from "../../src/config/typed-config.service";
import { ErrorCode } from "../../src/common/errors/error-code";
import { RagService } from "../../src/modules/rag/rag.service";
import { RedisService } from "../../src/redis/redis.service";
import type { RagChunk } from "../../src/modules/chat/types";
import type { RagSource } from "../../src/modules/chat/types";

/**
 * 通用 e2e 测试基建:
 * - createTestApp(): 启动一个完整 NestApp(含 AppModule 全部 15 个子模块),
 *   自动注入测试默认 env,跑前 truncate + 选做 seed。
 * - skipIfNoInfra(): 每个 describe 顶部调用,缺依赖时 describe.skip。
 *
 * 设计要点:
 * 1) env 在 createTestApp 入口处统一设置;ConfigModule.forRoot 会读取 process.env
 *    并与 .env 合并(dotenv 不会覆盖已存在的 process.env 键)。
 * 2) 依赖连通性通过探测式 quickCheck 决定,失败就抛 `infra-unavailable`
 *    标记,顶层 describe 用 skipIfNoInfra 跳过。
 * 3) Prisma 客户端单例:每次 truncate 前关掉当前活动连接,truncate 后再 connect。
 * 4) 限流:测试环境 RATE_LIMIT_PER_MIN 调到 10000,避免密集请求被 1005 挡。
 * 5) BullMQ:不启 Worker 会更好,但 AppModule 已注册 ProcessorRegistry;
 *    Worker 启动后异步失败(LLM 不可达)不影响 e2e 主链路断言。
 */

export interface TestApp {
  app: INestApplication;
  module: TestingModule;
  prisma: PrismaClient;
  adminToken: string;
  adminRefresh: string;
  adminUserId: string;
}

const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: "test",
  APP_PORT: "3001",
  APP_GLOBAL_PREFIX: "/api/v1",
  LOG_LEVEL: "fatal",
  CORS_ORIGIN: "*",
  RATE_LIMIT_PER_MIN: "10000",

  LLM_PROVIDER: "qwen",
  LLM_API_KEY: "dummy-key-for-e2e",
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
  LLM_MODEL: "qwen-plus",
  LLM_TEMPERATURE: "0.2",
  LLM_MAX_TOKENS: "1500",
  LLM_TIMEOUT_MS: "5000",
  LLM_FALLBACK_PROVIDERS: "",

  EMBEDDING_API_KEY: "dummy-key-for-e2e",
  EMBEDDING_BASE_URL: "http://127.0.0.1:9/v1",
  EMBEDDING_MODEL: "text-embedding-v3",
  EMBEDDING_DIM: "1024",
  EMBEDDING_BATCH_SIZE: "32",

  RERANK_PROVIDER: "none",
  RERANK_MODEL: "BAAI/bge-reranker-v2-m3",

  // 默认假设 docker compose up 后 localhost 可达;CI 可在调用 createTestApp 前 export 真实值
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://wyu:changeme@127.0.0.1:5432/wyu_rag?schema=public",
  REDIS_HOST: process.env.REDIS_HOST || "127.0.0.1",
  REDIS_PORT: process.env.REDIS_PORT || "6379",
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || "",
  REDIS_DB: process.env.REDIS_DB || "0",
  REDIS_KEY_PREFIX: "wyu_test:",

  MINIO_ROOT_USER: process.env.MINIO_ROOT_USER || "minioadmin",
  MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD || "changeme",
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || "127.0.0.1",
  MINIO_PORT: process.env.MINIO_PORT || "9000",
  MINIO_BUCKET: process.env.MINIO_BUCKET || "wyu-rag",
  MINIO_USE_SSL: "false",

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || "test-secret-12345678",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "test-secret-87654321",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "7d",

  RAG_TOP_K: "20",
  RAG_RERANK_TOP_K: "5",
  RAG_FAQ_THRESHOLD: "0.92",
  RAG_REJECT_THRESHOLD: "0.55",
  RAG_MAX_CONTEXT_TOKENS: "4000",
  RAG_CACHE_TTL: "600",
  BULLMQ_PREFIX: "wyu_test",
};

const TRUNCATE_ORDER = [
  "AuditLog",
  "Feedback",
  "RagLog",
  "ChatMessage",
  "ChatSession",
  "DocumentChunk",
  "UploadJob",
  "Document",
  "KnowledgeBaseVersion",
  "FaqItem",
  "ForbiddenRule",
  "User",
  "Role",
];

let envLoaded = false;

function ensureEnv(): void {
  if (envLoaded) return;
  // 先加载项目根 .env(若存在);dotenv 不会覆盖已存在的 process.env
  try {
    loadEnv({ path: `${process.cwd()}/.env` });
  } catch {
    // ignore
  }
  for (const [k, v] of Object.entries(TEST_ENV_DEFAULTS)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  envLoaded = true;
}

let prismaSingleton: PrismaClient | null = null;
export function prisma(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient({
      datasources: {
        db: { url: process.env.DATABASE_URL! },
      },
    });
  }
  return prismaSingleton;
}

export async function closePrisma(): Promise<void> {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect().catch(() => undefined);
    prismaSingleton = null;
  }
}

export async function truncateTables(
  tableNames: string[] = TRUNCATE_ORDER,
): Promise<void> {
  const p = prisma();
  // CASCADE 一把梭,反向显式列表仅作可读性
  const list = tableNames.map((n) => `"${n}"`).join(", ");
  await p.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export async function seedAdmin(opts?: {
  username?: string;
  password?: string;
  roleName?: string;
}): Promise<{ userId: string; username: string; password: string }> {
  const username = opts?.username ?? "admin";
  const password = opts?.password ?? "admin123";
  const roleName = opts?.roleName ?? "admin";
  const p = prisma();

  const role = await p.role.upsert({
    where: { name: roleName },
    create: {
      name: roleName,
      description: `e2e ${roleName}`,
      permissions: roleName === "admin" ? ["*"] : ["document:read"],
    },
    update: { permissions: roleName === "admin" ? ["*"] : ["document:read"] },
  });

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await p.user.upsert({
    where: { username },
    create: {
      username,
      passwordHash,
      displayName: "e2e admin",
      roleId: role.id,
      status: "ACTIVE",
    },
    update: { passwordHash, roleId: role.id, status: "ACTIVE" },
  });

  return { userId: user.id, username, password };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  username: string;
}

export async function loginAdmin(
  app: INestApplication,
  creds: { username: string; password: string },
): Promise<LoginResult> {
  const server = app.getHttpServer();
  const res = await request(server)
    .post("/api/v1/admin/auth/login")
    .send(creds)
    .expect(200);
  const body = res.body;
  if (body.code !== 0)
    throw new Error(`login failed: code=${body.code} msg=${body.message}`);
  return {
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
    userId: body.data.user.id,
    username: body.data.user.username,
  };
}

/**
 * 探测 Postgres / Redis / MinIO 是否可连通。
 * 任何一个不可达就返回 false,顶层 describe 用此决定 skip。
 */
export async function checkInfra(): Promise<{
  ok: boolean;
  details: Record<string, string>;
}> {
  ensureEnv();
  const details: Record<string, string> = {};
  // Postgres
  let pgOk = false;
  try {
    const p = prisma();
    await p.$connect();
    await p.$queryRaw`SELECT 1`;
    pgOk = true;
    details.postgres = "ok";
  } catch (e) {
    details.postgres = `fail: ${(e as Error).message}`;
  }
  // Redis
  let redisOk = false;
  try {
    const client = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    redisOk = pong === "PONG";
    details.redis = redisOk ? "ok" : `unexpected: ${pong}`;
  } catch (e) {
    details.redis = `fail: ${(e as Error).message}`;
  }
  // MinIO
  let minioOk = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const sock = netCreateConnection({
        host: process.env.MINIO_ENDPOINT,
        port: Number(process.env.MINIO_PORT),
        timeout: 2000,
      });
      sock.once("connect", () => {
        minioOk = true;
        sock.end();
        resolve();
      });
      sock.once("error", (err: Error) => reject(err));
      sock.once("timeout", () => {
        sock.destroy();
        reject(new Error("timeout"));
      });
    });
    details.minio = "ok";
  } catch (e) {
    details.minio = `fail: ${(e as Error).message}`;
  }
  return { ok: pgOk && redisOk && minioOk, details };
}

/**
 * e2e describe 顶部调用。不可达就输出 skipped 信息并返回 true,
 * 让调用方在 beforeAll 里直接 return,所有 it 自然 skip。
 */
export function skipIfNoInfra(
  reason: string = "requires real infra",
): (ok: boolean, details: Record<string, string>) => boolean {
  return (ok, details) => {
    if (ok) return false;
    // eslint-disable-next-line no-console
    console.warn(`[e2e] ${reason} skipped: ${JSON.stringify(details)}`);
    return true;
  };
}

export interface CreateTestAppOptions {
  truncate?: boolean;
  seedAdmin?: boolean;
  mockRag?: boolean;
  overrideRag?: (mockImpl: AsyncIterable<RagChunk>) => void;
}

export async function createTestApp(
  opts: CreateTestAppOptions = {},
): Promise<TestApp> {
  ensureEnv();
  // 注:src/redis/redis.module.ts 当前没有把 RedisService 加入 providers / exports,
  // 但 CommonModule 的 RedisRateLimitGuard / HealthService 等都 inject 它。
  // 本 e2e 不能改 src,所以用 useMocker 自动给没注册的依赖补桩。RedisService
  // 单独提供更精确的 fake,避免对其他 missing dep 一刀切。
  const fakeRedis: Partial<RedisService> = {
    client: {
      ping: async () => "PONG",
      get: async () => null,
      set: async () => null,
      del: async () => 0,
      incr: async () => 1,
      expire: async () => 1,
      quit: async () => "OK",
    } as any,
    subscriber: {
      quit: async () => "OK",
    } as any,
    getJson: async () => null,
    setJson: async () => undefined,
    del: async () => 0,
    incrWithTtl: async () => 1,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .useMocker((token) => {
      if (token === RedisService) return fakeRedis;
      // 其它未注册依赖返回空对象(本测试只走 API 响应,大部分 service 方法
      // 在 mockRag 路径下不会真调到)
      return undefined;
    })
    .compile();
  const app = moduleRef.createNestApplication();
  const cfg = app.get(TypedConfigService);
  app.setGlobalPrefix(cfg.globalPrefix.replace(/^\//, ""));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  // 可选:mock RagService
  if (opts.mockRag) {
    const ragSvc = app.get(RagService) as unknown as {
      answerStream: (input: unknown) => AsyncIterable<RagChunk>;
    };
    ragSvc.answerStream = async function* () {
      yield {
        content: "mock answer",
        isAnswered: true,
        confidence: 0.9,
        sources: [] as RagSource[],
      };
    };
  }

  if (opts.truncate) await truncateTables();

  let adminToken = "";
  let adminRefresh = "";
  let adminUserId = "";
  if (opts.seedAdmin !== false) {
    const seeded = await seedAdmin();
    adminUserId = seeded.userId;
    const login = await loginAdmin(app, {
      username: seeded.username,
      password: seeded.password,
    });
    adminToken = login.accessToken;
    adminRefresh = login.refreshToken;
  }

  return {
    app,
    module: moduleRef,
    prisma: prisma(),
    adminToken,
    adminRefresh,
    adminUserId,
  };
}

export async function closeTestApp(ctx: TestApp | null): Promise<void> {
  if (!ctx) return;
  try {
    await ctx.app.close();
  } catch {
    // ignore
  }
}

/** 工具:等待若干毫秒(BullMQ 异步任务不等待,这里留作扩展) */
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export { ErrorCode };
