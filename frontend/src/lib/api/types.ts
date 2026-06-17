/**
 * 后端统一响应格式 (与 backend ResponseInterceptor 一致)
 * 详见 docs/api.md §11 与 CLAUDE.md §4.1
 */
export interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  requestId?: string;
  timestamp?: number;
  traceId?: string;
}

/** 业务错误码 (与 backend/src/common/errors/error-code.ts 保持一致) */
export const ErrorCode = {
  SUCCESS: 0,
  VALIDATION_FAILED: 40000,
  MISSING_PARAM: 40001,
  UNAUTHORIZED: 40100,
  REFRESH_INVALID: 40101,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  CONFLICT: 40900,
  RATE_LIMITED: 42900,
  INTERNAL: 50000,
  LLM_UPSTREAM: 50001,
  EMBED_UPSTREAM: 50002,
  RERANK_UPSTREAM: 50003,
  UNAVAILABLE: 50300,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 是否为管理员鉴权错误(40100/40101/40300 都要走跳登录) */
export function isAdminAuthError(code: number): boolean {
  return code === ErrorCode.UNAUTHORIZED || code === ErrorCode.REFRESH_INVALID;
}
