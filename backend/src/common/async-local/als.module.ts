import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import { customAlphabet } from "nanoid";

export interface RequestContext {
  requestId: string;
  userId?: string;
  username?: string;
  role?: string;
  sessionId?: string;
  visitorId?: string;
  ip?: string;
  userAgent?: string;
  startTime: number;
}

const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);

@Injectable()
export class AlsService {
  readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(ctx: Partial<RequestContext>, fn: () => T): T {
    const full: RequestContext = {
      requestId: ctx.requestId ?? this.newRequestId(),
      startTime: ctx.startTime ?? Date.now(),
      ...ctx,
    };
    return this.storage.run(full, fn);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getOrThrow(): RequestContext {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new Error(
        "Request context is not set. Did you forget to register RequestContextMiddleware?",
      );
    }
    return ctx;
  }

  set(partial: Partial<RequestContext>): void {
    const ctx = this.storage.getStore();
    if (!ctx) return;
    Object.assign(ctx, partial);
  }

  newRequestId(): string {
    return `req_${Date.now().toString(36)}_${nano()}`;
  }
}
