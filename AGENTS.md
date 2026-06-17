# AGENTS.md — 五邑大学国际教育学院 2026 招生 RAG 问答系统

> 项目级 AI 协作上下文。每次开会话 Codex 自动加载此文件。从 Trae spec-driven 工作流迁移而来(2026-06-01)。

---

## 1. 项目一句话

NestJS + React 19 + pgvector + 自研轻量 RAG Pipeline 的生产级招生智能问答系统,通过 LLM Gateway 统一接入 Qwen/DeepSeek/vLLM。

---

## 2. 规格与任务追踪 (单一信源)

| 文件 | 用途 |
| --- | --- |
| `docs/specs/wyu-iecaa-rag-qa/spec.md` | **完整需求规格** — 模块职责、Prisma schema、API 设计、ADDED Requirements 与 Scenario |
| `docs/specs/wyu-iecaa-rag-qa/tasks.md` | **任务清单** — Task 0~15 拆解。完成一个 SubTask 就把 `[ ]` 改为 `[x]`,这是跨会话主线进度 |
| `docs/specs/wyu-iecaa-rag-qa/checklist.md` | **验收清单** — 模块交付前对照 |
| `docs/architecture.md` / `docs/api.md` / `docs/deployment.md` | 整体架构、API、部署文档 |

**工作流约定**:开始任何编码任务前先看 `tasks.md` 找到当前位置,完成后立即勾选;有需求变更先改 `spec.md`。

---

## 3. 技术栈与版本约束

- Node.js ≥ 20,pnpm ≥ 9,Docker ≥ 24
- **后端**:NestJS 10 / Prisma 5 / PostgreSQL 16 + pgvector / Redis 7 + BullMQ / MinIO / Zod / pino / argon2 / class-validator
- **前端**:React 19 + Vite 5 + TypeScript 5 + Tailwind 3 + shadcn/ui + TanStack Query + Zustand
- **包管理**:pnpm workspaces,根目录 `pnpm-workspace.yaml`,后端在 `backend/`,前端在 `frontend/`

---

## 4. 关键工程约定 (非协商)

### 4.1 统一响应格式
所有 HTTP 接口走 `ResponseInterceptor`,响应体固定:
```ts
{ code: number, message: string, data: T | null, requestId: string, timestamp: number }
```
- `code` 取自 `backend/src/common/errors/error-code.ts` 中的 `ErrorCode` 枚举(SUCCESS=0)
- 成功用 `ok(data, requestId)`,失败由 `AllExceptionsFilter` 包装

### 4.2 业务错误抛 `BusinessException`
位置:`backend/src/common/errors/business.exception.ts`。新增错误码先加到 `ErrorCode` 枚举,按业务域分段(2xxx auth / 3xxx doc&kb / 4xxx rag / 5xxx 外部依赖)。

### 4.3 LLM 调用必须经 LLM Gateway
- **业务代码不得直接 import qwen/deepseek/openai SDK**
- 统一调用 `LlmService.chat() / embed() / rerank()`
- Provider 切换走 `LLM_PROVIDER` env,代码零改动
- 这是 spec 的硬性 Requirement,review 会卡

### 4.4 配置走 Zod
所有 env 在 `backend/src/config/env.schema.ts` 校验,启动失败直接 crash。新增配置先加 schema。

### 4.5 requestId 链路追踪
`RequestContextMiddleware` + `AsyncLocalStorage` 透传 requestId 到 pino 日志、响应体、LLM 调用埋点。不要在业务代码里手动传 requestId。

### 4.6 限流
`RedisRateLimitGuard` 已注册为全局 Guard,默认 60 req/min/IP。需要不同档位用 `@RateLimit()` 装饰器(待实现时建)。

### 4.7 不堆抽象、不写多余注释
- 代码风格遵循 NestJS 官方约定 + Prettier
- 注释只在"为什么"非显而易见时写;名字能表达的不写

---

## 5. 常用命令

```bash
# 根目录(pnpm workspaces 统一调度)
pnpm dev              # 前后端并行 dev 模式
pnpm build            # 全量构建
pnpm test             # 全量测试
pnpm lint             # 全量 ESLint
pnpm typecheck        # 全量 tsc --noEmit

# 单独子项目
pnpm --filter backend dev
pnpm --filter frontend build

# 后端 Prisma
pnpm --filter backend prisma:generate    # 生成 client
pnpm --filter backend prisma:migrate     # 开发态 migrate
pnpm --filter backend prisma:deploy      # 生产 migrate
pnpm --filter backend prisma:seed        # 种子数据
pnpm --filter backend prisma:studio      # 可视化

# Docker 一键启动 (postgres+pgvector / redis / minio / backend / frontend / nginx)
docker compose up -d
docker compose logs -f backend
docker compose exec backend pnpm prisma migrate deploy
docker compose exec backend pnpm prisma db seed
```

---

## 6. 服务端口

| 服务 | 端口 | 备注 |
| --- | --- | --- |
| Nginx (前端入口) | 8080 | http://localhost:8080 |
| 后端 API | 3000 | 全局前缀 `/api/v1` |
| PostgreSQL | 5432 | user/db: `wyu / wyu_rag` |
| Redis | 6379 | key 前缀 `wyu:` |
| MinIO API | 9000 | bucket: `wyu-rag` |
| MinIO 控制台 | 9001 | minioadmin / changeme |

---

## 7. 当前进度快照 (2026-06-02)

> 进度以 `docs/specs/wyu-iecaa-rag-qa/tasks.md` 的 `[x]` 为准,此处仅汇总。
> **整体 100%**(2026-06-02 收尾:auth.e2e `/me` 路由去 @Public(),4 个 it.todo 全部解锁为实跑断言,tasks.md 全勾)。
> 仍待真实环境(`docker compose up` + `prisma migrate deploy`)一键跑通。

- **后端** (100%,`pnpm exec tsc --noEmit` 0 errors,`pnpm build` 通过)
  - ✅ Task 0 基础设施 + Task 1 脚手架(15 模块 app.module.ts)
  - ✅ Task 2 CommonModule + 3 Guard 全局注册
  - ✅ Task 3 Prisma 全链路(schema 13 表 + migration + seed + PrismaService)
  - ✅ Task 4 Redis & MinIO + BullMQ 自研适配层
  - ✅ Task 5 LLM Gateway(chat/embed/rerank + 流式 + failover + 1027 行)
  - ✅ Task 6 AuthModule(JWT 双 Token + 3 Guard)
  - ✅ Task 7 DocumentModule(上传 + 5 格式解析 + Recursive splitter + pgvector)
  - ✅ Task 8 RagModule(完整 RAG pipeline + 拒答 + 缓存)
  - ✅ Task 9 ChatModule(SSE 流式 + visitorId cookie)
  - ✅ Task 10/11/12 Admin + Analytics + Health

- **前端** (100%,`pnpm exec tsc --noEmit` 0 errors,Vite 5 + React 19 + Tailwind 3 + shadcn/ui)
  - ✅ Task 13.1-13.9 全部(脚手架 + 公共组件 + API 客户端 + Chat + 登录 + Admin CRUD + Analytics + PWA + 移动端)

- **观测** (100%)
  - ✅ Task 14 Grafana(24 panels)+ Prometheus(10 scrape)+ Alertmanager(3 路由 + 2 抑制)+ 16 告警规则

- **测试** (100%)
  - ✅ Task 15.1 单测(5 spec / 64 cases 全过)
  - ✅ Task 15.2 e2e(5 spec / 42 passed + 1 skipped + 0 failed)
  - ✅ Task 15.3 文档(architecture/api/deployment / 1523 行)
  - ✅ Task 15.4 README(212 行)

**关键产品决策(2026-06-01)**:
- **认证范围**:仅后台管理员(operator / admin / viewer)需要 JWT 登录;家长/访客访问 `/chat/*` 匿名,身份靠 `wyu_vid` cookie 标识。影响 AuthModule / ChatModule / 前端路由。
- **LLM 调用硬约束**:业务代码禁止直接 import 厂商 SDK,统一走 LLM Gateway(即便 Gateway 还没建,先建再调)。

**schema 字段与 spec 描述偏差(2026-06-02 发现)**:
- `isActive` 而非 spec 写的 `status: 'ACTIVE'`(KbVersion / ForbiddenRule)
- `DocumentChunk.chunkIndex` 而非 spec 写的 `index`(`DocumentChunk` 而非 `Chunk`)
- `FaqItem` 无 `kbVersionId`(FAQ 全局共享)
- `RagLog` 有 `sessionId` 无 `visitorId`(visitorId 仅参与 answer 缓存 key)
- 各 subagent 都已自适应,**主会话未更新 spec.md**,后续迭代时把 spec 同步过来

**下一步**(真实环境验证):
```bash
# 1. 启动依赖
docker compose up -d postgres redis minio
# 2. 应用迁移(注意 ARCHIVED 枚举需手动跑,见迁移文件注释)
cd backend && pnpm exec prisma migrate deploy
# 3. Seed 默认 admin
pnpm exec prisma db seed   # admin / admin123
# 4. 启动后端 + 前端
cd .. && pnpm dev
# 5. 验证
curl http://localhost:3000/api/v1/health/ready
open http://localhost:5173/chat
```

**收尾**:
- ✅ 后端 `backend/.eslintrc.cjs` 已建(Prettier + TS 推荐规则),全量 `0 errors / 67 warnings`(37 no-explicit-any + 30 no-unused-vars,均为低优先级)
- ✅ 前端 `frontend/eslint.config.js` 已修(typescript-eslint v8 flat config 写法),`0 errors / 0 warnings`
- 修任何新发现的 lint warning

---

## 8. 协作约定(给 Codex 自己看)

1. **每次干活先读 `docs/specs/wyu-iecaa-rag-qa/tasks.md`**,确认当前 Task / SubTask 编号,完成后立即勾选。
2. **不偏离 spec**。如需偏离,先改 `spec.md` 的 ADDED/MODIFIED Requirements,再写代码。
3. **沿用已有约定**:不要重复造响应包装 / 错误码 / 日志格式;新错误码加到 `ErrorCode` 枚举对应区段。
4. **不要直接调 LLM 厂商 SDK**,统一走 LLM Gateway(即便它还没建好,也先建 Gateway 再用)。
5. **变更先小步、可运行**。Prisma 改 schema 后必须能 migrate 通过;后端改完跑 `pnpm --filter backend typecheck`。
6. **不写多余的 README / 总结文档**。docs/ 下已有 architecture/api/deployment,继续完善它们而非另起炉灶。
