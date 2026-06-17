import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from "./redis-client.module";

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) public readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) public readonly subscriber: Redis,
  ) {}

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSec && ttlSec > 0) {
      await this.client.set(key, raw, "EX", ttlSec);
    } else {
      await this.client.set(key, raw);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async incrWithTtl(key: string, ttlSec: number): Promise<number> {
    const v = await this.client.incr(key);
    if (v === 1) await this.client.expire(key, ttlSec);
    return v;
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
    await this.subscriber.quit().catch(() => undefined);
  }
}
