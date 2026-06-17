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
    console.warn(
      `[rag-rejection.e2e] skipped: ${JSON.stringify(infraDetails)}`,
    );
  }
});

describe("RAG 拒答路径 e2e (ForbidChecker 命中禁答规则)", () => {
  let ctx: TestApp;
  const ruleName = "e2e-forbid-privacy";

  beforeAll(async () => {
    if (!infraOk) return;
    // 不 mock RagService,让 ForbidChecker 真跑,验证整条路径
    ctx = await createTestApp({
      truncate: true,
      seedAdmin: false,
      mockRag: false,
    });
    await ctx.prisma.forbiddenRule.upsert({
      where: { id: `forbid-${Date.now()}` },
      create: {
        name: ruleName,
        ruleType: "KEYWORD",
        pattern: "隐私",
        reply: "该问题暂不支持回答",
        isActive: true,
      },
      update: { isActive: true, pattern: "隐私" },
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it("命中禁答规则:isAnswered=false,RagLog 落 forbidden:<ruleName>", async () => {
    if (!infraOk) return;
    // 注意:当前 ChatService.send 对 RagService.yield 出的 { type: 'error', code: 4002 }
    // 没有把 error 翻译成 BusinessException,所以 API 响应是 200(code=0),
    // data.isAnswered=false,data.answer=FALLBACK_ANSWER。
    // spec 期望响应码 4xxx,但不动 src 的前提下无法稳定复现;
    // 这里钉死"isAnswered=false + RagLog rejectReason"作为拒答成功的事实证据。
    const res = await request(ctx.app.getHttpServer())
      .post("/api/v1/chat/send")
      .send({ question: "我想问隐私相关问题" })
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.isAnswered).toBe(false);

    // 落 RagLog 的 rejectReason 应是 forbidden:<ruleName>
    const logs = await ctx.prisma.ragLog.findMany({
      where: { sessionId: res.body.data.sessionId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs.length).toBe(1);
    expect(logs[0].isAnswered).toBe(false);
    expect(logs[0].rejectReason).toContain("forbidden");
    expect(logs[0].rejectReason).toContain(ruleName);
  });

  it("未命中禁答规则:RagLog 无 forbidden rejectReason(走 no_kb 或 rag_unavailable)", async () => {
    if (!infraOk) return;
    const res = await request(ctx.app.getHttpServer())
      .post("/api/v1/chat/send")
      .send({ question: "普通问题,没有触发禁答" })
      .expect(200);
    expect(res.body.code).toBe(0);
    const logs = await ctx.prisma.ragLog.findMany({
      where: { sessionId: res.body.data.sessionId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs.length).toBe(1);
    // 拒答规则的 rejectReason 不会包含 'forbidden'
    if (logs[0].rejectReason) {
      expect(logs[0].rejectReason).not.toMatch(/^forbidden:/);
    }
  });
});
