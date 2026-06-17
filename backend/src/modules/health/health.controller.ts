import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { Response } from "express";
import { Public } from "../../common/decorators/auth.decorators";
import { HealthCheckResult, HealthService } from "./health.service";

@Controller("health")
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  live(): { status: "ok"; timestamp: number } {
    return { status: "ok", timestamp: Date.now() };
  }

  @Get("ready")
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthCheckResult> {
    const result = await this.health.check();
    res.status(
      result.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
