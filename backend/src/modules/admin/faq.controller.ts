import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { Readable } from "stream";
import {
  CurrentUser,
  JwtUser,
} from "../../common/decorators/current-user.decorator";
import { Permissions, Roles } from "../../common/decorators/auth.decorators";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CreateFaqDto, FaqListQueryDto, UpdateFaqDto } from "./dto/faq.dto";
import { FaqService } from "./faq.service";

/**
 * FAQ CRUD — AdminModule 子路由之一。
 * 路由前缀:`/admin/faqs`,在主会话中由 globalPrefix + URI versioning 拼成 `/api/v1/admin/faqs/...`。
 * - 列表:`@Permissions('faq:read')`;operator 持有 `faq:*` 通配,viewer 持有 `faq:read`
 * - 写操作:继承类级 `@Roles('admin', 'operator')`,viewer 被排除
 */
@Controller("admin/faqs")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("admin", "operator")
export class FaqController {
  constructor(private readonly faqs: FaqService) {}

  @Get()
  @Permissions("faq:read")
  list(@Query() query: FaqListQueryDto) {
    return this.faqs.list(query);
  }

  @Get("export.csv")
  @Permissions("faq:read")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="faqs.csv"')
  @Header("Cache-Control", "no-store")
  async exportCsv(@Query() query: FaqListQueryDto): Promise<StreamableFile> {
    const csv = await this.faqs.exportCsv(query);
    return new StreamableFile(Readable.from([csv]), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="faqs.csv"',
    });
  }

  @Get(":id")
  @Permissions("faq:read")
  findOne(@Param("id") id: string) {
    return this.faqs.findById(id);
  }

  @Post()
  @Permissions("faq:write")
  create(@Body() body: CreateFaqDto, @CurrentUser() user?: JwtUser) {
    return this.faqs.create(body, user);
  }

  @Patch(":id")
  @Permissions("faq:write")
  update(
    @Param("id") id: string,
    @Body() body: UpdateFaqDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.faqs.update(id, body, user);
  }

  @Delete(":id")
  @Permissions("faq:write")
  remove(@Param("id") id: string, @CurrentUser() user?: JwtUser) {
    return this.faqs.remove(id, user);
  }
}
