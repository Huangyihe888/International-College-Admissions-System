import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import request from "supertest";
import { ErrorCode } from "../../src/common/errors/error-code";
import {
  checkInfra,
  closeTestApp,
  createTestApp,
  TestApp,
  truncateTables,
} from "./setup";

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
    console.warn(`[chat.e2e] skipped: ${JSON.stringify(infraDetails)}`);
  }
});

// 简单 SSE 解析:按 \n\n 分块,提取 event/data 行
function parseSSE(body: string): Array<{ event?: string; data?: string }> {
  const events: Array<{ event?: string; data?: string }> = [];
  const blocks = body.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const ev: { event?: string; data?: string } = {};
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) ev.event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        const v = line.slice(5).trim();
        ev.data = ev.data !== undefined ? ev.data + v : v;
      }
    }
    if (ev.event || ev.data) events.push(ev);
  }
  return events;
}

// 简易 cookie 提取(Set-Cookie 头可能是数组,可能用 , 分;这里只取 wyu_vid)
function extractWyuvid(headers: Record<string, unknown>): string | null {
  const raw = headers["set-cookie"];
  const list: string[] = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === "string"
      ? [raw]
      : [];
  for (const c of list) {
    const m = /(?:^|;\s*)wyu_vid=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

describe("Chat e2e (visitorId cookie + /chat/send + /chat/stream + sessions + feedback)", () => {
  let ctx: TestApp;

  beforeAll(async () => {
    if (!infraOk) return;
    ctx = await createTestApp({
      truncate: true,
      seedAdmin: false,
      mockRag: true,
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  // ========================== visitorId cookie ==========================

  describe("visitorId cookie 流程", () => {
    it("首次请求无 cookie:响应 Set-Cookie 中含 wyu_vid", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .send({ question: "hi" })
        .expect(200);
      const vid = extractWyuvid(res.headers as Record<string, unknown>);
      expect(vid).toBeTruthy();
      expect(vid!.length).toBeGreaterThan(10);
    });

    it("同 visitorId 二次请求:同 sessionId", async () => {
      if (!infraOk) return;
      // 第一次:获取 cookie
      const r1 = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .send({ question: "first" })
        .expect(200);
      const vid = extractWyuvid(r1.headers as Record<string, unknown>);
      expect(vid).toBeTruthy();
      const sessionId1 = r1.body.data.sessionId;

      // 第二次:带 cookie
      const r2 = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .set("Cookie", `wyu_vid=${encodeURIComponent(vid!)}`)
        .send({ question: "second" })
        .expect(200);
      const sessionId2 = r2.body.data.sessionId;
      expect(sessionId2).toBe(sessionId1);

      // 数据库侧确认 session 上有 visitorId
      const session = await ctx.prisma.chatSession.findUnique({
        where: { id: sessionId2 },
      });
      expect(session).toBeTruthy();
      expect(session!.visitorId).toBe(vid);
    });

    it("不同 visitorId:不同 session", async () => {
      if (!infraOk) return;
      const r1 = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .send({ question: "A" })
        .expect(200);
      const r2 = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .set("Cookie", "wyu_vid=different-vid-12345")
        .send({ question: "B" })
        .expect(200);
      expect(r1.body.data.sessionId).not.toBe(r2.body.data.sessionId);
    });
  });

  // ========================== /chat/send ==========================

  describe("POST /api/v1/chat/send", () => {
    it("返回 mock answer + sessionId + assistantMessageId", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .send({ question: "测试问答" })
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.sessionId).toBeTruthy();
      expect(res.body.data.userMessageId).toBeTruthy();
      expect(res.body.data.assistantMessageId).toBeTruthy();
      expect(res.body.data.answer).toContain("mock answer");
      expect(res.body.data.isAnswered).toBe(true);
    });
  });

  // ========================== /chat/stream (SSE) ==========================

  describe("POST /api/v1/chat/stream (SSE)", () => {
    it("返回 text/event-stream,body 含 event: token 与 event: done", async () => {
      if (!infraOk) return;
      const server = ctx.app.getHttpServer();
      const res = await request(server)
        .post("/api/v1/chat/stream")
        .set("Accept", "text/event-stream")
        .send({ question: "SSE 测试" })
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () =>
            callback(null, Buffer.concat(chunks).toString("utf8")),
          );
          response.on("error", (e: Error) => callback(e, ""));
        })
        .expect(200);

      // supertest 自定义 parser 后,res.body 是 string
      const body: string = (res as any).body;
      expect(body).toContain("event: token");
      expect(body).toContain("event: done");

      const events = parseSSE(body);
      const tokens = events.filter((e) => e.event === "token");
      const dones = events.filter((e) => e.event === "done");
      expect(tokens.length).toBeGreaterThanOrEqual(1);
      expect(dones.length).toBe(1);
    });

    it("Content-Type 含 text/event-stream", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/stream")
        .set("Accept", "text/event-stream")
        .send({ question: "SSE Content-Type" })
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () =>
            callback(null, Buffer.concat(chunks).toString("utf8")),
          );
          response.on("error", (e: Error) => callback(e, ""));
        })
        .expect(200);
      const ct = (res.headers as Record<string, string>)["content-type"] || "";
      expect(ct).toMatch(/text\/event-stream/);
    });
  });

  // ========================== /chat/sessions ==========================

  describe("POST /api/v1/chat/sessions + GET /messages", () => {
    let sessionId = "";
    let assistantMessageId = "";

    beforeAll(async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .send({ question: "session 测试" })
        .expect(200);
      sessionId = res.body.data.sessionId;
      assistantMessageId = res.body.data.assistantMessageId;
    });

    it("POST /chat/sessions 创建会话:200,返回 sessionId", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/sessions")
        .send({ title: "e2e session" })
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.sessionId).toBeTruthy();
    });

    it("GET /chat/sessions/:id/messages:1 USER + 1 ASSISTANT", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/chat/sessions/${sessionId}/messages`)
        .expect(200);
      expect(res.body.code).toBe(0);
      const items: Array<{ role: string; content: string }> =
        res.body.data.items;
      expect(items.length).toBe(2);
      expect(items[0].role).toBe("USER");
      expect(items[1].role).toBe("ASSISTANT");
      expect(items[1].content).toContain("mock answer");
    });
  });

  // ========================== feedback ==========================

  describe("POST /api/v1/chat/messages/:id/feedback", () => {
    let sessionId = "";
    let assistantMessageId = "";
    let visitorId = "";

    beforeAll(async () => {
      if (!infraOk) return;
      const r = await request(ctx.app.getHttpServer())
        .post("/api/v1/chat/send")
        .send({ question: "feedback 测试" })
        .expect(200);
      sessionId = r.body.data.sessionId;
      assistantMessageId = r.body.data.assistantMessageId;
      visitorId = extractWyuvid(r.headers as Record<string, unknown>) || "";
    });

    it("POSITIVE → 200,Feedback 落库", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/chat/messages/${assistantMessageId}/feedback`)
        .send({ rating: "POSITIVE", comment: "good" })
        .expect(200);
      expect(res.body.code).toBe(0);

      const fb = await ctx.prisma.feedback.findUnique({
        where: { messageId: assistantMessageId },
      });
      expect(fb).toBeTruthy();
      expect(fb!.rating).toBe("UP");
    });

    it("同 messageId 二次提交(POSITIVE → NEGATIVE):更新不重复", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/chat/messages/${assistantMessageId}/feedback`)
        .send({ rating: "NEGATIVE", comment: "changed mind" })
        .expect(200);
      expect(res.body.code).toBe(0);

      const all = await ctx.prisma.feedback.findMany({
        where: { messageId: assistantMessageId },
      });
      expect(all.length).toBe(1);
      expect(all[0].rating).toBe("DOWN");
      expect(all[0].comment).toBe("changed mind");
    });

    it("跨 visitorId(不持有该 message):404 NOT_FOUND", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .set("Cookie", "wyu_vid=stranger-vid-9999")
        .post(`/api/v1/chat/messages/${assistantMessageId}/feedback`)
        .send({ rating: "POSITIVE" })
        .expect(404);
      expect(res.body.code).toBe(ErrorCode.NOT_FOUND);
    });

    it("feedback 给不存在的 message:404 NOT_FOUND", async () => {
      if (!infraOk) return;
      const res = await request(ctx.app.getHttpServer())
        .set("Cookie", `wyu_vid=${encodeURIComponent(visitorId)}`)
        .post(
          "/api/v1/chat/messages/00000000-0000-0000-0000-000000000000/feedback",
        )
        .send({ rating: "POSITIVE" })
        .expect(404);
      expect(res.body.code).toBe(ErrorCode.NOT_FOUND);
    });
  });
});
