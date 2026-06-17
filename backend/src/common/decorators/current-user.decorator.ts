import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface JwtUser {
  sub: string;
  username: string;
  role: string;
  permissions: string[];
  type: "access" | "refresh";
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as JwtUser | undefined;
  },
);

export const VisitorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest();
    const als = (req as any).alsContext;
    if (als?.visitorId) return als.visitorId;
    return (req.headers["x-visitor-id"] as string) || undefined;
  },
);
