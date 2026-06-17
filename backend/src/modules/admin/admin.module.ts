import { Module } from "@nestjs/common";
import { FaqController } from "./faq.controller";
import { FaqPublicController } from "./faq-public.controller";
import { FaqService } from "./faq.service";
import { ForbiddenRuleController } from "./forbidden-rule.controller";
import { ForbiddenRuleService } from "./forbidden-rule.service";
import { KbVersionController } from "./kb-version.controller";
import { KbVersionService } from "./kb-version.service";
import { LowConfidenceController } from "./low-confidence.controller";
import { LowConfidenceService } from "./low-confidence.service";
import { UserAdminController } from "./user-admin.controller";
import { UserAdminService } from "./user-admin.service";
import { AdminService } from "./admin.service";

/**
 * AdminModule — 后台管理员写操作模块,仅 admin / operator 可访问(viewer 在类级 @Roles 排除)。
 *
 * 设计要点:
 * - 鉴权三件套:JwtAuthGuard(注:依赖 JwtStrategy,主会话需在全局或 AuthModule 中注册 PassportModule / JwtStrategy)
 *   + RolesGuard(粗粒度角色)+ PermissionsGuard(细粒度权限,支持 `*` 与 `scope:*` 通配)
 * - 不 import AuthModule,避免循环依赖;密码 hash 走本地 argon2,后续如需集中可在 UserService 里复用。
 * - 审计日志:AdminService.recordAction 提供统一写入 AuditLog 入口,所有子 service 在写操作后调用。
 * - FaqPublicController 是 @Public() 的公共检索入口,和家长端 FAQ 浏览共用 FaqService。
 * - EmbeddingService 由全局 LlmModule 提供(@Global()),这里直接注入,不用 import LlmModule。
 * - AppModule 注册留待主会话统一加(本任务不在 app.module.ts 改)。
 */
@Module({
  controllers: [
    FaqController,
    FaqPublicController,
    ForbiddenRuleController,
    KbVersionController,
    LowConfidenceController,
    UserAdminController,
  ],
  providers: [
    AdminService,
    FaqService,
    ForbiddenRuleService,
    KbVersionService,
    LowConfidenceService,
    UserAdminService,
  ],
  exports: [AdminService],
})
export class AdminModule {}
