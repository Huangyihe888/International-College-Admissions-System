import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { VisitorIdMiddleware } from "./visitor-id.middleware";
import { RagModule } from "../rag/rag.module";

/**
 * ChatModule — 家长/访客匿名访问。
 *
 * 关键点:
 * - 不 import AuthModule(避免循环);controller 类级 @Public() 短路 JwtAuthGuard。
 * - 通过 implements NestModule 把 VisitorIdMiddleware 绑定到 chat/* 路由(全路径)。
 *   NestJS 中间件执行顺序:全局中间件先于模块中间件;RequestContextMiddleware
 *   (全局,CommonModule 配) 先跑,会先把 cookie/header 里的 visitorId 写进 als;
 *   然后本模块的 VisitorIdMiddleware 再做"生成 + 下发 Set-Cookie"动作。
 * - import RagModule:让 ChatService 能 inject RagService。
 *   RagService 在 recall 空时也会走 LLM 兜底,所以即使 KB 暂无资料也能直答。
 */
@Module({
  imports: [RagModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(VisitorIdMiddleware).forRoutes(ChatController);
  }
}
