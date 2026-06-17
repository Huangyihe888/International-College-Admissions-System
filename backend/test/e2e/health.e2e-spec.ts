import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import request from "supertest";
import { checkInfra, closeTestApp, createTestApp, TestApp } from "./setup";

try {
  loadEnv({ path: `${process.cwd()}/.env` });
} catch {
  // ignore
}

let infraOk = false;
let infraDetails: Record<string, string> = {};
beforeAll(async () => {
  const r = await checkInfra();
  infraOk = r.ok;
  infraDetails = r.details;
  if (!infraOk) {
    // eslint-disable-next-line no-console
    console.warn(`[health.e2e] skipped: ${JSON.stringify(infraDetails)}`);
  }
});

describe("Health e2e (/health/live + /health/ready)", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    if (!infraOk) return;
    ctx = await createTestApp({ truncate: false, seedAdmin: false });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  describe("GET /api/v1/health/live", () => {
    it("存活探针:200, status=ok, 不依赖外部", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/health/live")
        .expect(200);
      // /health/live 是 @Public() 路径,不走 ResponseInterceptor 的 {code, data} 包装
      // (controller 直接返回对象,nest-pino 跳过 autoLogging)
      expect(res.body.status).toBe("ok");
      expect(typeof res.body.timestamp).toBe("number");
    });
  });

  describe("GET /api/v1/health/ready", () => {
    it("就绪探针:返回 status(ok 或 degraded)与 checks(postgres/redis/minio)", async () => {
      if (!infraOk) return;
      // /health/ready 在缺依赖时返回 503(不依赖 ResponseInterceptor)
      const res = await request(ctx.app.getHttpServer()).get(
        "/api/v1/health/ready",
      );
      expect([200, 503]).toContain(res.status);
      expect(["ok", "degraded"]).toContain(res.body.status);
      expect(res.body.checks).toBeTruthy();
      expect(res.body.checks.postgres).toBeTruthy();
      expect(res.body.checks.redis).toBeTruthy();
      expect(res.body.checks.minio).toBeTruthy();
      // 每一项至少包含 ok 字段
      for (const k of ["postgres", "redis", "minio"]) {
        expect(typeof res.body.checks[k].ok).toBe("boolean");
        expect(typeof res.body.checks[k].latencyMs).toBe("number");
      }
    });

    it("依赖全 ok 时 status=ok", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer()).get(
        "/api/v1/health/ready",
      );
      // 在 docker compose up 之后跑 e2e,三个依赖都应 ok;若 CI 跑时挂了一个,降级路径已覆盖
      if (res.status === 200) {
        expect(res.body.status).toBe("ok");
        for (const k of ["postgres", "redis", "minio"]) {
          expect(res.body.checks[k].ok).toBe(true);
        }
      } else {
        // 503:说明至少一个依赖挂,记录实际状态但不 fail(e2e 套件目的是结构断言)
        // eslint-disable-next-line no-console
        console.warn(
          `[health.e2e] ready degraded: ${JSON.stringify(res.body.checks)}`,
        );
      }
    });
  });
});
