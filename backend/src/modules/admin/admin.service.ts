import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AlsService } from "../../common/async-local/als.module";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PrismaService } from "../../database/prisma.service";

export interface AdminActionInput {
  user: JwtUser | undefined;
  action: string;
  resource?: string;
  resourceId?: string;
  payload?: Record<string, unknown> | null;
}

/**
 * AdminModule 共享 service。
 * 写操作审计日志(Task 10.6)— 所有 admin 写接口在 service 层调用 recordAction。
 * 不抛异常:审计失败用 warn 日志记录,避免阻塞业务写入。
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly als: AlsService,
  ) {}

  async recordAction(input: AdminActionInput): Promise<void> {
    const ctx = this.als.get();
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.user?.sub,
          username: input.user?.username,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          payload: input.payload
            ? (input.payload as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ip: ctx?.ip,
          userAgent: ctx?.userAgent,
        },
      });
    } catch (err) {
      this.logger.warn(
        `audit log write failed action=${input.action} resource=${input.resource ?? "-"} err=${(err as Error)?.message ?? err}`,
      );
    }
  }
}
