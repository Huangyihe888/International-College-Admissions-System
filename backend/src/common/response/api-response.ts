import { ErrorCode } from "../errors/error-code";

export interface ApiResponse<T = unknown> {
  code: ErrorCode | number;
  message: string;
  data: T | null;
  requestId: string;
  timestamp: number;
}

export const SUCCESS_MESSAGE = "ok";

export function ok<T>(
  data: T,
  requestId: string,
  message: string = SUCCESS_MESSAGE,
): ApiResponse<T> {
  return {
    code: ErrorCode.SUCCESS,
    message,
    data,
    requestId,
    timestamp: Date.now(),
  };
}

export function fail(
  code: ErrorCode,
  message: string,
  requestId: string,
  data: unknown = null,
): ApiResponse<unknown> {
  return {
    code,
    message,
    data,
    requestId,
    timestamp: Date.now(),
  };
}
