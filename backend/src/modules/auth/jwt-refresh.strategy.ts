import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { TypedConfigService } from "../../config/typed-config.service";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { JwtUser } from "../../common/decorators/current-user.decorator";

export const JWT_REFRESH_STRATEGY = "jwt-refresh";

const refreshTokenExtractor = (req: Request): string | null => {
  if (!req) return null;
  const body = (req as any).body as { refreshToken?: unknown } | undefined;
  if (
    body &&
    typeof body.refreshToken === "string" &&
    body.refreshToken.length > 0
  ) {
    return body.refreshToken;
  }
  const cookies = (req as any).cookies as { refreshToken?: string } | undefined;
  if (
    cookies &&
    typeof cookies.refreshToken === "string" &&
    cookies.refreshToken.length > 0
  ) {
    return cookies.refreshToken;
  }
  return null;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  JWT_REFRESH_STRATEGY,
) {
  constructor(config: TypedConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        refreshTokenExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.jwt.refreshSecret,
    });
  }

  validate(payload: {
    sub: string;
    username: string;
    role: string;
    permissions: string[];
    type: string;
  }): JwtUser {
    if (payload.type !== "refresh") {
      throw new BusinessException(
        ErrorCode.TOKEN_INVALID,
        "Refresh token required",
      );
    }
    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
      type: "refresh",
    };
  }
}
