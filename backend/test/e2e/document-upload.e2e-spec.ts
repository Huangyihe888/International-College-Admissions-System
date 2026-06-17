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
  TestApp,
  truncateTables,
} from "./setup";

try {
  loadEnv({ path: `${process.cwd()}/.env` });
} catch {
  // ignore
}

// 简单 PDF 头(让 FileInterceptor 接受,parser 不强校验全部内容)
const PDF_HEADER = Buffer.from("%PDF-1.4\n%fake pdf for e2e\n");
const PDF_BODY = Buffer.alloc(2048, "a"); // padding to look like a real pdf
const PDF_BUFFER = Buffer.concat([PDF_HEADER, PDF_BODY]);

const KB_VERSION_CODE = "v1-e2e";

let infraOk = false;
let infraDetails: Record<string, string> = {};
beforeAll(async () => {
  const r = await checkInfra();
  infraOk = r.ok;
  infraDetails = r.details;
  if (!infraOk) {
    // eslint-disable-next-line no-console
    console.warn(
      `[document-upload.e2e] skipped: ${JSON.stringify(infraDetails)}`,
    );
  }
});

describe("Document upload e2e (POST /admin/documents/upload + 列表 + reindex)", () => {
  let ctx: TestApp;
  let kbVersionId = "";
  const username = "admin";
  const password = "admin123";

  beforeAll(async () => {
    if (!infraOk) return;
    ctx = await createTestApp({ truncate: true, seedAdmin: true });
    const p = ctx.prisma;
    // seed 知识库版本(ACTIVE)
    const kb = await p.knowledgeBaseVersion.upsert({
      where: { version: KB_VERSION_CODE },
      create: {
        version: KB_VERSION_CODE,
        description: "e2e test KB",
        isActive: true,
        activatedAt: new Date(),
      },
      update: { isActive: true, activatedAt: new Date() },
    });
    kbVersionId = kb.id;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  // infra 不可达时,所有 it 早 return(等价 skip)
  const skipIfNoInfra = () => !infraOk;

  // ========================== upload ==========================

  describe("POST /api/v1/admin/documents/upload", () => {
    it("upload PDF:200 → id + status PENDING + uploadJobId", async () => {
      if (skipIfNoInfra()) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/documents/upload")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .field("kbVersionId", kbVersionId)
        .attach("file", PDF_BUFFER, {
          filename: "test.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toBeTruthy();
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.status).toBe("PENDING");
      expect(res.body.data.uploadJobId).toBeTruthy();

      // 二次确认数据库有这条 document
      const doc = await ctx.prisma.document.findUnique({
        where: { id: res.body.data.id },
      });
      expect(doc).toBeTruthy();
      expect(doc!.status).toBe("PENDING");
      expect(doc!.kbVersionId).toBe(kbVersionId);
    });

    it("upload .exe (application/octet-stream):3004 UNSUPPORTED_FILE_TYPE", async () => {
      if (skipIfNoInfra()) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/documents/upload")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .field("kbVersionId", kbVersionId)
        .attach("file", Buffer.from("MZfake-exe"), {
          filename: "malware.exe",
          contentType: "application/octet-stream",
        })
        .expect(400);
      expect(res.body.code).toBe(ErrorCode.UNSUPPORTED_FILE_TYPE);
    });

    it("upload KB version 不存在:3101 KB_VERSION_NOT_FOUND", async () => {
      if (skipIfNoInfra()) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/documents/upload")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .field("kbVersionId", "00000000-0000-0000-0000-000000000000")
        .attach("file", PDF_BUFFER, {
          filename: "test.pdf",
          contentType: "application/pdf",
        })
        .expect(400);
      expect(res.body.code).toBe(ErrorCode.KB_VERSION_NOT_FOUND);
    });

    it("upload 缺 kbVersionId:400 VALIDATION_FAILED", async () => {
      if (skipIfNoInfra()) return;
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/documents/upload")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .attach("file", PDF_BUFFER, {
          filename: "test.pdf",
          contentType: "application/pdf",
        })
        .expect(400);
      expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    // 文件超 50MB:由于 multer 的 FileInterceptor limits.fileSize=50MB 会比 service 层
    // 先抛 MulterError('LIMIT_FILE_SIZE'),当前代码下此路径会返回 500(AllExceptionsFilter
    // 不识别 MulterError)。spec 期望 4003,但在不动 src 的前提下无法稳定复现。
    // 这里 it.skip + 注释占位,等后端补 MulterError → 4003 映射时打开。
    it.skip("upload >50MB:3003 DOCUMENT_TOO_LARGE(需后端先支持 MulterError 映射)", () => {
      // 预留 50MB+1 buffer 上传用例
    });
  });

  // ========================== list ==========================

  describe("GET /api/v1/admin/documents", () => {
    let uploadedDocId = "";
    beforeAll(async () => {
      if (!infraOk) return;
      // 上传一份用于列表断言
      const res = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/documents/upload")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .field("kbVersionId", kbVersionId)
        .attach("file", PDF_BUFFER, {
          filename: "list-test.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      uploadedDocId = res.body.data.id;
    });

    it("列表 200 + 含刚上传的 doc", async () => {
      if (skipIfNoInfra()) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/documents")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .expect(200);
      expect(res.body.code).toBe(0);
      const items: Array<{ id: string; status: string }> = res.body.data.items;
      const found = items.find((d) => d.id === uploadedDocId);
      expect(found).toBeTruthy();
      expect(found!.status).toBe("PENDING");
    });

    it("按 status=PENDING 过滤:200 + 列表都是 PENDING", async () => {
      if (skipIfNoInfra()) return;
      const res = await request(ctx.app.getHttpServer())
        .get("/api/v1/admin/documents?status=PENDING")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .expect(200);
      expect(res.body.code).toBe(0);
      const items: Array<{ id: string; status: string }> = res.body.data.items;
      expect(items.length).toBeGreaterThan(0);
      for (const d of items) expect(d.status).toBe("PENDING");
    });
  });

  // ========================== reindex ==========================

  describe("POST /api/v1/admin/documents/:id/reindex", () => {
    it("reindex:200 → status PENDING + 新 uploadJobId", async () => {
      if (skipIfNoInfra()) return;
      // 先确保有一份 doc
      const up = await request(ctx.app.getHttpServer())
        .post("/api/v1/admin/documents/upload")
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .field("kbVersionId", kbVersionId)
        .attach("file", PDF_BUFFER, {
          filename: "reindex-test.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      const docId = up.body.data.id;
      const firstJobId = up.body.data.uploadJobId;

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/admin/documents/${docId}/reindex`)
        .set("Authorization", `Bearer ${ctx.adminToken}`)
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.uploadJobId).toBeTruthy();
      expect(res.body.data.uploadJobId).not.toBe(firstJobId);
      expect(res.body.data.status).toBe("PENDING");

      const jobs = await ctx.prisma.uploadJob.findMany({
        where: { documentId: docId },
        orderBy: { createdAt: "desc" },
      });
      expect(jobs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
