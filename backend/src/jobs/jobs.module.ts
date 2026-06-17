import { Global, Module, Provider } from "@nestjs/common";
import { Queue } from "bullmq";
import { TypedConfigService } from "../config/typed-config.service";
import {
  DOCUMENT_INGEST_QUEUE,
  DOCUMENT_INGEST_QUEUE_NAME,
  EMBEDDING_BATCH_QUEUE,
  EMBEDDING_BATCH_QUEUE_NAME,
} from "./jobs.constants";
import { ProcessorRegistry } from "./processor-registry.service";
import { QueueService } from "./queue.service";
import { DocumentIngestProcessor } from "./processors/document-ingest.processor";
import { EmbeddingBatchProcessor } from "./processors/embedding-batch.processor";

function buildQueueFactory(name: string): Provider {
  return {
    provide:
      name === DOCUMENT_INGEST_QUEUE_NAME
        ? DOCUMENT_INGEST_QUEUE
        : EMBEDDING_BATCH_QUEUE,
    inject: [TypedConfigService],
    useFactory: (cfg: TypedConfigService) =>
      new Queue(name, {
        connection: {
          host: cfg.redis.host,
          port: cfg.redis.port,
          password: cfg.redis.password,
          db: cfg.redis.db,
          keyPrefix: cfg.bullmqPrefix,
        },
      }),
  };
}

@Global()
@Module({
  providers: [
    buildQueueFactory(DOCUMENT_INGEST_QUEUE_NAME),
    buildQueueFactory(EMBEDDING_BATCH_QUEUE_NAME),
    QueueService,
    ProcessorRegistry,
    DocumentIngestProcessor,
    EmbeddingBatchProcessor,
  ],
  exports: [QueueService, DOCUMENT_INGEST_QUEUE, EMBEDDING_BATCH_QUEUE],
})
export class JobsModule {}
