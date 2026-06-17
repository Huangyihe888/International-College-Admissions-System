import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { AlsService } from "./als.module";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly als: AlsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const headerReqId = (req.headers["x-request-id"] as string) || undefined;
    const requestId = headerReqId || this.als.newRequestId();
    res.setHeader("x-request-id", requestId);

    const headerVid = req.headers["x-visitor-id"] as string | undefined;
    const cookieVid = (req.headers.cookie ?? "").match(
      /(?:^|;\s*)wyu_vid=([^;]+)/,
    )?.[1];
    const ctx = {
      requestId,
      startTime: Date.now(),
      ip: (req.ip || req.socket.remoteAddress || "").replace("::ffff:", ""),
      userAgent: (req.headers["user-agent"] as string) || "",
      visitorId:
        headerVid || (cookieVid ? decodeURIComponent(cookieVid) : undefined),
    };

    this.als.run(ctx, () => next());
  }
}
