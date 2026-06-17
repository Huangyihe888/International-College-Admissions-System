import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { TypedConfigService } from "../config/typed-config.service";

export const REDIS_CLIENT = "REDIS_CLIENT";
export const REDIS_SUBSCRIBER = "REDIS_SUBSCRIBER";

export const InjectRedis = (name: string = REDIS_CLIENT) => `${name}_INJECT`;

function buildClient(cfg: TypedConfigService, keyPrefix?: string): Redis {
  return new Redis({
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password,
    db: cfg.redis.db,
    keyPrefix: keyPrefix ?? cfg.redis.keyPrefix,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    reconnectOnError: (err) => {
      const msg = err.message;
      if (msg.includes("READONLY")) return true;
      return false;
    },
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [TypedConfigService],
      useFactory: (cfg: TypedConfigService) => buildClient(cfg),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [TypedConfigService],
      useFactory: (cfg: TypedConfigService) => buildClient(cfg, undefined),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisClientModule {}
