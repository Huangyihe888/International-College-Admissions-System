import { createHmac } from "node:crypto";

/**
 * 自实现 HS256 签名,避免依赖 jsonwebtoken(@nestjs/jwt 已通过其内部依赖装好,
 * 但 backend node_modules 没 hoist,TypeScript 找不到模块)。
 *
 * 形状与后端 AuthService.issueTokens 一致:
 *   header  = { alg: 'HS256', typ: 'JWT' }
 *   payload = { sub, username, role, permissions, type, iat, exp }
 */

interface SignInput {
  sub: string;
  username: string;
  role?: string;
  permissions?: string[];
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signHS256(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const fullPayload: Record<string, unknown> = {
    iat: now,
    exp: now + expiresInSec,
    ...payload,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const sig = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  return `${headerB64}.${payloadB64}.${sig}`;
}

function parseTtl(ttl: string | number): number {
  if (typeof ttl === "number") return ttl;
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

/** 签测试用 access token(与后端一致的 secret/algorithm) */
export function signTestToken(
  payload: SignInput,
  expiresIn: string | number = "15m",
  secret: string = process.env.JWT_ACCESS_SECRET || "test-secret-12345678",
): string {
  return signHS256({ ...payload, type: "access" }, secret, parseTtl(expiresIn));
}

/** 签一个立即过期的 token(用于断言 2002 TOKEN_EXPIRED) */
export function signExpiredToken(
  payload: SignInput,
  secret: string = process.env.JWT_ACCESS_SECRET || "test-secret-12345678",
): string {
  return signTestToken(payload, -1, secret);
}

/** 签一个 refresh token */
export function signRefreshToken(
  payload: SignInput,
  expiresIn: string | number = "7d",
  secret: string = process.env.JWT_REFRESH_SECRET || "test-secret-87654321",
): string {
  return signHS256(
    { ...payload, type: "refresh" },
    secret,
    parseTtl(expiresIn),
  );
}
