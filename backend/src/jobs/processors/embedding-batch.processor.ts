import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { Processor } from "../processor.decorator";
import { EmbeddingBatchJobData } from "../jobs.types";

export const EMBEDDING_BATCH_JOB = "embed-batch";

@Injectable()
@Processor("embedding-batch")
export class EmbeddingBatchProcessor {
  private readonly logger = new Logger(EmbeddingBatchProcessor.name);

  async process(job: Job<EmbeddingBatchJobData>): Promise<void> {
    const { documentId, chunkIds } = job.data;
    this.logger.log(
      `[${job.name}] documentId=${documentId} chunks=${chunkIds.length} id=${job.id}`,
    );
    // TODO(Task 7.4): call LlmService.embed() in sub-batches (EMBEDDING_BATCH_SIZE)
    // TODO(Task 7.4.1): upsert DocumentChunk.embedding
    // TODO(Task 7.4.2): update Document.status -> READY when last batch finishes
    await job.updateProgress(100);
  }
}
