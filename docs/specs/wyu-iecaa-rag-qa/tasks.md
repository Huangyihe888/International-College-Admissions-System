# Tasks

> **进度快照**:本文件是跨会话主线进度,完成一项就立即 `[ ]` → `[x]`。
> 上次更新:2026-06-02(全部 16 个 Task 全勾,**整体 100%**)
> **产品决策**:仅管理员需要账号密码,家长/访客匿名访问(影响 Task 6/9/13)

- [x] Task 0: 工程初始化与基础设施
  - [x] SubTask 0.1: 创建项目根目录、.gitignore、.editorconfig、README.md
  - [x] SubTask 0.2: docker-compose.yml（postgres+pgvector / redis / minio / backend / frontend / nginx）
  - [x] SubTask 0.3: 根级 .env.example（含 LLM/Gateway/DB/Redis/MinIO/JWT 配置）
  - [x] SubTask 0.4: nginx.conf 反向代理 + SSE 长连接配置
  - [x] SubTask 0.5: infra/scripts/init-pgvector.sql 启用扩展
  - [x] SubTask 0.6: GitHub Actions CI（lint + test + build image）

- [x] Task 1: 后端工程脚手架（NestJS + TS）
  - [x] SubTask 1.1: package.json、tsconfig、nest-cli.json、eslint/prettier
  - [x] SubTask 1.2: 目录结构（common / config / database / redis / storage / llm / modules / jobs）
  - [x] SubTask 1.3: main.ts（ValidationPipe / CORS / Helmet / nestjs-pino / 启动 Banner / 优雅关闭）
    - 产出:`backend/src/main.ts` 55 行,集成 banner 输出
  - [x] SubTask 1.4: app.module.ts 注册 ConfigModule(全局) + AppConfigModule + CommonModule + PrismaModule + RedisModule + StorageModule
    - 产出:`backend/src/app.module.ts` 50 行

- [x] Task 2: CommonModule（统一基础设施）
  - [x] SubTask 2.1: 统一响应格式 ResponseInterceptor `{ code, message, data, requestId }`
  - [x] SubTask 2.2: 全局异常过滤器（HttpException / 业务异常 / 未知异常）
  - [x] SubTask 2.3: requestId 拦截器 + AsyncLocalStorage 透传
  - [x] SubTask 2.4: pino logger 模块（开发 pretty / 生产 JSON）
  - [x] SubTask 2.5: Zod env 校验 + ConfigModule
  - [x] SubTask 2.6: 业务异常类（BusinessException + 错误码枚举）
  - [x] SubTask 2.7: 通用 DTO（分页 / 响应包装 / 错误码）
  - [x] SubTask 2.8: Redis 令牌桶限流 Guard / Decorator
  - [x] SubTask 2.9: JwtAuthGuard / RolesGuard / PermissionsGuard(`@Public()` 短路,已注册为全局 APP_GUARD)
    - 产出:`backend/src/modules/auth/guards/` 三个 Guard + `@Public()` / `@Roles()` / `@Permissions()` 装饰器,全局 `APP_GUARD` 顺序:Auth → Roles → Permissions

- [x] Task 3: 数据库与 Prisma
  - [x] SubTask 3.1: prisma/schema.prisma（13 张表 + 索引 + 向量字段）
  - [x] SubTask 3.2: 初始化 migration:pgvector 扩展 + pg_trgm
  - [x] SubTask 3.3: prisma/seed.ts:默认 admin/operator/viewer 角色 + 默认管理员账号
  - [x] SubTask 3.4: PrismaService（NestJS 生命周期管理连接）

- [x] Task 4: Redis & MinIO
  - [x] SubTask 4.1: RedisService（ioredis 单例 + 常用 key 前缀）
  - [x] SubTask 4.2: StorageService（MinIO SDK:putObject / getSignedUrl / remove）
  - [x] SubTask 4.3: BullMQ Queue 注册:document-ingest / embedding-batch（自定义 `@Processor` 装饰器 + `ProcessorRegistry` + Worker 事件驱动 metrics）
    - 产出:`backend/src/jobs/` 自研装饰器 + `ProcessorRegistry` 适配层,Worker 事件驱动 `jobs_*` Prometheus 指标

- [x] Task 5: LLM Gateway
  - [x] SubTask 5.1: LlmModule、LlmService 统一接口 `chat / embed / rerank`(@Global)
    - 产出:`backend/src/llm/llm.module.ts` 1027 行,4 provider 可切换
  - [x] SubTask 5.2: OpenAI-compatible Provider(Qwen / DeepSeek / vLLM 共用,axios + SSE)
    - 产出:`backend/src/llm/providers/openai-compatible.provider.ts` 适配 OpenAI 协议
  - [x] SubTask 5.3: 流式 chat(SSE chunks,eventsource-parser 单消费者队列)
    - 产出:`backend/src/llm/streaming/` 流式 chat + AsyncIterable
  - [x] SubTask 5.4: EmbeddingService(批处理 + 指数退避 3 次 + SHA1 Redis 缓存)
    - 产出:`backend/src/llm/embedding.service.ts` 批 32 + SHA1 缓存
  - [x] SubTask 5.5: RerankService(BGE / Cohere / `none` 降级)
    - 产出:`backend/src/llm/rerank.service.ts` 3 provider + `none` 降级
  - [x] SubTask 5.6: 失败重试 + Provider failover(4xx 不重试,5xx/429/timeout 走 fallback 链)
    - 产出:`backend/src/llm/retry.ts` 退避重试 + `fallbackChain` 配置
  - [x] SubTask 5.7: Prometheus 指标(`llmTokensTotal` / `llmRequestDuration` / `llmErrorsTotal`)
    - 产出:`backend/src/llm/llm.metrics.ts` 3 个 Counter/Histogram

- [x] Task 6: AuthModule
  - [x] SubTask 6.1: User / Role Service(Prisma 封装)
    - 产出:`backend/src/modules/auth/user.service.ts` + `role.service.ts`
  - [x] SubTask 6.2: 密码哈希 argon2id + `/admin/auth/login`
    - 产出:`argon2id` + `/admin/auth/login` 路由
  - [x] SubTask 6.3: JWT Access + Refresh 双 Token(双 secret + payload.type 防混淆)
    - 产出:`backend/src/modules/auth/auth.service.ts` 双 Token 签发
  - [x] SubTask 6.4: JwtStrategy / JwtRefreshStrategy(Refresh 三路投递:body / cookie / header)
    - 产出:`backend/src/modules/auth/{jwt,jwt-refresh}.strategy.ts`
  - [x] SubTask 6.5: RolesGuard + PermissionsGuard(`*` 与 `scope:*` 通配)
    - 产出:`backend/src/modules/auth/guards/` 通配支持
  - [x] SubTask 6.6: `/admin/auth/login` / `refresh` / `me`(全 `@Public()`,JWT 错误码细分 2001/2002/2003/2004)
    - 产出:`backend/src/modules/auth/auth.module.ts` 420 行 + auth.controller 3 端点

- [x] Task 7: DocumentModule
  - [x] SubTask 7.1: 上传接口（multipart）→ 写 MinIO → 写 Document(PENDING) → 投递 BullMQ
    - 产出:`backend/src/modules/document/document.controller.ts` multipart 上传
  - [x] SubTask 7.2: 文档解析（pdf-parse / mammoth / cheerio / unified）
    - 产出:`backend/src/modules/document/parsers/` 5 格式(pdf/docx/html/md/txt)
  - [x] SubTask 7.3: 文本切分（Recursive / Sliding Window,保留 metadata）
    - 产出:`backend/src/modules/document/chunkers/` Recursive splitter
  - [x] SubTask 7.4: Embedding 批处理 → 写 pgvector
    - 产出:`document.service.ts` LlmService.embed 批处理 + 写 `DocumentChunk` 表
  - [x] SubTask 7.5: Document 状态机:PENDING → PARSING → CHUNKING → EMBEDDING → READY/FAILED
    - 产出:`document.service.ts` 状态机 + 失败原因落 `errorMessage`
  - [x] SubTask 7.6: 列表 / 详情 / 删除 / 重新索引接口
    - 产出:`document.controller.ts` 4 端点
  - [x] SubTask 7.7: UploadJob 进度查询接口
    - 产出:`/admin/documents/upload-jobs/:id` 进度查询

- [x] Task 8: RagModule（自研 Pipeline）
  - [x] SubTask 8.1: Query 改写（结合多轮上下文）
    - 产出:`backend/src/modules/rag/rewriter/` 多轮 Query 改写
  - [x] SubTask 8.2: FAQ 优先命中（相似度阈值）
    - 产出:`backend/src/modules/rag/faq-matcher/` 相似度阈值命中
  - [x] SubTask 8.3: 向量召回（pgvector cosine,Top-K=20,KB 版本过滤）
    - 产出:`backend/src/modules/rag/recall/` pgvector cosine + KB 版本过滤
  - [x] SubTask 8.4: Rerank 精排
    - 产出:`backend/src/modules/rag/reranker/` Top-5 精排
  - [x] SubTask 8.5: Prompt 构造（系统提示 + 引用片段 + 历史 + 问题）
    - 产出:`backend/src/modules/rag/prompts/` 模板构造
  - [x] SubTask 8.6: 流式生成（SSE token 透传）
    - 产出:`rag.service.ts` LlmService.streamChat AsyncIterable 透传
  - [x] SubTask 8.7: 拒答判断（禁答规则 + 相似度阈值 + 检索为空）
    - 产出:`backend/src/modules/rag/forbidden/` 3 条件拒答
  - [x] SubTask 8.8: 来源回传 + confidence 分数
    - 产出:`rag.service.ts` sources 字段 + confidence 评分
  - [x] SubTask 8.9: RagLog 落库
    - 产出:`rag.service.ts` 异步写 `RagLog` 表
  - [x] SubTask 8.10: Redis 缓存:高频问答 + Embedding 缓存
    - 产出:`rag.service.ts` Redis 缓存高频问答 + embedding 缓存(已在 LlmService 共享)
    - 整体: `backend/src/modules/rag/rag.module.ts` 960 行

- [x] Task 9: ChatModule
  - [x] SubTask 9.1: 会话创建/恢复（visitorId 持久化）
    - 产出:`chat.service.ts` + `visitor-id.middleware.ts` 写 `wyu_vid` cookie
  - [x] SubTask 9.2: 同步问答接口 POST /chat/send
    - 产出:`chat.controller.ts` POST /chat/send 同步返回
  - [x] SubTask 9.3: 流式问答接口 POST /chat/stream（SSE）
    - 产出:`chat.controller.ts` POST /chat/stream SSE 透传
  - [x] SubTask 9.4: 消息持久化（User / Assistant）
    - 产出:`chat.service.ts` 写 `ChatMessage` 表(role=user/assistant)
  - [x] SubTask 9.5: 会话列表 / 消息历史接口
    - 产出:`chat.controller.ts` GET /chat/sessions + /chat/sessions/:id/messages
  - [x] SubTask 9.6: 反馈接口（点赞/点踩 + 文本）
    - 产出:`chat.controller.ts` POST /chat/messages/:id/feedback
    - 整体: `backend/src/modules/chat/chat.module.ts` 840 行

- [x] Task 10: AdminModule
  - [x] SubTask 10.1: FAQ CRUD(`/admin/faqs`)
    - 产出:`backend/src/modules/admin/faq.controller.ts` + `faq.service.ts`
  - [x] SubTask 10.2: 禁答规则 CRUD(`/admin/forbidden-rules`,关键词 / 正则 / 分类)
    - 产出:`backend/src/modules/admin/forbidden-rule.controller.ts` + service
  - [x] SubTask 10.3: KB 版本 CRUD + 激活(`/admin/kb-versions/:id/activate` 走事务)
    - 产出:`backend/src/modules/admin/kb-version.controller.ts` + 事务激活
  - [x] SubTask 10.4: 低置信度问题管理(`/admin/low-confidence` + 人工补答入 FAQ)
    - 产出:`backend/src/modules/admin/low-confidence.controller.ts` + service
  - [x] SubTask 10.5: 用户与角色管理(`/admin/users` + 重置密码,`@Roles('admin')` 锁)
    - 产出:`backend/src/modules/admin/user-admin.controller.ts` + service,`@Roles('admin')` 锁
  - [x] SubTask 10.6: 审计日志(`AdminService.recordAction` 统一写 AuditLog,失败降级 warn)
    - 产出:`admin.service.ts` `recordAction` 统一写 `AuditLog` 表,失败降级 warn
    - 整体: `backend/src/modules/admin/admin.module.ts` 1360 行

- [x] Task 11: AnalyticsModule
  - [x] SubTask 11.1: 问答日志查询(`/admin/analytics/logs`,`isAnswered` / `faqHit` / 起止日期 / 关键词模糊)
    - 产出:`backend/src/modules/analytics/analytics.service.ts` logs 查询
  - [x] SubTask 11.2: 概览指标(`/admin/analytics/overview`,6 项 `Promise.all` 并行聚合,`range=24h|7d|30d`)
    - 产出:`analytics.service.ts` overview 6 项 `Promise.all` 并行
  - [x] SubTask 11.3: Top 热门问题(`/admin/analytics/top-questions`,`groupBy query` 排序)
    - 产出:`analytics.service.ts` `groupBy` query 排序 Top-N
  - [x] SubTask 11.4: 命中率 & 低置信度趋势(`/admin/analytics/trends`,`$queryRaw` `date_trunc` 时序桶)
    - 产出:`analytics.service.ts` `$queryRaw` `date_trunc` 时序桶
  - [x] SubTask 11.5: CSV 导出(`/admin/analytics/export.csv`,`StreamableFile` 直通 + UTF-8 BOM)
    - 产出:`analytics.controller.ts` `StreamableFile` + UTF-8 BOM
    - 整体: `backend/src/modules/analytics/analytics.module.ts` 523 行

- [x] Task 12: HealthModule
  - [x] SubTask 12.1: `/api/v1/health/live` 存活探针(不查依赖,进程在即返回)
    - 产出:`backend/src/modules/health/health.controller.ts` `/health/live` 不查依赖
  - [x] SubTask 12.2: `/api/v1/health/ready` 就绪探针(PostgreSQL / Redis / MinIO 并行检查 + 3s 整体超时 race,失败 503 结构化返回)
    - 产出:`health.service.ts` 并行检查 + 3s 整体超时 race
    - 整体: `backend/src/modules/health/health.module.ts` 136 行

- [x] Task 13: 前端工程（React 19 + Vite + TS + Tailwind + shadcn/ui）
  - [x] SubTask 13.1: 脚手架与配置（vite / tailwind / shadcn / react-query / zustand / axios / react-router）
    - 产出:36 文件(package.json / vite.config / tsconfig / tailwind / etc)
  - [x] SubTask 13.2: 公共组件:Button / Input / Card / Dialog / Toast（shadcn/ui）
    - 产出:`frontend/src/components/ui/` Button/Input/Card/Dialog/Label/Header
  - [x] SubTask 13.3: API 客户端（带 requestId、错误统一处理、SSE 封装）
    - 产出:`frontend/src/lib/api/` Axios + 拦截器 + SSE 工具 + 完整 endpoints
  - [x] SubTask 13.4: 聊天页 Home / Chat:流式输出、Markdown 渲染、来源折叠、FAQ 快捷入口
    - 产出:`frontend/src/pages/chat.tsx` 489 行 + `markdown.tsx` 328 行 + `message-bubble.tsx` 253 行
  - [x] SubTask 13.5: 管理端登录页 + 受保护路由
    - 产出:`frontend/src/pages/admin-login.tsx` 161 行 + `useAdminAuth` hook
  - [x] SubTask 13.6: 管理端:知识库文档管理（上传 / 列表 / 重新索引）
    - 产出:`frontend/src/pages/admin/documents.tsx` 718 行
  - [x] SubTask 13.7: 管理端:FAQ / 禁答规则 / KB 版本 / 低置信度问题
    - 产出:`frontend/src/pages/admin/` Faq 379 / Forbidden 512 / KbVersion 351 / LowConf 361 / Users 603
  - [x] SubTask 13.8: 管理端:分析仪表盘（图表 + 列表）
    - 产出:`frontend/src/pages/admin/analytics.tsx` 393 行,纯 CSS Top10 柱状 + TrendChart SVG
  - [x] SubTask 13.9: PWA / 移动端适配
    - 产出:`frontend/public/manifest.json` + `sw.js` + SVG icon + 移动端断点

- [x] Task 14: 可观测性
  - [x] SubTask 14.1: Prometheus 指标（HTTP / RAG / LLM / Vector）
    - 产出:`backend/src/common/metrics/prom.service.ts` HTTP / RAG / LLM / Vector 指标
  - [x] SubTask 14.2: pino 请求日志中间件（access log）
    - 产出:`backend/src/common/logger/logger.module.ts` pino access log 中间件
  - [x] SubTask 14.3: Grafana 仪表盘 JSON（占位）+ 告警规则
    - 产出:`infra/observability/` Grafana 仪表盘 JSON(872 行 / 24 panels)+ Prometheus 10 scrape + Alertmanager 4 receivers + 16 告警规则(5 文件 / 1610 行)

- [x] Task 15: 测试与文档
  - [x] SubTask 15.1: 单元测试:LlmService、RagService、AuthService、ForbidChecker
    - 产出:5 spec / 1451 行 / 64 cases 全过
  - [x] SubTask 15.2: e2e 测试:登录 → 上传文档 → 问答 → 反馈
    - 产出:5 spec + setup + helpers + README / 1199 行 / **42 passed + 1 skipped + 0 failed**(`auth.e2e-spec.ts` /me 路由去 @Public 后 4 个 it.todo 全部解锁为实跑断言)
  - [x] SubTask 15.3: docs/architecture.md / api.md / deployment.md
    - 产出:architecture 419 / api 595 / deployment 509 行
  - [x] SubTask 15.4: README 一键启动指引
    - 产出:README 212 行

# Task Dependencies
- Task 2 依赖 Task 1(脚手架) ✅
- Task 3、4、5 依赖 Task 2 ✅
- Task 6 依赖 Task 3、2 ✅
- Task 7 依赖 Task 3、4、5 ✅
- Task 8 依赖 Task 5、3 ✅
- Task 9 依赖 Task 8、3 ✅
- Task 10 依赖 Task 3、2 ✅
- Task 11 依赖 Task 3、9、8 ✅
- Task 12 依赖 Task 3、4、5 ✅
- Task 13 依赖 Task 9、6、10、11 ✅
- Task 14 依赖 Task 8、9 ✅
- Task 15 依赖 Task 6、7、8、9 ✅
