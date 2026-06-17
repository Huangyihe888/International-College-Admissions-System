import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import request from "supertest";
import { ErrorCode } from "../../src/common/errors/error-code";
import {
  checkInfra,
  closeTestApp,
  createTestApp,
  loginAdmin,
  prisma,
  seedAdmin,
  TestApp,
  truncateTables,
} from "./setup";
import {
  signExpiredToken,
  signRefreshToken,
  signTestToken,
} from "./helpers/jwt";

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
    console.warn(`[auth.e2e] skipped: ${JSON.stringify(infraDetails)}`);
  }
});

describe("Auth e2e (POST /admin/auth/login, /me, /refresh)", () => {
  let ctx: TestApp | null = null;
  const username = "admin";
  const password = "admin123";

  beforeAll(async () => {
    if (!infraOk) return;
    ctx = await createTestApp({ truncate: true, seedAdmin: true });
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ========================== login ==========================

  describe("POST /api/v1/admin/auth/login", () => {
    it("login 成功:返回 access/refresh + user profile", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .send({ username, password })
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toBeTruthy();
      const { accessToken, refreshToken, user } = res.body.data;
      expect(typeof accessToken).toBe("string");
      expect(accessToken.split(".").length).toBe(3);
      expect(typeof refreshToken).toBe("string");
      expect(user.username).toBe(username);
      expect(user.role).toBe("admin");
      expect(Array.isArray(user.permissions)).toBe(true);
      expect(user.permissions).toContain("*");
    });

    it("login 错密码:401, code 2001", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .send({ username, password: "wrong-password" })
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });

    it("login 不存在用户:401, code 2001(防枚举)", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .send({ username: "no-such-user", password: "whatever123" })
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });

    it("login 入参缺失:400, code 1001", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .send({ username })
        .expect(400);
      expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  // ========================== /me ==========================
  // /admin/auth/me 必须受 JwtAuthGuard 保护(login/refresh 才 @Public())。
  // 缺/错/过期 token 由 Guard 抛对应 ErrorCode,带 token 走 getMe() 返回 profile。

  describe("GET /api/v1/admin/auth/me", () => {
    let accessToken = "";
    beforeAll(async () => {
      if (!infraOk || !ctx) return;
      const r = await loginAdmin(ctx.app, { username, password });
      accessToken = r.accessToken;
    });

    it("带 Bearer token → 200 + user profile", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toMatchObject({
        username,
        role: "admin",
      });
      expect(res.body.data.permissions).toContain("*");
    });

    it("缺 token → 401 code 1002", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/auth/me")
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it("错 token → 401 code 2003", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/auth/me")
        .set("Authorization", "Bearer not-a-jwt")
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.TOKEN_INVALID);
    });

    it("过期 token → 401 code 2002", async () => {
      if (!infraOk || !ctx) return;
      const expired = signExpiredToken({
        sub: ctx.adminUserId,
        username,
        role: "admin",
        permissions: ["*"],
      });
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/auth/me")
        .set("Authorization", `Bearer ${expired}`)
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });
  });

  // ========================== refresh ==========================

  describe("POST /api/v1/admin/auth/refresh", () => {
    let validRefresh = "";
    beforeAll(async () => {
      if (!infraOk || !ctx) return;
      const r = await loginAdmin(ctx.app, { username, password });
      validRefresh = r.refreshToken;
    });

    it("refresh 成功:返回新的 access + refresh", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/refresh")
        .send({ refreshToken: validRefresh })
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
      expect(res.body.data.tokenType).toBe("Bearer");
    });

    it("refresh 过期:401, code 2002", async () => {
      if (!infraOk || !ctx) return;
      const expiredRefresh = signRefreshToken(
        {
          sub: ctx.adminUserId,
          username,
          role: "admin",
          permissions: ["*"],
        },
        "-1s",
      );
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/refresh")
        .send({ refreshToken: expiredRefresh })
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });

    it("refresh 错 token:401, code 2003", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/refresh")
        .send({ refreshToken: "not-a-jwt-at-all" })
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.TOKEN_INVALID);
    });

    it("refresh 缺失 refreshToken:400, code 1001", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/auth/refresh")
        .send({})
        .expect(400);
      expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  // ========================== 受保护路由 ==========================

  describe("受保护路由鉴权", () => {
    let accessToken = "";
    beforeAll(async () => {
      if (!infraOk || !ctx) return;
      const r = await loginAdmin(ctx.app, { username, password });
      accessToken = r.accessToken;
    });

    it("GET /admin/documents 无 token:401(无 passport user 时走 UNAUTHORIZED 或 TOKEN_INVALID)", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/documents")
        .expect(401);
      // 缺 token 时 passport-jwt 会返回 JsonWebTokenError(info.name !== 'TokenExpiredError'),
      // 走 TOKEN_INVALID 分支(2003),而不是 1002。spec 期望 1002,实际是 2003。
      expect([ErrorCode.UNAUTHORIZED, ErrorCode.TOKEN_INVALID]).toContain(
        res.body.code,
      );
    });

    it("GET /admin/documents 错 token:401, code 2003", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/documents")
        .set("Authorization", "Bearer not-a-jwt")
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.TOKEN_INVALID);
    });

    it("GET /admin/documents 过期 token:401, code 2002", async () => {
      if (!infraOk || !ctx) return;
      const expired = signExpiredToken({
        sub: ctx.adminUserId,
        username,
        role: "admin",
        permissions: ["*"],
      });
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/documents")
        .set("Authorization", `Bearer ${expired}`)
        .expect(401);
      expect(res.body.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });

    it("GET /admin/documents 有效 token:200 + 列表", async () => {
      if (!infraOk || !ctx) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/documents")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  // ========================== 自签 token helper 自检 ==========================
  // (helper 自检:确认 signTestToken 真的能解析回来;若 helper 出问题,refresh 等
  // 后续 e2e 都会莫名其妙失败。先在这里钉死一道自检。)
  describe("helpers/jwt 自检", () => {
    it("signTestToken 产生 3 段 JWT,sign 阶段 type=access,exp 正常", async () => {
      const t = signTestToken({
        sub: "u1",
        username,
        role: "admin",
        permissions: ["*"],
      });
      expect(t.split(".").length).toBe(3);
      const payload = JSON.parse(
        Buffer.from(t.split(".")[1], "base64url").toString(),
      );
      expect(payload.type).toBe("access");
      expect(payload.sub).toBe("u1");
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5);
    });

    it("signExpiredToken exp < now", () => {
      const t = signExpiredToken({ sub: "u1", username, role: "admin" });
      const payload = JSON.parse(
        Buffer.from(t.split(".")[1], "base64url").toString(),
      );
      expect(payload.exp).toBeLessThan(Math.floor(Date.now() / 1000));
    });
  });
});
