import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { StorageService } from "../../storage/storage.service";

export type HealthStatus = "ok" | "degraded";

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface HealthCheckResult {
  status: HealthStatus;
  checks: {
    postgres: CheckResult;
    redis: CheckResult;
    minio: CheckResult;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private static readonly TIMEOUT_MS = 3000;
  private static readonly ERROR_MAX_LEN = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const overallTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `readiness check timed out after ${HealthService.TIMEOUT_MS}ms`,
            ),
          ),
        HealthService.TIMEOUT_MS,
      );
    });

    const work = (async (): Promise<HealthCheckResult> => {
      const [postgres, redis, minio] = await Promise.all([
        this.runCheck(() => this.prisma.$queryRaw`SELECT 1`),
        this.runCheck(async () => {
          const reply = await this.redis.client.ping();
          if (reply !== "PONG") {
            throw new Error(`unexpected ping reply: ${String(reply)}`);
          }
        }),
        this.runCheck(() => this.storage.statObject("__healthcheck__")),
      ]);
      const allOk = postgres.ok && redis.ok && minio.ok;
      return {
        status: allOk ? "ok" : "degraded",
        checks: { postgres, redis, minio },
      };
    })();

    try {
      return await Promise.race([work, overallTimeout]);
    } catch (e) {
      const elapsed = Date.now() - startedAt;
      const err = ((e as Error)?.message ?? String(e)).slice(
        0,
        HealthService.ERROR_MAX_LEN,
      );
      this.logger.warn(`readiness degraded: ${err}`);
      return {
        status: "degraded",
        checks: {
          postgres: { ok: false, latencyMs: elapsed, error: err },
          redis: { ok: false, latencyMs: elapsed, error: err },
          minio: { ok: false, latencyMs: elapsed, error: err },
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runCheck(fn: () => Promise<unknown>): Promise<CheckResult> {
    const start = Date.now();
    try {
      await fn();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      const msg = ((e as Error)?.message ?? String(e)).slice(
        0,
        HealthService.ERROR_MAX_LEN,
      );
      return { ok: false, latencyMs: Date.now() - start, error: msg };
    }
  }
}
