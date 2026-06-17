import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { EmbeddingService } from "../../../llm/embedding.service";
import { PromService } from "../../../common/metrics/prom.service";
import { RedisService } from "../../../redis/redis.service";
import { TypedConfigService } from "../../../config/typed-config.service";
import { PrismaService } from "../../../database/prisma.service";
import { RetrievedChunk } from "../types";

interface ChunkRow {
  id: string;
  documentId: string;
  content: string;
  index: number;
  filename: string;
  score: number;
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

@Injectable()
export class VectorRecallService {
  private readonly logger = new Logger(VectorRecallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embed: EmbeddingService,
    private readonly redis: RedisService,
    private readonly cfg: TypedConfigService,
    private readonly prom: PromService,
  ) {}

  async recall(
    question: string,
    kbVersionId: string,
    topK: number,
  ): Promise<RetrievedChunk[]> {
    if (!question || !kbVersionId || topK <= 0) return [];

    const cacheKey = this.cacheKey(question, kbVersionId, topK);
    const cached = await this.safeGetCache(cacheKey);
    if (cached) {
      return cached;
    }

    const endTimer = this.prom.vectorRecallDuration.startTimer({
      kind: "chunk",
    });
    try {
      const emb = await this.embed.embed([question]);
      const item = emb.items[0];
      if (!item || !item.embedding || item.embedding.length === 0) return [];
      const vec = Prisma.raw(`'[${item.embedding.join(",")}]'::vector`);
      const limit = Math.max(1, Math.floor(topK));

      const rows = await this.prisma.$queryRaw<ChunkRow[]>(Prisma.sql`
        SELECT c.id,
               c."documentId",
               c.content,
               c."chunkIndex" AS "index",
               d.title        AS filename,
               1 - (c.embedding <=> ${vec}) AS score
        FROM "DocumentChunk" c
        JOIN "Document" d ON c."documentId" = d.id
        WHERE d."kbVersionId" = ${kbVersionId}::text
          AND d.status = 'READY'::"DocumentStatus"
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vec}
        LIMIT ${limit}
      `);

      const result: RetrievedChunk[] = rows.map((r) => ({
        chunkId: r.id,
        documentId: r.documentId,
        content: r.content ?? "",
        index: Number(r.index) || 0,
        filename: r.filename ?? "",
        score: Number(r.score) || 0,
      }));

      await this.safeSetCache(cacheKey, result);
      return result;
    } catch (err) {
      this.logger.warn(`vector recall failed: ${(err as Error).message}`);
      return [];
    } finally {
      endTimer();
    }
  }

  invalidate(
    question: string,
    kbVersionId: string,
    topK: number,
  ): Promise<number> {
    return this.redis.del(this.cacheKey(question, kbVersionId, topK));
  }

  private cacheKey(
    question: string,
    kbVersionId: string,
    topK: number,
  ): string {
    const model = this.cfg.embeddingModel;
    return `rag:recall:${model}:${sha1(`${kbVersionId}:${topK}:${question}`)}`;
  }

  private async safeGetCache(key: string): Promise<RetrievedChunk[] | null> {
    try {
      const v = await this.redis.getJson<RetrievedChunk[]>(key);
      return Array.isArray(v) ? v : null;
    } catch (err) {
      this.logger.warn(`recall cache get failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async safeSetCache(
    key: string,
    value: RetrievedChunk[],
  ): Promise<void> {
    try {
      await this.redis.setJson(key, value, this.cfg.rag.cacheTtl);
    } catch (err) {
      this.logger.warn(`recall cache set failed: ${(err as Error).message}`);
    }
  }
}
