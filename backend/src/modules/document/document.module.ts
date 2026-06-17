import { Module } from "@nestjs/common";
import { DocumentController } from "./document.controller";
import { DocumentService } from "./document.service";

/**
 * DocumentModule — 文档上传 / 解析 / 切分 / Embedding 流水线。
 *
 * 依赖:
 * - PrismaService:database 模块提供
 * - StorageService:`StorageModule` 已 `@Global`,直接 inject
 * - QueueService / DocumentIngestProcessor:`JobsModule` 已 `@Global`,直接 inject
 * - EmbeddingService:`LlmModule` 已 `@Global`,直接 inject
 *
 * AppModule 注册由主会话统一加,本任务不在 app.module.ts 改。
 */
@Module({
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
