import { Injectable, Logger } from "@nestjs/common";
import {
  JwtService,
  TokenExpiredError as NestTokenExpiredError,
} from "@nestjs/jwt";
import * as argon2 from "argon2";
import { TypedConfigService } from "../../config/typed-config.service";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { RoleService } from "./role.service";
import { UserService } from "./user.service";
import {
  AuthUserProfile,
  LoginResponse,
  RefreshResponse,
} from "./dto/auth-response.dto";

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  permissions: string[];
  type: "access" | "refresh";
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserService,
    private readonly roles: RoleService,
    private readonly jwt: JwtService,
    private readonly config: TypedConfigService,
  ) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.users.findByUsernameWithRole(username);
    // 用同一个 INVALID_CREDENTIALS 错误码防账号枚举
    if (!user) {
      throw new BusinessException(
        ErrorCode.INVALID_CREDENTIALS,
        "Invalid username or password",
      );
    }
    if (user.status === "DISABLED") {
      throw new BusinessException(
        ErrorCode.USER_DISABLED,
        "User account is disabled",
      );
    }
    const passwordOk = await argon2
      .verify(user.passwordHash, password)
      .catch(() => false);
    if (!passwordOk) {
      throw new BusinessException(
        ErrorCode.INVALID_CREDENTIALS,
        "Invalid username or password",
      );
    }

    const permissions = this.roles.extractPermissions(user.role);
    const tokens = this.issueTokens({
      sub: user.id,
      username: user.username,
      role: user.role.name,
      permissions,
    });

    this.users.touchLastLogin(user.id);

    return {
      ...tokens,
      tokenType: "Bearer",
      user: this.toProfile(
        user.id,
        user.username,
        user.displayName,
        user.role.name,
        permissions,
      ),
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch (err) {
      if (err instanceof NestTokenExpiredError) {
        throw new BusinessException(
          ErrorCode.TOKEN_EXPIRED,
          "Refresh token expired",
        );
      }
      throw new BusinessException(
        ErrorCode.TOKEN_INVALID,
        "Invalid refresh token",
      );
    }
    if (!payload || payload.type !== "refresh" || !payload.sub) {
      throw new BusinessException(
        ErrorCode.TOKEN_INVALID,
        "Invalid refresh token",
      );
    }

    const user = await this.users.findByIdWithRole(payload.sub);
    if (!user) {
      throw new BusinessException(
        ErrorCode.TOKEN_INVALID,
        "Refresh token subject not found",
      );
    }
    if (user.status === "DISABLED") {
      throw new BusinessException(
        ErrorCode.USER_DISABLED,
        "User account is disabled",
      );
    }

    const permissions = this.roles.extractPermissions(user.role);
    const tokens = this.issueTokens({
      sub: user.id,
      username: user.username,
      role: user.role.name,
      permissions,
    });

    return { ...tokens, tokenType: "Bearer" };
  }

  async getMe(currentUser: JwtUser): Promise<AuthUserProfile> {
    const user = await this.users.findByIdWithRole(currentUser.sub);
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, "User not found");
    }
    if (user.status === "DISABLED") {
      throw new BusinessException(
        ErrorCode.USER_DISABLED,
        "User account is disabled",
      );
    }
    const permissions = this.roles.extractPermissions(user.role);
    return this.toProfile(
      user.id,
      user.username,
      user.displayName,
      user.role.name,
      permissions,
    );
  }

  private issueTokens(payload: Omit<JwtPayload, "type">): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } {
    const accessToken = this.jwt.sign(
      { ...payload, type: "access" },
      {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.config.jwt.accessTtl,
      },
    );
    const refreshToken = this.jwt.sign(
      { ...payload, type: "refresh" },
      {
        secret: this.config.jwt.refreshSecret,
        expiresIn: this.config.jwt.refreshTtl,
      },
    );
    const expiresIn = this.parseTtlToSeconds(this.config.jwt.accessTtl);
    return { accessToken, refreshToken, expiresIn };
  }

  private toProfile(
    id: string,
    username: string,
    displayName: string | null,
    role: string,
    permissions: string[],
  ): AuthUserProfile {
    return {
      id,
      username,
      name: displayName ?? username,
      role,
      permissions,
    };
  }

  /** 解析 '15m' / '7d' / '1h' / '30s' / '900' (秒) 等 TTL 字符串为秒数,解析失败时回退 900s */
  private parseTtlToSeconds(ttl: string): number {
    if (/^\d+$/.test(ttl)) return parseInt(ttl, 10);
    const m = /^(\d+)\s*([smhd])$/i.exec(ttl.trim());
    if (!m) return 900;
    const n = parseInt(m[1], 10);
    switch (m[2].toLowerCase()) {
      case "s":
        return n;
      case "m":
        return n * 60;
      case "h":
        return n * 3600;
      case "d":
        return n * 86400;
      default:
        return 900;
    }
  }
}
