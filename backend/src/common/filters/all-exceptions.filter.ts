import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ZodError } from "zod";
import { BusinessException } from "../errors/business.exception";
import { ErrorCode } from "../errors/error-code";
import { ApiResponse, fail } from "../response/api-response";
import { AlsService } from "../async-local/als.module";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly als: AlsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const store = this.als.get();
    const requestId =
      store?.requestId ||
      (request.headers["x-request-id"] as string) ||
      "unknown";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.UNKNOWN;
    let message = "Internal Server Error";
    let data: unknown = null;
    let stack: string | undefined;

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      data = exception.data;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;
      if (
        r &&
        typeof r === "object" &&
        "code" in r &&
        typeof r.code === "number"
      ) {
        code = r.code as ErrorCode;
      } else {
        code = this.mapStatusToCode(status);
      }
      message =
        typeof r === "string"
          ? r
          : (r?.message as string) || exception.message || message;
      if (Array.isArray(r?.message)) {
        message = "Validation failed";
        data = { errors: r.message };
        code = ErrorCode.VALIDATION_FAILED;
      } else if (r?.message && r?.message !== message) {
        data = r?.data ?? null;
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCode.VALIDATION_FAILED;
      message = "Validation failed";
      data = { errors: exception.issues };
    } else if (exception instanceof Error) {
      message = exception.message || message;
      stack = exception.stack;
    }

    const body: ApiResponse<unknown> = fail(code, message, requestId, data);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${code} ${message}`,
        stack,
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${code} ${message}`,
      );
    }

    response.status(status).json(body);
  }

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case 400:
        return ErrorCode.VALIDATION_FAILED;
      case 401:
        return ErrorCode.UNAUTHORIZED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.CONFLICT;
      case 429:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.UNKNOWN;
    }
  }
}
