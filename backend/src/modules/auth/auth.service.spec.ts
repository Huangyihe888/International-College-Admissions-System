/**
 * AuthService 单元测试
 * 覆盖:login / refresh / getMe 主流程 + 各种错误码分支。
 * UserService / RoleService / JwtService / argon2 / TypedConfigService 全部 mock。
 */
import { AuthService, JwtPayload } from "./auth.service";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";

// mock @nestjs/jwt(避免依赖 jsonwebtoken 实际安装)
jest.mock("@nestjs/jwt", () => {
  class TokenExpiredError extends Error {
    expiredAt: Date;
    constructor(message: string, expiredAt: Date) {
      super(message);
      this.name = "TokenExpiredError";
      this.expiredAt = expiredAt;
    }
  }
  return {
    JwtService: class JwtService {},
    TokenExpiredError,
    NotBeforeError: class NotBeforeError extends Error {},
    JsonWebTokenError: class JsonWebTokenError extends Error {},
  };
});

// mock argon2(native,避免 native binding)
jest.mock("argon2", () => ({
  verify: jest.fn(),
  hash: jest.fn(),
  argon2id: 2,
}));

import { TokenExpiredError as NestTokenExpiredError } from "@nestjs/jwt";
import * as argon2 from "argon2";

function makeDeps(
  over: Partial<{
    jwtRefreshSecret: string;
    jwtAccessTtl: string;
    jwtRefreshTtl: string;
  }> = {},
) {
  const users = {
    findByUsernameWithRole: jest.fn(),
    findByIdWithRole: jest.fn(),
    touchLastLogin: jest.fn(),
  } as any;
  const roles = {
    extractPermissions: jest.fn(),
  } as any;
  const jwt = {
    sign: jest.fn().mockImplementation((payload, opts) => {
      // 简单区分:有 access type 给 accessToken, refresh 给 refreshToken
      if (payload.type === "access")
        return "access." + JSON.stringify({ p: payload, o: opts });
      if (payload.type === "refresh")
        return "refresh." + JSON.stringify({ p: payload, o: opts });
      return "tok";
    }),
    verifyAsync: jest.fn(),
  } as any;
  const config = {
    jwt: {
      accessSecret: "a-sec",
      refreshSecret: over.jwtRefreshSecret ?? "r-sec",
      accessTtl: over.jwtAccessTtl ?? "15m",
      refreshTtl: over.jwtRefreshTtl ?? "7d",
    },
  } as any;
  const svc = new AuthService(users, roles, jwt, config);
  return { svc, users, roles, jwt, config };
}

const userActive = {
  id: "u1",
  username: "admin",
  displayName: "Admin",
  passwordHash: "hashed",
  status: "ACTIVE" as const,
  role: { id: "r1", name: "admin", permissions: ["kb:read", "kb:write"] },
};

const userDisabled = { ...userActive, id: "u2", status: "DISABLED" as const };

describe("AuthService.login", () => {
  it("login 成功:返回 access/refresh token + user profile", async () => {
    const { svc, users, roles, jwt } = makeDeps();
    users.findByUsernameWithRole.mockResolvedValueOnce(userActive);
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
    roles.extractPermissions.mockReturnValueOnce(["kb:read", "kb:write"]);

    const res = await svc.login("admin", "secret");

    expect(res.tokenType).toBe("Bearer");
    expect(res.accessToken).toMatch(/^access\./);
    expect(res.refreshToken).toMatch(/^refresh\./);
    expect(res.user).toEqual({
      id: "u1",
      username: "admin",
      name: "Admin",
      role: "admin",
      permissions: ["kb:read", "kb:write"],
    });
    // 写 access token 时 ttl=15m
    const accessCall = jwt.sign.mock.calls.find(
      (c: unknown[]) => (c[0] as { type?: string }).type === "access",
    );
    expect(accessCall![1]).toEqual({ secret: "a-sec", expiresIn: "15m" });
    // 触发 touchLastLogin
    expect(users.touchLastLogin).toHaveBeenCalledWith("u1");
  });

  it("login 密码错:抛 INVALID_CREDENTIALS(2001)", async () => {
    const { svc, users } = makeDeps();
    users.findByUsernameWithRole.mockResolvedValueOnce(userActive);
    (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

    await expect(svc.login("admin", "wrong")).rejects.toBeInstanceOf(
      BusinessException,
    );
    await expect(svc.login("admin", "wrong")).rejects.toMatchObject({
      code: ErrorCode.INVALID_CREDENTIALS,
    });
  });

  it("login 用户禁用(2004):禁用状态优先于密码校验", async () => {
    const { svc, users } = makeDeps();
    users.findByUsernameWithRole.mockResolvedValueOnce(userDisabled);

    await expect(svc.login("disabled-user", "whatever")).rejects.toMatchObject({
      code: ErrorCode.USER_DISABLED,
    });
    // 不该走 argon2.verify
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  it("login 用户找不到:抛 INVALID_CREDENTIALS(防账号枚举,2001)", async () => {
    const { svc, users } = makeDeps();
    users.findByUsernameWithRole.mockResolvedValueOnce(null);

    await expect(svc.login("ghost", "x")).rejects.toMatchObject({
      code: ErrorCode.INVALID_CREDENTIALS,
      message: "Invalid username or password",
    });
  });

  it("login argon2.verify 抛错:被 catch 转 false → INVALID_CREDENTIALS", async () => {
    const { svc, users } = makeDeps();
    users.findByUsernameWithRole.mockResolvedValueOnce(userActive);
    (argon2.verify as jest.Mock).mockRejectedValueOnce(
      new Error("native crash"),
    );

    await expect(svc.login("admin", "x")).rejects.toMatchObject({
      code: ErrorCode.INVALID_CREDENTIALS,
    });
  });
});

describe("AuthService.refresh", () => {
  it("refresh token 过期:抛 TOKEN_EXPIRED(2002)", async () => {
    const { svc, jwt } = makeDeps();
    jwt.verifyAsync.mockRejectedValueOnce(
      new NestTokenExpiredError("jwt expired", new Date()),
    );

    await expect(svc.refresh("old.rtok")).rejects.toMatchObject({
      code: ErrorCode.TOKEN_EXPIRED,
    });
  });

  it("refresh token 签名错(JsonWebTokenError):抛 TOKEN_INVALID(2003)", async () => {
    const { svc, jwt } = makeDeps();
    // 模拟 verifyAsync 抛一个非 TokenExpiredError 的 Error
    jwt.verifyAsync.mockRejectedValueOnce(new Error("invalid signature"));

    await expect(svc.refresh("bad.rtok")).rejects.toMatchObject({
      code: ErrorCode.TOKEN_INVALID,
    });
  });

  it("refresh payload 缺少 sub / type 不对:抛 TOKEN_INVALID(2003)", async () => {
    const { svc, jwt, users } = makeDeps();
    // 验证通过但 payload 不合规
    jwt.verifyAsync.mockResolvedValueOnce({
      sub: "u1",
      username: "admin",
      role: "admin",
      permissions: [],
      // type 缺失
    } as Partial<JwtPayload> as JwtPayload);

    await expect(svc.refresh("rtok")).rejects.toMatchObject({
      code: ErrorCode.TOKEN_INVALID,
    });
    // 不会再查 DB
    expect(users.findByIdWithRole).not.toHaveBeenCalled();
  });

  it("refresh 用户被禁:抛 USER_DISABLED(2004)", async () => {
    const { svc, jwt, users } = makeDeps();
    jwt.verifyAsync.mockResolvedValueOnce({
      sub: "u2",
      username: "admin",
      role: "admin",
      permissions: [],
      type: "refresh",
    } as JwtPayload);
    users.findByIdWithRole.mockResolvedValueOnce(userDisabled);

    await expect(svc.refresh("rtok")).rejects.toMatchObject({
      code: ErrorCode.USER_DISABLED,
    });
  });

  it("refresh 找不到 user(可能已被删):抛 TOKEN_INVALID(2003)", async () => {
    const { svc, jwt, users } = makeDeps();
    jwt.verifyAsync.mockResolvedValueOnce({
      sub: "u-gone",
      username: "admin",
      role: "admin",
      permissions: [],
      type: "refresh",
    } as JwtPayload);
    users.findByIdWithRole.mockResolvedValueOnce(null);

    await expect(svc.refresh("rtok")).rejects.toMatchObject({
      code: ErrorCode.TOKEN_INVALID,
    });
  });

  it("refresh 成功:返回新的 access/refresh token", async () => {
    const { svc, jwt, users, roles } = makeDeps();
    jwt.verifyAsync.mockResolvedValueOnce({
      sub: "u1",
      username: "admin",
      role: "admin",
      permissions: [],
      type: "refresh",
    } as JwtPayload);
    users.findByIdWithRole.mockResolvedValueOnce(userActive);
    roles.extractPermissions.mockReturnValueOnce(["kb:read"]);

    const res = await svc.refresh("rtok");
    expect(res.tokenType).toBe("Bearer");
    expect(res.accessToken).toMatch(/^access\./);
    expect(res.refreshToken).toMatch(/^refresh\./);
  });
});

describe("AuthService.getMe", () => {
  it("getMe 成功:返回 user profile", async () => {
    const { svc, users, roles } = makeDeps();
    users.findByIdWithRole.mockResolvedValueOnce(userActive);
    roles.extractPermissions.mockReturnValueOnce(["kb:read"]);

    const profile = await svc.getMe({
      sub: "u1",
      username: "admin",
      role: "admin",
      permissions: [],
      type: "access",
    });
    expect(profile).toEqual({
      id: "u1",
      username: "admin",
      name: "Admin",
      role: "admin",
      permissions: ["kb:read"],
    });
  });

  it("getMe 用户被删(查不到):抛 UNAUTHORIZED(1002)", async () => {
    const { svc, users } = makeDeps();
    users.findByIdWithRole.mockResolvedValueOnce(null);

    await expect(
      svc.getMe({
        sub: "u-gone",
        username: "x",
        role: "admin",
        permissions: [],
        type: "access",
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it("getMe 用户被禁:抛 USER_DISABLED(2004)", async () => {
    const { svc, users } = makeDeps();
    users.findByIdWithRole.mockResolvedValueOnce(userDisabled);

    await expect(
      svc.getMe({
        sub: "u2",
        username: "x",
        role: "admin",
        permissions: [],
        type: "access",
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.USER_DISABLED,
    });
  });
});

describe("AuthService parseTtlToSeconds(透传 expiresIn)", () => {
  // 通过观察 jwt.sign 的 expiresIn 行为来间接测试(对最终 response.expiresIn 做断言)
  it.each([
    ["15m", 900],
    ["7d", 604800],
    ["1h", 3600],
    ["30s", 30],
    ["900", 900],
    ["invalid", 900], // fallback
  ])("accessTtl=%s → expiresIn=%d", async (ttl, expected) => {
    const { svc, users, roles } = makeDeps({ jwtAccessTtl: ttl });
    users.findByUsernameWithRole.mockResolvedValueOnce(userActive);
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
    roles.extractPermissions.mockReturnValueOnce(["p"]);
    const res = await svc.login("admin", "x");
    expect(res.expiresIn).toBe(expected);
  });
});
