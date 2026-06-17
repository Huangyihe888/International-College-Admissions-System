# 五邑大学国际教育学院 2026 招生 RAG 问答系统 Spec（生产级）

## Why
五邑大学国际教育学院在 2026 年招生季面临考生与家长集中咨询（专业、费用、申请流程、奖学金、住宿、语言要求等），传统人工客服难以承受高并发且答复标准不一。本系统基于自研轻量 RAG Pipeline + LLM Gateway 构建一个**生产级、可落地**的智能问答平台，要求稳定、可观测、易扩展、可安全运营。

## What Changes
- 新增 NestJS 后端工程，含 8 个业务模块：Auth / Chat / Rag / Document / Admin / Analytics / Health / Common
- 新增 React 19 + Vite + Tailwind + shadcn/ui 前端工程（用户端聊天 + 管理后台）
- 新增 PostgreSQL + pgvector + Prisma 持久化与向量存储
- 新增 Redis（缓存 + BullMQ 异步任务队列）
- 新增 MinIO（PDF/Word 等文件对象存储）
- 新增 LLM Gateway（统一封装 Qwen / DeepSeek API，后期切换 vLLM OpenAI-compatible）
- 新增自研轻量 RAG Pipeline：Query 改写 → 向量召回 → Rerank → Prompt 构造 → LLM 生成 → 引用来源回传
- 新增 Docker Compose 一键启动：PostgreSQL / Redis / MinIO / Backend / Frontend / Nginx
- 新增可观测性：pino 结构化日志 + Prometheus 指标 + 统一 requestId
- 新增安全与限流：JWT 鉴权、RBAC、敏感词、招生政策类拒答规则、IP/用户维度令牌桶

## Impact
- Affected specs: 招生咨询业务、知识库管理、对话系统、运营分析、可观测性
- Affected code: 全新项目，目录结构见下

---

## 项目目录结构

```
wyu-iecaa-rag-qa/
├── README.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── nginx/
│   └── nginx.conf
├── docs/
│   ├── architecture.md
│   ├── api.md
│   └── deployment.md
├── backend/                              # NestJS + TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── common/                       # CommonModule
│   │   │   ├── filters/                  # 全局异常过滤器
│   │   │   ├── interceptors/             # 统一响应、requestId、日志
│   │   │   ├── guards/                   # JWT / Role Guard
│   │   │   ├── decorators/               # @Roles @CurrentUser @Public
│   │   │   ├── pipes/                    # Zod / class-validator
│   │   │   ├── dto/
│   │   │   ├── logger/                   # pino 配置
│   │   │   ├── rate-limit/               # 基于 Redis 令牌桶
│   │   │   ├── errors/                   # 业务异常定义
│   │   │   └── response/                 # 统一响应格式
│   │   ├── config/                       # env 校验（Zod）
│   │   ├── database/                     # PrismaService
│   │   ├── redis/                        # RedisService
│   │   ├── storage/                      # MinIO StorageService
│   │   ├── llm/                          # LLM Gateway（核心）
│   │   │   ├── llm.module.ts
│   │   │   ├── llm.service.ts
│   │   │   ├── providers/
│   │   │   │   ├── openai-compatible.provider.ts
│   │   │   │   ├── qwen.provider.ts
│   │   │   │   ├── deepseek.provider.ts
│   │   │   │   └── vllm.provider.ts      # 后期切换
│   │   │   ├── embedding/
│   │   │   │   └── embedding.service.ts  # 统一 Embedding 入口
│   │   │   ├── rerank/
│   │   │   │   └── rerank.service.ts
│   │   │   └── types.ts
│   │   ├── modules/
│   │   │   ├── auth/                     # AuthModule
│   │   │   ├── chat/                     # ChatModule
│   │   │   ├── rag/                      # RagModule
│   │   │   ├── document/                 # DocumentModule
│   │   │   ├── admin/                    # AdminModule
│   │   │   ├── analytics/                # AnalyticsModule
│   │   │   └── health/                   # HealthModule
│   │   └── jobs/                         # BullMQ 消费者
│   │       ├── document-ingest.processor.ts
│   │       └── embedding-batch.processor.ts
│   └── test/
│       ├── unit/
│       └── e2e/
├── frontend/                             # React 19 + Vite + TS
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── .env.example
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── router.tsx
│       ├── api/                          # axios + react-query
│       ├── components/
│       │   ├── ui/                       # shadcn/ui
│       │   ├── chat/                     # 聊天组件
│       │   └── admin/                    # 后台组件
│       ├── pages/
│       │   ├── Home.tsx
│       │   ├── Chat.tsx
│       │   └── admin/
│       ├── hooks/
│       ├── stores/                       # zustand
│       ├── lib/
│       └── styles/
├── infra/
│   ├── docker/
│   │   ├── backend.Dockerfile
│   │   ├── frontend.Dockerfile
│   │   └── nginx.Dockerfile
│   └── scripts/
│       └── init-pgvector.sql
└── .github/
    └── workflows/
        └── ci.yml
```

---

## 模块职责

| 模块 | 主要职责 |
|---|---|
| **CommonModule** | 全局异常过滤器、统一响应格式、requestId 拦截器、pino 日志、Zod/class-validator 校验、Redis 令牌桶限流、JWT/Role Guard、通用 DTO |
| **AuthModule** | 管理员登录（账号密码）、JWT 签发/校验、Refresh Token、RBAC（admin / operator / viewer） |
| **ChatModule** | 用户端问答接口（`POST /chat/stream` SSE 流式、`POST /chat/sync` 同步）、会话创建/恢复、消息持久化、反馈（点赞/点踩） |
| **RagModule** | 自研 Pipeline：Query 改写 → FAQ 优先命中 → 向量召回（pgvector）→ Rerank → Prompt 构造 → LLM 生成 → 来源回传 → confidence 计算 → 拒答判断；统一走 LLM Gateway；RAG 日志落库 |
| **DocumentModule** | 文件上传到 MinIO、解析（PDF/Word/Markdown/HTML）、切片、Embedding 批处理、写 pgvector、版本管理、索引状态、BullMQ 异步任务、上传任务查询 |
| **AdminModule** | 知识库文档 CRUD、FAQ CRUD、禁答规则 CRUD、低置信度问题管理、用户与角色管理、KB 版本切换 |
| **AnalyticsModule** | 问答日志查询、Top 热门问题、命中率、低置信度统计、用户满意度、导出 |
| **HealthModule** | `/health`（存活）、`/ready`（DB / Redis / MinIO / LLM Gateway 就绪） |

### LLM Gateway 设计
- 业务代码**不得**直接调用 Qwen/DeepSeek/vLLM API，必须统一走 `LlmService`
- Provider 通过配置切换：`LLM_PROVIDER=qwen | deepseek | vllm`
- 统一接口：`chat({ messages, temperature, stream })` / `embed(texts[])` / `rerank(query, docs[])`
- Token 用量、错误率、延迟埋点 → Prometheus
- 失败重试 + 多 Provider failover

### 自研 RAG Pipeline（不依赖 LangChain）
1. **Query 改写**：基于多轮上下文做指代消解与意图补全
2. **FAQ 优先命中**：Embedding 相似度 > 阈值（如 0.9）直接返回 FAQ
3. **向量召回**：pgvector Top-K（K=20），可叠加 BM25 关键词召回
4. **Rerank**：BGE-Reranker / Cohere / 自研 cross-encoder
5. **Prompt 构造**：系统提示 + 引用片段（带编号）+ 对话历史 + 用户问题
6. **LLM 生成**：LLM Gateway 流式输出
7. **拒答与 confidence**：当 top 相似度 < 阈值或命中禁答规则时**拒答**
8. **引用来源**：返回 `sources: [{ chunkId, documentId, title, snippet, score }]`

---

## 数据库 Schema（Prisma）

```prisma
// users 管理员/运营账号
model User {
  id           String   @id @default(cuid())
  username     String   @unique
  passwordHash String
  displayName  String?
  email        String?  @unique
  roleId       String
  role         Role     @relation(fields: [roleId], references: [id])
  status       UserStatus @default(ACTIVE)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  uploads      UploadJob[]
}

enum UserStatus { ACTIVE DISABLED }

// roles 角色（RBAC）
model Role {
  id          String   @id @default(cuid())
  name        String   @unique           // admin / operator / viewer
  permissions Json                        // 权限点列表
  users       User[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// knowledge_base_versions 知识库版本（灰度切换）
model KnowledgeBaseVersion {
  id          String   @id @default(cuid())
  version     String   @unique           // v2026.1
  description String?
  isActive    Boolean  @default(false)
  activatedAt DateTime?
  createdAt   DateTime @default(now())
  documents   Document[]
}

// documents 文档
model Document {
  id            String   @id @default(cuid())
  kbVersionId   String
  kbVersion     KnowledgeBaseVersion @relation(fields: [kbVersionId], references: [id])
  title         String
  fileKey       String                  // MinIO object key
  fileType      String                  // pdf/docx/md/html
  fileSize      Int
  status        DocumentStatus @default(PENDING)
  errorMessage  String?
  uploaderId    String
  uploader      User     @relation(fields: [uploaderId], references: [id])
  chunks        DocumentChunk[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

enum DocumentStatus { PENDING PARSING CHUNKING EMBEDDING READY FAILED }

// document_chunks 文档切片（含 embedding）
model DocumentChunk {
  id          String   @id @default(cuid())
  documentId  String
  document    Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  chunkIndex  Int
  content     String
  contentTs   Unsupported("tsvector")?  // 可选：全文检索
  embedding   Unsupported("vector(1024)")? // BGE-large-zh 维度
  tokenCount  Int
  metadata    Json                       // {section, page, source}
  createdAt   DateTime @default(now())
  @@index([documentId])
  @@index([kbVersionId])
}

// faq_items FAQ 优先命中
model FaqItem {
  id          String   @id @default(cuid())
  question    String
  answer      String
  category    String?
  embedding   Unsupported("vector(1024)")?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// forbidden_rules 禁答/安全规则
model ForbiddenRule {
  id          String   @id @default(cuid())
  pattern     String                     // 关键词/正则
  ruleType    ForbiddenRuleType
  reply       String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum ForbiddenRuleType { KEYWORD REGEX CATEGORY }

// chat_sessions 会话
model ChatSession {
  id           String   @id @default(cuid())
  userId       String?                   // 匿名时为空
  visitorId    String?                   // 浏览器指纹/Cookie
  title        String?
  kbVersionId  String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  messages     ChatMessage[]
  @@index([visitorId])
}

// chat_messages 消息
model ChatMessage {
  id          String   @id @default(cuid())
  sessionId   String
  session     ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role        MessageRole
  content     String
  sources     Json?                     // 来源引用
  confidence  Float?
  ragLogId    String?
  feedback    Feedback?
  createdAt   DateTime @default(now())
  @@index([sessionId])
}

enum MessageRole { USER ASSISTANT SYSTEM }

// feedbacks 用户反馈
model Feedback {
  id         String   @id @default(cuid())
  messageId  String   @unique
  message    ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  rating     FeedbackRating
  comment    String?
  createdAt  DateTime @default(now())
}

enum FeedbackRating { UP DOWN }

// rag_logs RAG 调用日志（用于分析与调优）
model RagLog {
  id              String   @id @default(cuid())
  sessionId       String?
  messageId       String?
  query           String
  rewrittenQuery  String?
  retrievedTopK   Json                     // [{chunkId, score}]
  rerankedTopK    Json?
  faqHit          Boolean  @default(false)
  confidence      Float?
  isAnswered      Boolean
  rejectReason    String?
  promptTokens    Int?
  completionTokens Int?
  latencyMs       Int
  llmProvider     String
  createdAt       DateTime @default(now())
  @@index([createdAt])
  @@index([isAnswered])
}

// upload_jobs 异步上传/索引任务
model UploadJob {
  id          String   @id @default(cuid())
  documentId  String?
  uploaderId  String
  uploader    User     @relation(fields: [uploaderId], references: [id])
  status      JobStatus
  progress    Int      @default(0)
  errorMessage String?
  startedAt   DateTime?
  finishedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum JobStatus { QUEUED RUNNING SUCCESS FAILED }
```

---

## 关键 API 设计

### 公共（用户端）
- `POST /api/v1/chat/send` — 同步问答
  - Body: `{ sessionId?, message, kbVersion? }`
  - Res: `{ sessionId, messageId, answer, sources:[{title, snippet, score}], confidence, faqHit }`
- `POST /api/v1/chat/stream` — **SSE 流式问答**（ChatModule 核心）
  - Body 同上
  - Stream: `event: token | sources | done | error`
- `GET  /api/v1/chat/sessions` — 会话列表
- `GET  /api/v1/chat/sessions/:id/messages` — 会话消息
- `POST /api/v1/feedback` — `{ messageId, rating, comment? }`
- `GET  /api/v1/faqs` — 常见问题

### 管理端（需 JWT + 角色）
- `POST /api/v1/admin/auth/login` — 登录
- `POST /api/v1/admin/auth/refresh`
- `GET  /api/v1/admin/me`

- **文档**（`DocumentModule`）
  - `POST   /api/v1/admin/documents/upload`（multipart）— 上传
  - `GET    /api/v1/admin/documents` — 列表（分页/筛选）
  - `DELETE /api/v1/admin/documents/:id`
  - `POST   /api/v1/admin/documents/:id/reindex`
  - `GET    /api/v1/admin/jobs/:id`

- **知识库版本**
  - `GET    /api/v1/admin/kb-versions`
  - `POST   /api/v1/admin/kb-versions`
  - `POST   /api/v1/admin/kb-versions/:id/activate`

- **FAQ**（`AdminModule`）
  - `GET/POST/PUT/DELETE /api/v1/admin/faqs`

- **禁答规则**
  - `GET/POST/PUT/DELETE /api/v1/admin/forbidden-rules`

- **低置信度问题**
  - `GET  /api/v1/admin/low-confidence-questions`
  - `POST /api/v1/admin/low-confidence-questions/:id/answer`（人工补答并入库）

- **分析**（`AnalyticsModule`）
  - `GET /api/v1/admin/analytics/overview`
  - `GET /api/v1/admin/analytics/top-questions`
  - `GET /api/v1/admin/analytics/hit-rate`
  - `GET /api/v1/admin/analytics/low-confidence`
  - `GET /api/v1/admin/analytics/rag-logs`（分页 + 筛选）

- **健康**
  - `GET /api/v1/health/live`
  - `GET /api/v1/health/ready`

---

## ADDED Requirements

### Requirement: 工程结构与可运行性
系统 SHALL 提供完整可一键启动的工程：Docker Compose 编排 PostgreSQL（pgvector）、Redis、MinIO、后端、前端、Nginx；提供 `.env.example`、`README` 部署文档、Prisma migration。

#### Scenario: 一键启动
- **WHEN** 运维执行 `docker compose up -d` 并复制 `.env.example` 为 `.env` 填入 LLM API Key
- **THEN** 全部服务正常启动，前端可访问，聊天可调用

### Requirement: LLM Gateway 统一接入
系统 SHALL 通过 LLM Gateway 统一封装 Qwen/DeepSeek/vLLM OpenAI-compatible API，业务代码不得直接调用厂商 API；模型、API Key、Base URL 全部通过 env 注入；支持流式。

#### Scenario: 切换模型供应商
- **WHEN** 运营修改 `LLM_PROVIDER` 为 deepseek 并重启后端
- **THEN** 不需要改动业务代码，系统调用切换为 DeepSeek

#### Scenario: API Key 不硬编码
- **WHEN** 审查代码
- **THEN** 仓库内不存在任何真实 API Key，仅通过 env 注入

### Requirement: AuthModule
系统 SHALL 提供管理员登录、JWT Access/Refresh 双 Token、RBAC 角色权限（admin / operator / viewer），Guard 守卫敏感接口。

#### Scenario: 登录成功
- **WHEN** 管理员用正确账号密码登录
- **THEN** 返回 access_token + refresh_token 与用户信息

#### Scenario: 无权限访问
- **WHEN** viewer 角色调用文档删除接口
- **THEN** 返回 403 统一错误格式

### Requirement: ChatModule（SSE 流式）
系统 SHALL 提供 SSE 流式问答接口，事件包含 `token / sources / done / error`；支持匿名 session（visitorId 持久化）与登录用户会话；消息持久化到 PostgreSQL。

#### Scenario: 流式问答
- **WHEN** 用户在前端提问
- **THEN** SSE 实时推送 token，最后推送 sources 列表与 done 事件

#### Scenario: 多轮对话
- **WHEN** 用户在同一 session 内继续追问
- **THEN** 系统结合最近 N 轮上下文回答

### Requirement: RagModule（自研 Pipeline）
系统 SHALL 实现自研轻量 RAG Pipeline：Query 改写 → FAQ 优先命中 → 向量召回 → Rerank → Prompt 构造 → LLM 生成 → 拒答判断 → 来源回传；统一走 LLM Gateway；RAG 日志落库。

#### Scenario: 来源必现
- **WHEN** 系统给出回答
- **THEN** `sources` 至少包含 1 条记录（chunkId, documentId, title, snippet, score）

#### Scenario: 拒答
- **WHEN** 命中禁答规则 或 top 相似度 < 阈值 或检索为空
- **THEN** 系统礼貌拒答（返回固定话术）且不编造信息

#### Scenario: FAQ 优先
- **WHEN** 用户问题与某 FAQ 相似度 ≥ 阈值
- **THEN** 跳过 LLM，直接返回 FAQ 答案

#### Scenario: KB 版本过滤
- **WHEN** 客户端传入 `kbVersion=v2026.1` 或未传（默认当前激活版本）
- **THEN** 仅在该版本下检索

#### Scenario: 招生政策类安全规则
- **WHEN** 用户问"学费是否还可以优惠"等模糊政策类问题命中禁答规则
- **THEN** 返回拒答话术并引导联系招生办

### Requirement: DocumentModule
系统 SHALL 支持 PDF/Word/HTML/Markdown 上传至 MinIO，解析、切分、Embedding 批处理后写入 pgvector；通过 BullMQ 异步执行；提供任务进度查询；支持版本管理与重新索引。

#### Scenario: 上传索引
- **WHEN** 管理员上传 PDF
- **THEN** 文档状态依次变更 PENDING → PARSING → CHUNKING → EMBEDDING → READY；失败进入 FAILED 并写入 errorMessage

#### Scenario: 重新索引
- **WHEN** 管理员对某文档触发 reindex
- **THEN** 删除旧 chunks 后重新走一遍流水线

### Requirement: AdminModule
系统 SHALL 提供知识库版本、FAQ、禁答规则、低置信度问题、用户/角色的 CRUD；所有写操作记录审计日志。

#### Scenario: 切换 KB 版本
- **WHEN** 管理员激活 v2026.1
- **THEN** 后续用户请求默认使用该版本

### Requirement: AnalyticsModule
系统 SHALL 提供问答日志查询、Top 热门问题、命中率、低置信度统计、用户满意度，支持分页、筛选、导出。

#### Scenario: 命中率统计
- **WHEN** 管理员查看命中率
- **THEN** 展示 `isAnswered=true / total` 与按日趋势

### Requirement: CommonModule（统一基础）
系统 SHALL 提供统一响应格式 `{ code, message, data, requestId }`、全局异常过滤器、pino 结构化日志（含 requestId）、Zod/class-validator DTO 校验、Redis 令牌桶限流、JWT/Role Guard。

#### Scenario: 统一响应
- **WHEN** 任意接口成功返回
- **THEN** 响应体符合统一格式

#### Scenario: 异常处理
- **WHEN** 业务抛出业务异常
- **THEN** 全局过滤器返回统一错误响应并写入日志

#### Scenario: 限流
- **WHEN** 同一 IP 在窗口内 QPS 超过阈值
- **THEN** 返回 429 并提示稍后重试

### Requirement: 可观测性
系统 SHALL 暴露 Prometheus 指标（QPS、延迟、错误率、LLM token 用量、Vector 召回耗时），pino 日志含 requestId 与会话/消息上下文。

#### Scenario: 指标采集
- **WHEN** 运维拉起 Prometheus
- **THEN** 可在 Grafana 看到核心业务指标

---

## MODIFIED Requirements
无

## REMOVED Requirements
无
