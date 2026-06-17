import {
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { Readable } from "stream";
import { Permissions } from "../../common/decorators/auth.decorators";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { AnalyticsService } from "./analytics.service";
import {
  AnalyticsQueryDto,
  TopQuestionsQueryDto,
} from "./dto/analytics-query.dto";
import { RangeQueryDto, TrendsQueryDto } from "./dto/overview-query.dto";

/**
 * AnalyticsModule — 后台运营分析。
 * 所有路由强制管理员鉴权:`@Permissions('analytics:read')`。
 * admin 角色通配 `*` 自动放行,operator / viewer 也可(若配置了 analytics:read)。
 *
 * 路由前缀:`/admin/analytics`(主会话配的 /api/v1 globalPrefix + URI versioning 拼成 /api/v1/admin/analytics/...)。
 */
@Controller("admin/analytics")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Permissions("analytics:read")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("logs")
  async queryLogs(@Query() filter: AnalyticsQueryDto) {
    return this.analytics.queryLogs(filter, {
      page: filter.page,
      pageSize: filter.pageSize,
    });
  }

  @Get("overview")
  async overview(@Query() query: RangeQueryDto) {
    return this.analytics.getOverview(query.range);
  }

  @Get("top-questions")
  async topQuestions(@Query() query: TopQuestionsQueryDto) {
    return this.analytics.getTopQuestions(query);
  }

  @Get("trends")
  async trends(@Query() query: TrendsQueryDto) {
    return this.analytics.getTrends(query.range, query.granularity);
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="rag-logs.csv"')
  @Header("Cache-Control", "no-store")
  async exportCsv(@Query() filter: AnalyticsQueryDto): Promise<StreamableFile> {
    const csv = await this.analytics.exportCsv(filter);
    // StreamableFile 会被 ResponseInterceptor 识别并原样返回,不会被包成 {code,message,data}
    return new StreamableFile(Readable.from([csv]), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="rag-logs.csv"',
    });
  }

  // ========================= 反馈 =========================

  @Get("feedbacks")
  async listFeedbacks(@Query() filter: AnalyticsQueryDto) {
    return this.analytics.listFeedbacks(filter, {
      page: filter.page,
      pageSize: filter.pageSize,
    });
  }

  @Get("feedbacks/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="feedbacks.csv"')
  @Header("Cache-Control", "no-store")
  async exportFeedbacksCsv(
    @Query() filter: AnalyticsQueryDto,
  ): Promise<StreamableFile> {
    const csv = await this.analytics.exportFeedbacksCsv(filter);
    return new StreamableFile(Readable.from([csv]), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="feedbacks.csv"',
    });
  }
}
