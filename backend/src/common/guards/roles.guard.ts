import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { IS_PUBLIC_KEY, ROLES_KEY } from "../decorators/auth.decorators";
import { JwtUser } from "../decorators/current-user.decorator";
import { BusinessException } from "../errors/business.exception";
import { ErrorCode } from "../errors/error-code";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
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
    if (required.includes(user.role)) {
      return true;
    }
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      `Role '${user.role}' is not allowed`,
    );
  }
}
