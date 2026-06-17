import { Controller, Get, Query } from "@nestjs/common";
import { Public } from "../../common/decorators/auth.decorators";
import { PublicFaqSearchDto } from "./dto/faq-public.dto";
import { FaqService } from "./faq.service";

/**
 * 公共 FAQ 检索(家长端公开浏览入口,无需登录):
 *   GET /faqs?keyword=xxx&limit=20
 *  - @Public():绕开 JwtAuthGuard / RolesGuard / PermissionsGuard
 *  - 全局 RedisRateLimitGuard 负责限流
 *  - 数据源与后台管理是同一张 FaqItem 表,但只暴露 isActive=true 的子集
 */
@Controller("faqs")
@Public()
export class FaqPublicController {
  constructor(private readonly faqs: FaqService) {}

  @Get()
  async search(@Query() query: PublicFaqSearchDto) {
    const items = await this.faqs.publicSearch(
      query.keyword,
      query.limit ?? 20,
    );
    return { items };
  }
}
