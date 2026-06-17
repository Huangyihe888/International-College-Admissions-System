import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";
import { DOCUMENT_INGEST_QUEUE, EMBEDDING_BATCH_QUEUE } from "./jobs.constants";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @Inject(DOCUMENT_INGEST_QUEUE) public readonly ingestQueue: Queue,
    @Inject(EMBEDDING_BATCH_QUEUE) public readonly embedQueue: Queue,
  ) {}

  addIngest<Data = unknown>(name: string, data: Data, opts?: JobsOptions) {
    return this.ingestQueue.add(name, data, opts);
  }

  addEmbed<Data = unknown>(name: string, data: Data, opts?: JobsOptions) {
    return this.embedQueue.add(name, data, opts);
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.ingestQueue.close().catch((err: Error) => {
        this.logger.warn(`close ingest queue failed: ${err.message}`);
      }),
      this.embedQueue.close().catch((err: Error) => {
        this.logger.warn(`close embed queue failed: ${err.message}`);
      }),
    ]);
  }

  async onModuleDestroy() {
    await this.close();
  }
}
