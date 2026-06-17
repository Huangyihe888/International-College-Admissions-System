import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  CreateForbiddenRuleDto,
  ForbiddenRuleListQueryDto,
  UpdateForbiddenRuleDto,
} from "./dto/forbidden-rule.dto";
import { ForbiddenRuleService } from "./forbidden-rule.service";

/**
 * 禁答规则 CRUD — KEYWORD / REGEX / CATEGORY 三类规则统一管理。
 * - 列表:`forbidden-rule:read`
 * - 写操作:`forbidden-rule:write`(operator 持有 `forbidden-rule:*`)
 */
@Controller("admin/forbidden-rules")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("admin", "operator")
export class ForbiddenRuleController {
  constructor(private readonly rules: ForbiddenRuleService) {}

  @Get()
  @Permissions("forbidden-rule:read")
  list(@Query() query: ForbiddenRuleListQueryDto) {
    return this.rules.list(query);
  }

  @Get(":id")
  @Permissions("forbidden-rule:read")
  findOne(@Param("id") id: string) {
    return this.rules.findById(id);
  }

  @Post()
  @Permissions("forbidden-rule:write")
  create(@Body() body: CreateForbiddenRuleDto, @CurrentUser() user?: JwtUser) {
    return this.rules.create(body, user);
  }

  @Patch(":id")
  @Permissions("forbidden-rule:write")
  update(
    @Param("id") id: string,
    @Body() body: UpdateForbiddenRuleDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.rules.update(id, body, user);
  }

  @Delete(":id")
  @Permissions("forbidden-rule:write")
  remove(@Param("id") id: string, @CurrentUser() user?: JwtUser) {
    return this.rules.remove(id, user);
  }
}
