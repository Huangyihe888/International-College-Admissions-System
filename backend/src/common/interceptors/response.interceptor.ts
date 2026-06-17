import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from "@nestjs/common";
import { Observable, map } from "rxjs";
import { AlsService } from "../async-local/als.module";
import { ApiResponse, ok } from "../response/api-response";

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly als: AlsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const http = context.switchToHttp();
        const res = http.getResponse();
        if (res?.sse || res?.locals?.sse) return data;
        if (data instanceof StreamableFile) return data;
        const requestId = this.als.get()?.requestId || "unknown";
        return ok(data, requestId);
      }),
    );
  }
}
