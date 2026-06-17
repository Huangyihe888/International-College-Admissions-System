import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  Sse,
} from "@nestjs/common";
import { Observable, defer, finalize, from, mergeMap, of } from "rxjs";
import type { Response } from "express";
import { Public } from "../../common/decorators/auth.decorators";
import { VisitorId } from "../../common/decorators/current-user.decorator";
import { CreateSessionDto } from "./dto/create-session.dto";
import { FeedbackDto } from "./dto/feedback.dto";
import { ListMessagesQueryDto } from "./dto/list-messages-query.dto";
import { ListSessionsQueryDto } from "./dto/list-sessions-query.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { ChatService } from "./chat.service";

/**
 * ChatModule — 家长/访客匿名访问的聊天接口。
 *
 * 设计要点:
 * - 类级 @Public():所有路由都绕过 JwtAuthGuard(只走 RedisRateLimitGuard 限流)。
 * - 业务路由无 /admin 前缀,主会话把 /api/v1 + /chat/* 拼成 /api/v1/chat/* 暴露给前端。
 * - visitorId 永远从装饰器读(由 VisitorIdMiddleware + RequestContextMiddleware 兜底),
 *   客户端无法伪造。
 * - SSE 路径:用 @Sse() 返回 Observable<MessageEvent>;@Sse 装饰器会自动设置
 *   text/event-stream Content-Type,且 ResponseInterceptor 已经识别 res.locals.sse 跳过包装
 *   (该模块不需要手动设置,@Sse 装饰器内部已处理)。
 */
@Public()
@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // ========================= 同步问答 =========================

  @Post("send")
  @HttpCode(HttpStatus.OK)
  async send(@VisitorId() visitorId: string, @Body() dto: SendMessageDto) {
    const vid = this.requireVisitor(visitorId);
    const session = await this.chat.getOrCreateSession(vid, dto.sessionId);
    return this.chat.send(vid, session.id, dto.question);
  }

  // ========================= 流式问答 =========================

  /**
   * SSE 端点。事件协议:
   *   - token   : text token 增量(可多次)
   *   - sources : 最终来源列表(在 done 之前推一次,JSON 字符串)
   *   - done    : 终止事件,data 为最终摘要(messageId / isAnswered / confidence / faqHit)
   *   - error   : 异常事件,data 为 message
   *
   * 客户端断开:SSE 写到一半客户端 abort 不会影响 ASSISTANT 消息入库(异步生成器在
   * 订阅 cancel 时自然停止,service 内部继续走完收尾);@Sse 装饰器内部会 res.end()。
   */
  @Post("stream")
  @Sse()
  stream(
    @VisitorId() visitorId: string,
    @Body() dto: SendMessageDto,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    res.locals.sse = true;
    const vid = this.requireVisitor(visitorId);
    return defer(async () => {
      const session = await this.chat.getOrCreateSession(vid, dto.sessionId);
      return from(this.chat.stream(vid, session.id, dto.question));
    }).pipe(
      mergeMap((iter) => from(iter)),
      // 把每个 RagChunk 翻译成 SSE MessageEvent;同一 chunk 内部可能多事件(token + sources + done)
      mergeMap((chunk): Observable<MessageEvent> => {
        const events: MessageEvent[] = [];
        if (chunk.meta) {
          events.push({ type: "meta", data: JSON.stringify(chunk.meta) });
        }
        if (chunk.content) {
          events.push({ type: "token", data: JSON.stringify({ delta: chunk.content }) });
        }
        if (chunk.sources && chunk.sources.length) {
          events.push({
            type: "sources",
            data: JSON.stringify({ items: chunk.sources }),
          });
        }
        if (
          typeof chunk.isAnswered === "boolean" ||
          typeof chunk.confidence === "number" ||
          typeof chunk.faqHit === "boolean" ||
          chunk.rejectReason
        ) {
          events.push({
            type: "done",
            data: JSON.stringify({
              isAnswered: chunk.isAnswered ?? false,
              confidence: chunk.confidence ?? null,
              faqHit: chunk.faqHit ?? false,
              rejectReason: chunk.rejectReason ?? null,
              ragLogId: chunk.ragLogId ?? null,
            }),
          });
        }
        return events.length ? from(events) : of();
      }),
      finalize(() => {
        // 无 explicit 清理:RagService 当前不支持 AbortSignal(见 chat.service 注释),
        // 若后续 LlmService.chatStream 加 signal,可在此传入。当前仅打 warn 占位。
      }),
    );
  }

  // ========================= 会话管理 =========================

  @Post("sessions")
  @HttpCode(HttpStatus.OK)
  async createSession(
    @VisitorId() visitorId: string,
    @Body() dto: CreateSessionDto,
  ) {
    const vid = this.requireVisitor(visitorId);
    const session = await this.chat.createSession(vid, dto);
    return { sessionId: session.id };
  }

  @Get("sessions")
  listSessions(
    @VisitorId() visitorId: string,
    @Query() query: ListSessionsQueryDto,
  ) {
    const vid = this.requireVisitor(visitorId);
    return this.chat.listSessions(vid, query.page, query.pageSize);
  }

  @Get("sessions/:id/messages")
  listMessages(
    @VisitorId() visitorId: string,
    @Param("id") id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    const vid = this.requireVisitor(visitorId);
    return this.chat.listMessages(vid, id, query.page, query.pageSize);
  }

  // ========================= 反馈 =========================

  @Post("messages/:id/feedback")
  @HttpCode(HttpStatus.OK)
  feedback(
    @VisitorId() visitorId: string,
    @Param("id") id: string,
    @Body() dto: FeedbackDto,
    // 显式拿 @Res 是为了后续 SSE keep-alive / 错误响应处理保留扩展点(当前未使用)
    @Res({ passthrough: true }) _res: Response,
  ) {
    const vid = this.requireVisitor(visitorId);
    return this.chat.feedback(vid, id, dto.rating, dto.comment);
  }

  // ========================= 私有工具 =========================

  private requireVisitor(visitorId: string | undefined): string {
    if (!visitorId) {
      // 兜底理论上不该触发:VisitorIdMiddleware 应当已种好 visitorId
      throw new Error(
        "visitorId is missing — check VisitorIdMiddleware registration",
      );
    }
    return visitorId;
  }
}
