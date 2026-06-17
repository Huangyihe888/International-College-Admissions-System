import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Permissions, Roles } from "../../common/decorators/auth.decorators";
import {
  CurrentUser,
  JwtUser,
} from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import {
  CreateKbVersionDto,
  KbVersionListQueryDto,
} from "./dto/kb-version.dto";
import { KbVersionService } from "./kb-version.service";

/**
 * 知识库版本管理。
 * - 列表:`kb-version:read`
 * - 创建 / 激活:`kb-version:write`,仅 admin / operator
 * 激活语义:同事务内把当前所有 isActive=true 的版本置为 false,再激活目标版本(参见 service 注释)。
 */
@Controller("admin/kb-versions")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("admin", "operator")
export class KbVersionController {
  constructor(private readonly kb: KbVersionService) {}

  @Get()
  @Permissions("kb-version:read")
  list(@Query() query: KbVersionListQueryDto) {
    return this.kb.list(query);
  }

  @Post()
  @Permissions("kb-version:write")
  create(@Body() body: CreateKbVersionDto, @CurrentUser() user?: JwtUser) {
    return this.kb.create(body, user);
  }

  @Post(":id/activate")
  @HttpCode(200)
  @Permissions("kb-version:write")
  activate(@Param("id") id: string, @CurrentUser() user?: JwtUser) {
    return this.kb.activate(id, user);
  }
}
