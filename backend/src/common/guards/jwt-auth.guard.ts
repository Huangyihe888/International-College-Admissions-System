import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/auth.decorators";
import { BusinessException } from "../errors/business.exception";
import { ErrorCode } from "../errors/error-code";

const isTokenExpiredError = (info: unknown): boolean => {
  if (!info || typeof info !== "object") return false;
  const name = (info as { name?: unknown }).name;
  const expiredAt = (info as { expiredAt?: unknown }).expiredAt;
  return name === "TokenExpiredError" && expiredAt instanceof Date;
};

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T | false, info: unknown): T {
    if (user) {
      return user;
    }
    if (isTokenExpiredError(info)) {
      throw new BusinessException(
        ErrorCode.TOKEN_EXPIRED,
        "Access token expired",
      );
    }
    if (info) {
      throw new BusinessException(
        ErrorCode.TOKEN_INVALID,
        "Invalid or malformed token",
      );
    }
    if (err) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, "Unauthorized");
    }
    throw new BusinessException(ErrorCode.UNAUTHORIZED, "Unauthorized");
  }
}
