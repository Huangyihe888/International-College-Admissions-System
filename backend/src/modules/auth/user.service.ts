import { Injectable, Logger } from "@nestjs/common";
import { User } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export type UserWithRole = User & {
  role: { id: string; name: string; permissions: unknown };
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  findByUsernameWithRole(username: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({
      where: { username },
      include: {
        role: { select: { id: true, name: true, permissions: true } },
      },
    }) as Promise<UserWithRole | null>;
  }

  findByIdWithRole(id: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        role: { select: { id: true, name: true, permissions: true } },
      },
    }) as Promise<UserWithRole | null>;
  }

  touchLastLogin(id: string): void {
    this.prisma.user
      .update({ where: { id }, data: { lastLoginAt: new Date() } })
      .catch((err) =>
        this.logger.warn(
          `touchLastLogin(${id}) failed: ${err?.message ?? err}`,
        ),
      );
  }
}
