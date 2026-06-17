import { Global, Module } from "@nestjs/common";
import { RagService } from "./rag.service";
import { ForbidChecker } from "./forbidden/forbid-checker.service";
import { FaqRecallService } from "./faq/faq-recall.service";
import { VectorRecallService } from "./recall/vector-recall.service";
import { PromptBuilder } from "./prompts/prompt-builder.service";

/**
 * RagModule — RAG pipeline 核心
 *
 * 关键设计:
 * - @Global():ChatModule 需 inject RagService(同步 / 流式问答)而不重复 imports,本模块全平台唯一
 * - 不 import LlmModule:LlmModule 自身是 @Global,EmbeddingService / RerankService / LlmService 自动可 inject
 * - 不 import PrismaModule:同 @Global 推论
 * - AppModule 由主会话统一注册;本任务不在 app.module.ts 改动
 */
@Global()
@Module({
  providers: [
    ForbidChecker,
    FaqRecallService,
    VectorRecallService,
    PromptBuilder,
    RagService,
  ],
  exports: [
    RagService,
    ForbidChecker,
    FaqRecallService,
    VectorRecallService,
    PromptBuilder,
  ],
})
export class RagModule {}
