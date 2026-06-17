import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigModule } from "./config/config.module";
import { CommonModule } from "./common/common.module";
import { PrismaModule } from "./database/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { StorageModule } from "./storage/storage.module";
import { LlmModule } from "./llm/llm.module";
import { JobsModule } from "./jobs/jobs.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { DocumentModule } from "./modules/document/document.module";
import { RagModule } from "./modules/rag/rag.module";
import { ChatModule } from "./modules/chat/chat.module";
import { EnvSchema } from "./config/env.schema";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw) => {
        const r = EnvSchema.safeParse(raw);
        if (!r.success) {
          const first = r.error.issues[0];
          throw new Error(
            `Invalid environment: ${first?.path?.join(".") ?? "?"} - ${first?.message ?? r.error.message}`,
          );
        }
        return r.data;
      },
    }),
    AppConfigModule,
    CommonModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    LlmModule,
    JobsModule,
    AuthModule,
    HealthModule,
    AdminModule,
    AnalyticsModule,
    DocumentModule,
    RagModule,
    ChatModule,
  ],
})
export class AppModule {}
