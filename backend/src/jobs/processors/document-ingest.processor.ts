import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import * as cheerio from "cheerio";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import { DocumentStatus, JobStatus } from "@prisma/client";
import { Processor } from "../processor.decorator";
import { DocumentIngestJobData } from "../jobs.types";
import { EmbeddingService } from "../../llm/embedding.service";
import { cleanChineseAcademicText } from "./text-clean.util";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import { StorageService } from "../../storage/storage.service";

export const DOCUMENT_INGEST_JOB = "parse-and-chunk";

const PARSE_PROGRESS = 25;
const CHUNK_PROGRESS = 50;
const READY_PROGRESS = 100;
const EMBED_PROGRESS_BASE = 50;
const EMBED_PROGRESS_RANGE = 45; // 50 → 95
const ERROR_MESSAGE_LIMIT = 500;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

const trimError = (msg: string): string =>
  msg.length > ERROR_MESSAGE_LIMIT
    ? `${msg.slice(0, ERROR_MESSAGE_LIMIT)}…`
    : msg;

@Injectable()
@Processor("document-ingest")
export class DocumentIngestProcessor {
  private readonly logger = new Logger(DocumentIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embedding: EmbeddingService,
  ) {}

  async process(job: Job<DocumentIngestJobData>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`[${job.name}] documentId=${documentId} id=${job.id}`);

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        fileKey: true,
        fileType: true,
        status: true,
      },
    });
    if (!document) {
      this.logger.warn(`[${job.name}] document ${documentId} not found, skip`);
      return;
    }

    const uploadJob = await this.prisma.uploadJob.findFirst({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    try {
      await this.markJobRunning(uploadJob?.id, "PARSING", 5);

      // ===== PARSING =====
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.PARSING, errorMessage: null },
      });

      const buffer = await this.storage.getObject(document.fileKey);
      let plainText: string;
      try {
        plainText = await this.parseByMime(document.fileType, buffer);
      } catch (err) {
        const msg = `parse failed: ${(err as Error).message ?? String(err)}`;
        this.logger.warn(`[${job.name}] documentId=${documentId} ${msg}`);
        throw new BusinessException(ErrorCode.DOCUMENT_PARSE_FAILED, msg);
      }

      plainText = plainText.trim();
      plainText = cleanChineseAcademicText(plainText);
      if (!plainText) {
        throw new BusinessException(
          ErrorCode.DOCUMENT_PARSE_FAILED,
          "parsed text is empty",
        );
      }
      await job.updateProgress(PARSE_PROGRESS);

      // ===== CHUNKING =====
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.CHUNKING },
      });
      await this.markJobRunning(uploadJob?.id, "CHUNKING", PARSE_PROGRESS);

      // 重新索引时旧的 chunks 先清掉
      await this.prisma.documentChunk.deleteMany({ where: { documentId } });

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
      });
      const pieces = await splitter.splitText(plainText);
      if (pieces.length === 0) {
        throw new BusinessException(
          ErrorCode.DOCUMENT_PARSE_FAILED,
          "no chunks produced from document text",
        );
      }

      await this.prisma.documentChunk.createMany({
        data: pieces.map((content, i) => ({
          documentId,
          chunkIndex: i,
          content,
          tokenCount: Math.max(1, Math.ceil(content.length / 4)),
        })),
      });
      await job.updateProgress(CHUNK_PROGRESS);

      // ===== EMBEDDING =====
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.EMBEDDING },
      });
      await this.markJobRunning(uploadJob?.id, "EMBEDDING", CHUNK_PROGRESS);

      const embeddingResult = await this.embedding.embed(pieces);
      const items = embeddingResult.items;
      if (items.length !== pieces.length) {
        throw new BusinessException(
          ErrorCode.RAG_EMBEDDING_FAILED,
          `embedding item count mismatch: got ${items.length}, expected ${pieces.length}`,
        );
      }

      // 按 10% 粒度更新进度:50 → 95
      const nextMilestoneEvery = Math.max(1, Math.ceil(items.length / 10));
      for (let i = 0; i < items.length; i++) {
        const v = `[${items[i].embedding.join(",")}]`;
        await this.prisma.$executeRaw`
          UPDATE "DocumentChunk"
          SET embedding = ${v}::vector
          WHERE "documentId" = ${documentId} AND "chunkIndex" = ${i}
        `;
        if ((i + 1) % nextMilestoneEvery === 0 || i === items.length - 1) {
          const p =
            EMBED_PROGRESS_BASE +
            Math.floor(((i + 1) / items.length) * EMBED_PROGRESS_RANGE);
          await job.updateProgress(Math.min(p, 95));
        }
      }

      // ===== READY =====
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.READY,
          chunkCount: pieces.length,
          processedAt: new Date(),
          errorMessage: null,
        },
      });

      if (uploadJob) {
        await this.prisma.uploadJob.update({
          where: { id: uploadJob.id },
          data: {
            status: JobStatus.SUCCESS,
            progress: READY_PROGRESS,
            stage: "READY",
            finishedAt: new Date(),
          },
        });
      }
      await job.updateProgress(READY_PROGRESS);

      this.logger.log(
        `[${job.name}] documentId=${documentId} READY chunks=${pieces.length}`,
      );
    } catch (err) {
      const reason = trimError((err as Error).message ?? String(err));

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: reason,
        },
      });

      if (uploadJob) {
        await this.prisma.uploadJob.update({
          where: { id: uploadJob.id },
          data: {
            status: JobStatus.FAILED,
            errorMessage: reason,
            finishedAt: new Date(),
          },
        });
      }

      this.logger.warn(
        `[${job.name}] documentId=${documentId} FAILED reason=${reason}`,
      );
      throw err;
    }
  }

  // ---------- internals ----------

  private async markJobRunning(
    uploadJobId: string | undefined,
    stage: string,
    progress: number,
  ): Promise<void> {
    if (!uploadJobId) return;
    await this.prisma.uploadJob.update({
      where: { id: uploadJobId },
      data: {
        status: JobStatus.RUNNING,
        stage,
        progress,
        startedAt: new Date(),
      },
    });
  }

  private async parseByMime(mime: string, buffer: Buffer): Promise<string> {
    switch (mime) {
      case "application/pdf": {
        const m: any = await import("pdf-parse");
        const fn = m.default ?? m;
        const result = await fn(buffer);
        return String(result?.text ?? "");
      }
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
        const result = await mammoth.extractRawText({ buffer });
        return result.value ?? "";
      }
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const lines: string[] = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          if (rows.length === 0) continue;
          lines.push(`[Sheet: ${sheetName}]`);
          for (const row of rows) {
            const text = row.map(String).filter(Boolean).join(" | ");
            if (text.trim()) lines.push(text);
          }
          lines.push("");
        }
        return lines.join("\n");
      }
      case "text/html": {
        const $ = cheerio.load(buffer.toString("utf8"));
        return $.text();
      }
      case "text/markdown":
      case "text/plain":
        return buffer.toString("utf8");
      default:
        throw new BusinessException(
          ErrorCode.UNSUPPORTED_FILE_TYPE,
          `Unsupported mime type: ${mime}`,
        );
    }
  }
}
