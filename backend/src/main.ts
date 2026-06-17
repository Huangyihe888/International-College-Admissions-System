import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { TypedConfigService } from "./config/typed-config.service";

loadEnv();

function banner(cfg: TypedConfigService): void {
  const line = "─".repeat(64);
  const lines = [
    line,
    "  WYU IECAA RAG  Backend",
    `  env       : ${cfg.nodeEnv}`,
    `  port      : ${cfg.appPort}`,
    `  prefix    : ${cfg.globalPrefix}`,
    `  log level : ${cfg.logLevel}`,
    `  llm       : ${cfg.llmProvider} / ${cfg.llmModel}`,
    `  embed     : ${cfg.embeddingModel} (dim=${cfg.embeddingDim})`,
    `  rerank    : ${cfg.rerankProvider} / ${cfg.rerankModel}`,
    `  storage   : minio://${cfg.minio.endPoint}:${cfg.minio.port}/${cfg.minio.bucket}`,
    `  rate limit: ${cfg.rateLimitPerMin} req/min/ip`,
    line,
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const cfg = app.get(TypedConfigService);

  app.setGlobalPrefix(cfg.globalPrefix.replace(/^\//, ""));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.enableCors({
    origin: cfg.corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Visitor-Id",
    ],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86400,
  });
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  await app.listen(cfg.appPort);
  banner(cfg);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
