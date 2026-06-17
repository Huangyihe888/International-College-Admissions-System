import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";
import { ResponseInterceptor } from "./interceptors/response.interceptor";
import { RequestContextMiddleware } from "./async-local/request-context.middleware";
import { AlsService } from "./async-local/als.module";
import { LoggerModule } from "./logger/logger.module";
import { PromService } from "./metrics/prom.service";
import { MetricsController } from "./metrics/metrics.controller";
import { RedisRateLimitGuard } from "./rate-limit/redis-rate-limit.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { RedisModule } from "../redis/redis.module";

@Global()
@Module({
  imports: [LoggerModule, RedisModule],
  controllers: [MetricsController],
  providers: [
    AlsService,
    PromService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: RedisRateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  exports: [AlsService, PromService, LoggerModule],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
