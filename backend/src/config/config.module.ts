import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { EnvSchema } from "./env.schema";
import { TypedConfigService } from "./typed-config.service";

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [".env.local", ".env"],
      validate: (raw) => {
        const result = EnvSchema.safeParse(raw);
        if (!result.success) {
          const issues = result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n  - ");
          throw new Error(`Invalid environment variables:\n  - ${issues}`);
        }
        return result.data;
      },
    }),
  ],
  providers: [TypedConfigService],
  exports: [TypedConfigService],
})
export class AppConfigModule {}
