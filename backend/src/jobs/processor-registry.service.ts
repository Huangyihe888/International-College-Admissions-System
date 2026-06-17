import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Processor as BullProcessor, Worker } from "bullmq";
import { PromService } from "../common/metrics/prom.service";
import { TypedConfigService } from "../config/typed-config.service";
import { PROCESSOR_METADATA, ProcessorMetadata } from "./processor.decorator";
import { DocumentIngestProcessor } from "./processors/document-ingest.processor";
import { EmbeddingBatchProcessor } from "./processors/embedding-batch.processor";

@Injectable()
export class ProcessorRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessorRegistry.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly cfg: TypedConfigService,
    private readonly prom: PromService,
    private readonly ingestProcessor: DocumentIngestProcessor,
    private readonly embedProcessor: EmbeddingBatchProcessor,
  ) {}

  onModuleInit() {
    this.spawn(this.ingestProcessor);
    this.spawn(this.embedProcessor);
  }

  private spawn(processor: { process: BullProcessor }): void {
    const meta: ProcessorMetadata | undefined = Reflect.getMetadata(
      PROCESSOR_METADATA,
      processor.constructor,
    );
    if (!meta) {
      this.logger.warn(
        `processor ${processor.constructor.name} missing @Processor metadata`,
      );
      return;
    }

    const connection = {
      host: this.cfg.redis.host,
      port: this.cfg.redis.port,
      password: this.cfg.redis.password,
      db: this.cfg.redis.db,
      keyPrefix: this.cfg.bullmqPrefix,
    };

    const worker = new Worker(
      meta.name,
      processor.process.bind(processor) as BullProcessor,
      {
        connection,
        concurrency: meta.concurrency ?? 1,
      },
    );

    worker.on("completed", () => {
      this.prom.queueJobsTotal.inc({ queue: meta.name, status: "completed" });
    });

    worker.on("failed", (_job, err) => {
      this.prom.queueJobsTotal.inc({ queue: meta.name, status: "failed" });
      this.logger.warn(`worker ${meta.name} job failed: ${err.message}`);
    });

    worker.on("error", (err) => {
      this.logger.warn(`worker ${meta.name} runtime error: ${err.message}`);
    });

    this.workers.push(worker);
    this.logger.log(
      `worker spawned for queue "${meta.name}" (concurrency=${meta.concurrency ?? 1})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(
      this.workers.map((w) =>
        w.close().catch((err: Error) => {
          this.logger.warn(`close worker failed: ${err.message}`);
        }),
      ),
    );
  }
}
