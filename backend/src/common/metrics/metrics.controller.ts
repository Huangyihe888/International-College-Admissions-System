import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../decorators/auth.decorators";
import { PromService } from "./prom.service";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly prom: PromService) {}

  @Get()
  @Public()
  @Header("Cache-Control", "no-store")
  async getMetrics(): Promise<string> {
    const { body } = await this.prom.metrics();
    return body;
  }
}
