import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { BusinessException } from "../errors/business.exception";
import { ErrorCode } from "../errors/error-code";
import { RedisService } from "../../redis/redis.service";
import { TypedConfigService } from "../../config/typed-config.service";

export const RATE_LIMIT_KEY = "rate_limit";
export const RATE_LIMIT_WINDOW_SEC = 60;

export const RateLimit = (perMin: number) =>
  SetMetadata(RATE_LIMIT_KEY, perMin);

@Injectable()
export class RedisRateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
    private readonly cfg: TypedConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const perMin =
      this.reflector.getAllAndOverride<number | undefined>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.cfg.rateLimitPerMin;

    const req = context.switchToHttp().getRequest<Request>();
    const forwarded = req.headers["x-forwarded-for"];
    const ip =
      req.ip ||
      (Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded?.split(",")[0]?.trim()) ||
      "unknown";
    const key = `rl:${ip}`;

    let count: number;
    try {
      count = await this.redis.incrWithTtl(key, RATE_LIMIT_WINDOW_SEC);
    } catch {
      // Redis 不可达时 fail-open,放行请求(降级,生产应该有监控)
      return true;
    }
    if (count > perMin) {
      throw new BusinessException({
        code: ErrorCode.RATE_LIMITED,
        message: `Rate limit exceeded, please retry in ${RATE_LIMIT_WINDOW_SEC}s`,
      });
    }
    return true;
  }
}
