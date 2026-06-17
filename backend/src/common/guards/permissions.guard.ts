import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from "../decorators/auth.decorators";
import { JwtUser } from "../decorators/current-user.decorator";
import { BusinessException } from "../errors/business.exception";
import { ErrorCode } from "../errors/error-code";

const WILDCARD = "*";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const user = req.user;
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, "Unauthorized");
    }
    if (user.permissions?.includes(WILDCARD)) {
      return true;
    }
    const granted = new Set(user.permissions ?? []);
    if (this.allGranted(required, granted)) {
      return true;
    }
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      `Missing required permission(s): ${required.join(", ")}`,
    );
  }

  private allGranted(required: string[], granted: Set<string>): boolean {
    for (const perm of required) {
      if (granted.has(perm)) continue;
      const [scope] = perm.split(":");
      if (scope && granted.has(`${scope}:*`)) continue;
      return false;
    }
    return true;
  }
}
