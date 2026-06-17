import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import { NextFunction, Request, Response } from "express";
import { AlsService } from "../../common/async-local/als.module";

const VID_ALPHABET = "1234567890abcdefghijklmnopqrstuvwxyz";
const VID_LENGTH = 22;
const VID_MAX_AGE_SEC = 60 * 60 * 24 * 180; // 180 天
const VID_COOKIE_NAME = "wyu_vid";

const newVisitorId = customAlphabet(VID_ALPHABET, VID_LENGTH);

/**
 * ChatModule 的 visitorId 中间件。
 *
 * 设计要点:
 * - 该中间件在 RequestContextMiddleware 之后跑(RequestContextMiddleware 先把 cookie/header 里的
 *   visitorId 写进 als.visitorId,本中间件再决定是否生成 + 下发 Set-Cookie)。
 * - 优先级:已有的 x-visitor-id header > als.visitorId(可能来自 cookie)> 新生成。
 *   任何分支都会把最终 id 写回 req.headers['x-visitor-id'],这样:
 *   1) @VisitorId() 装饰器读 header 时能拿到
 *   2) 业务代码读 req.headers 一致行为
 * - 每次请求都下发 Set-Cookie(refresh 过期时间),让"经常访问"的访客 cookie 滚动续期。
 * - 匿名访客场景没有 cookie-parser 也没关系:RequestContextMiddleware 那一行已覆盖 cookie 解析兜底;
 *   本中间件专注于"下发 / 续期"动作。
 */
@Injectable()
export class VisitorIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(VisitorIdMiddleware.name);

  constructor(private readonly als: AlsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const existing =
      (req.headers["x-visitor-id"] as string | undefined) ||
      this.als.get()?.visitorId;
    let visitorId = existing?.trim();
    let justGenerated = false;

    if (!visitorId) {
      visitorId = newVisitorId();
      justGenerated = true;
    }

    // 保证后续装饰器 / 业务代码能从 header 读到
    req.headers["x-visitor-id"] = visitorId;
    // 同步到 als(让本请求后续链路 / 日志的 visitorId 字段一致)
    this.als.set({ visitorId });

    // 设置 Set-Cookie 头;若上游已设置过同 name 的 Cookie,Node 会以分号追加而非覆盖,
    // 因此覆盖式下发使用 res.setHeader('Set-Cookie', ...) 重置数组更稳。
    const cookie = [
      `${VID_COOKIE_NAME}=${encodeURIComponent(visitorId)}`,
      "Path=/",
      `Max-Age=${VID_MAX_AGE_SEC}`,
      "SameSite=Lax",
      // HttpOnly=false:前端 JS 需要能读到该 cookie 以便在 fetch 时回写 x-visitor-id header
      // (XSS 风险由 helmet / CSP 兜底,visitorId 本身是非敏感标识)
    ].join("; ");
    res.setHeader("Set-Cookie", cookie);

    if (justGenerated) {
      this.logger.debug?.(
        `[chat] generated visitorId=${visitorId.slice(0, 6)}…`,
      );
    }

    next();
  }
}
