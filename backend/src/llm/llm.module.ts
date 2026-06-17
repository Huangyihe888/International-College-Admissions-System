import { Global, Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { EmbeddingService } from "./embedding.service";
import { RerankService } from "./rerank.service";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.provider";

@Global()
@Module({
  providers: [
    OpenAiCompatibleProvider,
    LlmService,
    EmbeddingService,
    RerankService,
  ],
  exports: [LlmService, EmbeddingService, RerankService],
})
export class LlmModule {}
