import { Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

type RolePermissionsSource =
  | Pick<Role, "permissions">
  | { permissions: unknown };

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async findByName(name: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { name } });
  }

  async findById(id: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { id } });
  }

  extractPermissions(role: RolePermissionsSource): string[] {
    const raw = role.permissions;
    if (Array.isArray(raw)) {
      return raw.filter((p): p is string => typeof p === "string");
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((p): p is string => typeof p === "string");
        }
      } catch {
        return [];
      }
    }
    return [];
  }
}
