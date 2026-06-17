import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCode } from "./error-code";

export interface BusinessExceptionOptions {
  code?: ErrorCode;
  message?: string;
  status?: HttpStatus;
  data?: unknown;
  cause?: unknown;
}

export class BusinessException extends HttpException {
  public readonly code: ErrorCode;
  public readonly data: unknown;

  constructor(
    opts: BusinessExceptionOptions | string | ErrorCode,
    message?: string,
  ) {
    let options: BusinessExceptionOptions;
    if (typeof opts === "string" || typeof opts === "number") {
      options = { code: opts as ErrorCode, message };
    } else {
      options = opts;
    }
    const status =
      options.status ??
      BusinessException.defaultStatus(options.code ?? ErrorCode.UNKNOWN);
    super(
      {
        code: options.code ?? ErrorCode.UNKNOWN,
        message: options.message ?? "Error",
        data: options.data,
      },
      status,
    );
    this.code = options.code ?? ErrorCode.UNKNOWN;
    this.data = options.data;
    if (options.cause) (this as any).cause = options.cause;
  }

  private static defaultStatus(code: ErrorCode): HttpStatus {
    if (code === ErrorCode.SUCCESS) return HttpStatus.OK;
    if (
      code === ErrorCode.UNAUTHORIZED ||
      code === ErrorCode.TOKEN_EXPIRED ||
      code === ErrorCode.TOKEN_INVALID
    )
      return HttpStatus.UNAUTHORIZED;
    if (code === ErrorCode.FORBIDDEN || code === ErrorCode.USER_DISABLED)
      return HttpStatus.FORBIDDEN;
    if (code === ErrorCode.NOT_FOUND) return HttpStatus.NOT_FOUND;
    if (code === ErrorCode.RATE_LIMITED) return HttpStatus.TOO_MANY_REQUESTS;
    if (code === ErrorCode.CONFLICT) return HttpStatus.CONFLICT;
    if (code === ErrorCode.VALIDATION_FAILED) return HttpStatus.BAD_REQUEST;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
