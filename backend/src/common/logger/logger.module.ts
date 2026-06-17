import { Global, Module } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { AlsService } from "../async-local/als.module";
import { TypedConfigService } from "../../config/typed-config.service";

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [TypedConfigService, AlsService],
      useFactory: (cfg: TypedConfigService, als: AlsService) => ({
        pinoHttp: {
          level: cfg.logLevel,
          transport: cfg.isDevelopment
            ? {
                target: "pino-pretty",
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: "SYS:HH:MM:ss.l",
                },
              }
            : undefined,
          genReqId: (req, res) => {
            const header =
              (req.headers["x-request-id"] as string) || als.newRequestId();
            res.setHeader("x-request-id", header);
            return header;
          },
          customProps: (req) => {
            const store = als.get();
            return {
              requestId: store?.requestId || (req.id as string),
              userId: store?.userId,
              role: store?.role,
              sessionId: store?.sessionId,
              visitorId: store?.visitorId,
            };
          },
          serializers: {
            req: (req) => ({ method: req.method, url: req.url, ip: req.ip }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.password",
            ],
            censor: "***",
          },
          autoLogging: {
            ignore: (req) =>
              req.url === "/api/v1/health/live" ||
              req.url === "/api/v1/metrics",
          },
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
