import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { TypedConfigService } from "../../config/typed-config.service";
import { JwtUser } from "../../common/decorators/current-user.decorator";

export const JWT_ACCESS_STRATEGY = "jwt";

@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy,
  JWT_ACCESS_STRATEGY,
) {
  constructor(config: TypedConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  validate(payload: {
    sub: string;
    username: string;
    role: string;
    permissions: string[];
    type: string;
  }): JwtUser {
    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
      type: "access",
    };
  }
}
