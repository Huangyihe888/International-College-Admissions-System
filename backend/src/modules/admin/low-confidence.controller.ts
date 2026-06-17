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
  AnswerLowConfidenceDto,
  LowConfidenceListQueryDto,
} from "./dto/low-confidence.dto";
import { LowConfidenceService } from "./low-confidence.service";

/**
 * 低置信度问题管理。
 * - 列表:`low-confidence:read`,查询 RagLog.confidence < 0.5 且 isAnswered=false
 * - 人工补答:把 RagLog.query 作为新 FaqItem.question,入参 answer 作为 FaqItem.answer
 */
@Controller("admin/low-confidence")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("admin", "operator")
export class LowConfidenceController {
  constructor(private readonly lc: LowConfidenceService) {}

  @Get()
  @Permissions("low-confidence:read")
  list(@Query() query: LowConfidenceListQueryDto) {
    return this.lc.list(query);
  }

  @Post(":id/answer")
  @HttpCode(200)
  @Permissions("low-confidence:write")
  answer(
    @Param("id") id: string,
    @Body() body: AnswerLowConfidenceDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.lc.answer(id, body, user);
  }
}
