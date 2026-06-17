import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Permissions, Roles } from "../../common/decorators/auth.decorators";
import {
  CurrentUser,
  JwtUser,
} from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { DocumentService } from "./document.service";
import { DocumentListQueryDto } from "./dto/query-document.dto";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { ReindexResponse } from "./dto/reindex-response.dto";

/**
 * 文档管理 — 后台上传 / 列表 / 详情 / 归档 / 重索引 / 任务进度。
 * - 列表 / 详情 / 任务进度:`document:read`
 * - 上传 / 归档 / 重索引:`document:write`,仅 admin / operator(viewer 排除)
 */
@Controller("admin/documents")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class DocumentController {
  constructor(private readonly docs: DocumentService) {}

  @Post("upload")
  @HttpCode(201)
  @Roles("admin", "operator")
  @Permissions("document:write")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.docs.upload(file, body.kbVersionId, user);
  }

  @Get()
  @Permissions("document:read")
  list(@Query() query: DocumentListQueryDto) {
    return this.docs.list(query);
  }

  @Get(":id")
  @Permissions("document:read")
  detail(@Param("id") id: string) {
    return this.docs.getDetail(id);
  }

  @Delete(":id")
  @HttpCode(200)
  @Roles("admin", "operator")
  @Permissions("document:write")
  archive(@Param("id") id: string, @CurrentUser() user?: JwtUser) {
    return this.docs.archive(id, user);
  }

  @Post(":id/reindex")
  @HttpCode(200)
  @Roles("admin", "operator")
  @Permissions("document:write")
  async reindex(
    @Param("id") id: string,
    @CurrentUser() user?: JwtUser,
  ): Promise<ReindexResponse> {
    const { uploadJobId } = await this.docs.reindex(id, user);
    return { uploadJobId, status: "PENDING" };
  }

  @Get(":id/jobs")
  @Permissions("document:read")
  jobs(@Param("id") id: string) {
    return this.docs.getJobs(id);
  }
}
