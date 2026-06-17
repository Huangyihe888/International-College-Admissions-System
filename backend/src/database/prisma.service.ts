import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { TypedConfigService } from "../config/typed-config.service";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: TypedConfigService) {
    const log: Prisma.LogLevel[] = config.isProduction
      ? ["warn", "error"]
      : ["warn", "error"];

    super({
      datasources: { db: { url: config.databaseUrl } },
      log,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Prisma connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log("Prisma disconnected");
  }
}
