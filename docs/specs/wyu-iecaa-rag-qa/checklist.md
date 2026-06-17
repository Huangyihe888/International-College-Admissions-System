# Checklist

## 工程与基础设施
- [ ] 根目录 README 包含一键启动、目录结构、模块说明
- [ ] .env.example 列出所有 env 变量（LLM/DB/Redis/MinIO/JWT），无任何真实 Key
- [ ] docker-compose.yml 一键拉起 postgres(pgvector) / redis / minio / backend / frontend / nginx
- [ ] nginx.conf 配置 SSE 关闭缓冲、`proxy_buffering off`
- [ ] infra/scripts/init-pgvector.sql 自动启用 vector / pg_trgm 扩展
- [ ] GitHub Actions CI：lint + unit test + e2e + build image

## 后端工程（NestJS + TS）
- [ ] package.json / tsconfig / nest-cli.json / eslint / prettier 完整
- [ ] 目录结构按 spec 创建
- [ ] main.ts 注册全局 ValidationPipe / ResponseInterceptor / ExceptionFilter / 请求日志中间件
- [ ] app.module.ts 注册所有子模块

## CommonModule
- [ ] 统一响应格式 `{ code, message, data, requestId }` 由 ResponseInterceptor 包装
- [ ] 全局异常过滤器覆盖 HttpException / BusinessException / 未知错误
- [ ] requestId 通过 AsyncLocalStorage 在日志中透传
- [ ] pino logger：开发 pretty，生产 JSON，含 requestId / userId / sessionId
- [ ] Zod env 校验启动失败即 crash
- [ ] 业务异常类 BusinessException + 错误码枚举
- [ ] 通用 DTO：分页 / 响应包装 / 错误码
- [ ] Redis 令牌桶限流：可按 IP / 用户维度配置
- [ ] JwtAuthGuard / RolesGuard / @Public / @Roles / @CurrentUser 装饰器

## 数据库与 Prisma
- [ ] schema.prisma 包含 12 张表 + 索引 + 向量字段（vector(1024)）
- [ ] 初始化 migration 启用 pgvector + pg_trgm
- [ ] seed.ts 创建 admin / operator / viewer 角色 + 默认 admin 账号
- [ ] PrismaService 正确处理 onModuleInit / onModuleDestroy

## Redis & MinIO
- [ ] RedisService 封装 ioredis，常用 key 前缀常量
- [ ] StorageService 封装 MinIO putObject / getSignedUrl / remove
- [ ] BullMQ Queue：document-ingest / embedding-batch 已注册
- [ ] Bull Board（可选）可视化队列

## LLM Gateway
- [ ] LlmService 暴露 `chat / embed / rerank` 三个方法
- [ ] OpenAI-compatible Provider 同时支持 Qwen / DeepSeek / vLLM
- [ ] 流式 chat 返回 AsyncIterable<SSE chunk>
- [ ] Embedding 批处理 + 重试 + Redis 缓存
- [ ] Rerank 可插拔（BGE / Cohere / 自研）
- [ ] 失败重试 + Provider failover
- [ ] Prometheus 指标：llm_tokens_total / llm_request_duration_seconds / llm_errors_total
- [ ] **业务代码不存在直接调用 Qwen/DeepSeek 厂商 SDK 的情况**

## AuthModule
- [ ] 密码哈希使用 argon2 或 bcrypt
- [ ] 登录接口返回 access_token + refresh_token
- [ ] JwtStrategy / JwtRefreshStrategy 通过 Passport 实现
- [ ] @Roles Guard 严格按角色拦截
- [ ] /admin/auth/login /refresh /me 三个接口通过单元测试

## DocumentModule
- [ ] 上传接口：multipart → MinIO → Document(PENDING) → BullMQ
- [ ] 文档解析：PDF (pdf-parse) / Word (mammoth) / HTML (cheerio) / Markdown (unified)
- [ ] 文本切分：Recursive + Sliding Window，保留 metadata
- [ ] Embedding 批处理写 pgvector
- [ ] Document 状态机正确流转并写入 errorMessage 失败信息
- [ ] 列表 / 详情 / 删除 / 重新索引接口
- [ ] UploadJob 进度查询接口

## RagModule
- [ ] Query 改写结合多轮上下文
- [ ] FAQ 优先命中（相似度阈值可配）
- [ ] 向量召回：pgvector cosine，Top-K=20
- [ ] KB 版本过滤（默认激活版本）
- [ ] Rerank 精排
- [ ] Prompt 模板：系统提示 + 引用片段 + 历史 + 问题
- [ ] 流式生成 + SSE 透传
- [ ] 拒答判断：禁答规则 / 相似度阈值 / 检索为空
- [ ] 来源必现：sources 至少 1 条，含 chunkId/documentId/title/snippet/score
- [ ] confidence 分数计算
- [ ] RagLog 落库（query / retrieved / reranked / confidence / latency / provider / tokens）
- [ ] Redis 缓存：高频问答 + Embedding 缓存

## ChatModule
- [ ] 匿名 visitorId 持久化（Cookie / LocalStorage）
- [ ] 同步 / 流式两套问答接口
- [ ] SSE 事件类型：token / sources / done / error
- [ ] 消息持久化：USER / ASSISTANT 落库
- [ ] 会话列表 / 消息历史分页接口
- [ ] 反馈接口：UP/DOWN + 文本

## AdminModule
- [ ] FAQ CRUD（含自动生成 embedding）
- [ ] 禁答规则 CRUD（KEYWORD / REGEX / CATEGORY）
- [ ] KB 版本 CRUD + 激活（仅一个 isActive=true）
- [ ] 低置信度问题管理：人工补答 → 写入 FAQ
- [ ] 用户与角色管理
- [ ] 写操作审计日志

## AnalyticsModule
- [ ] 问答日志分页 + 筛选（时间、是否命中、置信度区间）
- [ ] 概览：日活 / 问答量 / 命中率 / 好评率
- [ ] Top 热门问题（按日 / 按周）
- [ ] 命中率 & 低置信度趋势图
- [ ] CSV 导出

## HealthModule
- [ ] /health/live 探活
- [ ] /health/ready 探就绪（DB / Redis / MinIO / LLM Gateway）

## 前端
- [ ] Vite + React 19 + TS + Tailwind + shadcn/ui 脚手架
- [ ] react-query 状态管理 + zustand 局部 store
- [ ] axios 拦截器：注入 requestId、统一错误处理
- [ ] SSE 客户端封装（EventSource / fetch + ReadableStream）
- [ ] 聊天页：流式输出 / Markdown / 来源折叠 / FAQ 快捷入口
- [ ] 移动端适配（PWA）
- [ ] 管理端登录 + 受保护路由
- [ ] 管理端：知识库文档管理 / FAQ / 禁答规则 / KB 版本 / 低置信度
- [ ] 管理端：分析仪表盘（recharts / echarts）

## 可观测性
- [ ] Prometheus 指标：HTTP / RAG / LLM / Vector
- [ ] pino 请求 access log
- [ ] Grafana 仪表盘 JSON + 告警规则占位

## 测试与验收
- [ ] 单元测试覆盖：LlmService / RagService / AuthService / ForbidChecker / DocumentService
- [ ] e2e 测试：登录 → 上传文档 → 问答 → 反馈
- [ ] docs/architecture.md / api.md / deployment.md
- [ ] README 一键启动指引可被新成员 10 分钟内 follow 成功
- [ ] 仓库内无硬编码 API Key、密码、Token
