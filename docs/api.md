# API 文档

> 单一信源:后端控制器代码 + Zod/class-validator DTO + `ErrorCode` 枚举
> 基础 BaseURL:`http://localhost:3000`(开发) / `https://rag.wyu.edu.cn`(生产)
> 全局前缀:`/api/v1`
> 鉴权策略:**仅管理员需 JWT**;`/chat/*` 完全匿名,身份靠 `wyu_visitor_id` cookie

---

## 1. 通用约定

### 1.1 响应包装

所有非 SSE / 非文件流的响应都遵循统一格式:

```json
{
  "code": 0,
  "message": "ok",
  "data": { "...": "..." },
  "requestId": "01HZX...",
  "timestamp": 1700000000000
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | number | 业务码,0 = 成功;其余见 [错误码表](#错误码表) |
| `message` | string | 人类可读消息,前端可展示 |
| `data` | T \| null | 业务负载,失败时为 `null` |
| `requestId` | string | ULID,贯穿日志/排错用 |
| `timestamp` | number | 毫秒时间戳 |

**SSE 端点**(`/chat/stream`)走 `text/event-stream`,不会被包装,详见 [§5](#5-sse-事件格式)。
**CSV 导出**(`/admin/analytics/export.csv`)走 `text/csv`,不被包装。

### 1.2 鉴权

- **公共路由**(`/chat/*`、`/health/*`、`/admin/auth/login`、`/admin/auth/refresh`、`/admin/auth/me`):
  - 不需要 `Authorization` header
  - `/chat/*` 需要 `wyu_visitor_id` cookie(由服务端 `VisitorIdMiddleware` 自动种)
- **受保护路由**(`/admin/*` 除上述三个):
  - `Authorization: Bearer <accessToken>`
  - Access Token 15min,Refresh Token 7d
  - Refresh 三路投递(任一即可):`body.refreshToken` / `Cookie: wyu_refresh=<token>` / `X-Refresh-Token: <token>`

### 1.3 Cookie

| 名称 | 用途 | 作用域 | 过期 |
| --- | --- | --- | --- |
| `wyu_visitor_id` | 家长/访客身份(ULID) | 全部 `/chat/*` | 1 年 |
| `wyu_refresh` | 管理员 Refresh Token(HttpOnly) | `/admin/*` | 7d |

### 1.4 SSE 用法

```ts
// 浏览器
const es = new EventSource('/api/v1/chat/stream', { withCredentials: true });
// 注意:EventSource 不支持 POST body,生产中如需复杂参数,可改 fetch + ReadableStream
es.addEventListener('token', (e) => render((e as MessageEvent).data));
es.addEventListener('sources', (e) => setSources(JSON.parse((e as MessageEvent).data)));
es.addEventListener('done', (e) => finalize(JSON.parse((e as MessageEvent).data)));
es.addEventListener('error', (e) => showError((e as MessageEvent).data));
```

服务端使用 `POST /chat/stream` + 响应体而非 `GET`,因为请求体需要带问题内容。客户端实际常用 `fetch().then(r => r.body.getReader())` 自实现 SSE 解析。

### 1.5 限流

`RedisRateLimitGuard` 全局生效,默认 **60 req/min/IP**(`RATE_LIMIT_PER_MIN` 可调)。
触发时:

```json
{ "code": 1005, "message": "Too many requests", "data": null, "requestId": "...", "timestamp": ... }
```

HTTP 状态 `429`。响应头会带 `Retry-After`(秒)与 `X-RateLimit-Remaining`。

### 1.6 错误码表

| 业务码 | HTTP | 含义 | 触发场景 |
| --- | --- | --- | --- |
| 0 | 2xx | 成功 | — |
| **1xxx 通用** | | | |
| 1000 | 500 | 未知错误 | 未捕获异常 |
| 1001 | 400 | 参数校验失败 | Zod / class-validator 失败 |
| 1002 | 401 | 未登录 / Token 缺失 | 缺 `Authorization` |
| 1003 | 403 | 权限不足 | RolesGuard / PermissionsGuard 拒绝 |
| 1004 | 404 | 资源不存在 | 通用 404 |
| 1005 | 429 | 触发限流 | 60 req/min/IP 超限 |
| 1006 | 409 | 资源冲突 | 邮箱/用户名已存在 |
| **2xxx 鉴权** | | | |
| 2001 | 401 | 凭据错误 | 密码错 / 用户不存在 |
| 2002 | 401 | Access Token 过期 | 需用 Refresh |
| 2003 | 401 | Token 无效 | 签名错 / 格式错 |
| 2004 | 403 | 用户已禁用 | `UserStatus=DISABLED` |
| **3xxx 文档 / KB / FAQ** | | | |
| 3001 | 404 | 文档不存在 | `Document.id` 找不到 |
| 3002 | 500 | 文档解析失败 | pdf-parse / mammoth 抛错 |
| 3003 | 413 | 文档过大 | > 50MB |
| 3004 | 415 | 不支持的文件类型 | 后缀不在白名单 |
| 3005 | 500 | 索引失败 | Embedding 写库失败 |
| 3101 | 404 | KB 版本不存在 | `KnowledgeBaseVersion.id` 找不到 |
| 3102 | 409 | 已经是当前激活版本 | 重复激活 |
| 3201 | 404 | FAQ 不存在 | — |
| **4xxx RAG** | | | |
| 4001 | 200 | 检索无相关上下文 | top 相似度 < `RAG_REJECT_THRESHOLD` |
| 4002 | 200 | 命中禁答规则 | 关键词/正则/分类命中 |
| 4003 | 502 | LLM 上游错误 | Qwen/DeepSeek/vLLM 5xx/timeout |
| 4004 | 502 | Embedding 服务错误 | Embedding Provider 失败 |
| 4005 | 502 | Rerank 服务错误 | Rerank Provider 失败 |
| **5xxx 外部依赖** | | | |
| 5001 | 504 | 上游超时 | LLM 60s 未响应 |
| 5101 | 502 | 对象存储失败 | MinIO putObject 抛错 |
| 5201 | 500 | 数据库错误 | Prisma 抛错 |
| 5301 | 500 | Redis 错误 | ioredis 抛错 |

> 注:`4xxx` 系列的 HTTP 码通常是 200(因为业务层把"拒答"视为正常输出,只在 body 标 `isAnswered=false`),但 code 仍区分。

---

## 2. 认证(管理员)

### 2.1 `POST /admin/auth/login`

- 鉴权:`@Public()`
- 请求体:
  ```json
  { "username": "admin", "password": "admin123" }
  ```
- 响应:
  ```json
  {
    "code": 0,
    "message": "ok",
    "data": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "user": {
        "id": "u_1",
        "username": "admin",
        "displayName": "系统管理员",
        "email": "admin@wyu.edu.cn",
        "role": "admin",
        "permissions": ["*"]
      }
    },
    "requestId": "01HZX...",
    "timestamp": 1700000000000
  }
  ```
- curl:
  ```bash
  curl -X POST http://localhost:3000/api/v1/admin/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}'
  ```
- 失败:2001(凭据错)/ 2004(用户禁用)

### 2.2 `POST /admin/auth/refresh`

- 鉴权:`@Public()`(Refresh Token 自带身份)
- 请求体(三选一):
  ```json
  { "refreshToken": "eyJ..." }
  ```
  或 header:`X-Refresh-Token: eyJ...` / cookie `wyu_refresh=eyJ...`
- 响应:
  ```json
  { "code": 0, "message": "ok", "data": { "accessToken": "eyJ..." }, "requestId": "...", "timestamp": 0 }
  ```
- 失败:2001 / 2002 / 2003

### 2.3 `GET /admin/auth/me`

- 鉴权:`@Public()`(可匿名调,带 token 则返回 user,否则返回 `{ user: null }`)
- 响应:
  ```json
  { "code": 0, "data": { "id": "u_1", "username": "admin", "role": "admin", "permissions": ["*"] } }
  ```

---

## 3. 聊天(家长/访客)

所有 `/chat/*` 路由均 `@Public()` + 全局限流 + `wyu_visitor_id` cookie。

### 3.1 `POST /chat/send`(同步)

- 请求体:
  ```json
  {
    "sessionId": "c_01HZX...",  // 可选,空则创建
    "question": "国际本科的学费是多少?"
  }
  ```
- 响应:
  ```json
  {
    "code": 0,
    "data": {
      "sessionId": "c_01HZX...",
      "messageId": "m_01HZX...",
      "answer": "2026 年国际本科项目学费为 38000 元/学年(详见下条引用)。",
      "sources": [
        { "chunkId": "ch_42", "documentId": "d_admissions_2026", "title": "2026 招生章程", "snippet": "学费:38000 元/学年", "score": 0.87 }
      ],
      "confidence": 0.87,
      "faqHit": false,
      "usage": { "promptTokens": 1280, "completionTokens": 312, "totalTokens": 1592 },
      "latencyMs": 1843
    }
  }
  ```
- curl:
  ```bash
  curl -X POST http://localhost:3000/api/v1/chat/send \
    -H 'Content-Type: application/json' \
    -b 'wyu_visitor_id=01HZX_VISITOR' \
    -d '{"question":"国际本科的学费是多少?"}'
  ```

### 3.2 `POST /chat/stream`(SSE 流式)

- 请求体:同 `/chat/send`
- 响应:`Content-Type: text/event-stream`
- 事件:[详见 §5](#5-sse-事件格式)

### 3.3 `POST /chat/sessions`(创建会话)

- 请求体:`{ "title": "关于国际本科招生" }`
- 响应:
  ```json
  { "code": 0, "data": { "sessionId": "c_01HZX..." } }
  ```

### 3.4 `GET /chat/sessions`(列表)

- Query:`page=1&pageSize=20`
- 响应:
  ```json
  { "code": 0, "data": { "items": [{ "id": "c_...", "title": "...", "createdAt": "...", "updatedAt": "..." }], "total": 12, "page": 1, "pageSize": 20 } }
  ```

### 3.5 `GET /chat/sessions/:id/messages`

- Query:`page=1&pageSize=50`
- 响应:`data.items[]` 含 `role` (USER/ASSISTANT/SYSTEM)、`content`、`sources`、`confidence`、`createdAt`。

### 3.6 `POST /chat/messages/:id/feedback`

- 请求体:
  ```json
  { "rating": 1, "comment": "答案很清晰" }
  ```
  `rating`: `1` 赞 / `-1` 踩 / `0` 取消
- 响应:`{ "code": 0, "data": { "feedbackId": "f_..." } }`

---

## 4. 文档管理(管理员)

### 4.1 `POST /admin/documents/upload`

- 鉴权:JWT + `document:write` + `Roles(admin/operator)`
- `multipart/form-data`,字段:
  - `file`:pdf/docx/md/html,≤ 50MB
  - `kbVersionId`:目标 KB 版本
- 响应(`201`):
  ```json
  { "code": 0, "data": { "documentId": "d_01HZX...", "status": "PENDING", "uploadJobId": "j_01HZX..." } }
  ```
- curl:
  ```bash
  curl -X POST http://localhost:3000/api/v1/admin/documents/upload \
    -H "Authorization: Bearer $TOKEN" \
    -F 'file=@./招生章程.pdf' \
    -F 'kbVersionId=v2026.1'
  ```
- 失败:3003(过大) / 3004(类型不支持) / 3101(KB 不存在)

### 4.2 `GET /admin/documents`(列表)

- 鉴权:JWT + `document:read`
- Query:`page=1&pageSize=20&status=READY&kbVersionId=v2026.1&q=章程`
- 响应:
  ```json
  {
    "code": 0,
    "data": {
      "items": [
        {
          "id": "d_01HZX...",
          "title": "2026 招生章程",
          "fileType": "pdf",
          "fileSize": 524288,
          "status": "READY",
          "chunkCount": 86,
          "kbVersionId": "v2026.1",
          "uploaderId": "u_1",
          "createdAt": "...",
          "processedAt": "..."
        }
      ],
      "total": 24,
      "page": 1,
      "pageSize": 20
    }
  }
  ```

### 4.3 `GET /admin/documents/:id`(详情)

- 鉴权:JWT + `document:read`
- 响应:含元数据 + 状态 + chunkCount + uploader + errorMessage(若 FAILED)。

### 4.4 `DELETE /admin/documents/:id`(归档)

- 鉴权:JWT + `document:write` + `Roles(admin/operator)`
- 软删除:`status=ARCHIVED`,数据可恢复。
- 响应:`{ "code": 0, "data": { "id": "d_...", "status": "ARCHIVED" } }`

### 4.5 `POST /admin/documents/:id/reindex`

- 鉴权:JWT + `document:write` + `Roles(admin/operator)`
- 行为:删旧 chunks → 重新走 PENDING → ... → READY。
- 响应:`{ "code": 0, "data": { "uploadJobId": "j_01HZX...", "status": "PENDING" } }`

### 4.6 `GET /admin/documents/:id/jobs`(任务进度)

- 鉴权:JWT + `document:read`
- 响应:`data.items[]` 含 `id, status, progress, stage, errorMessage, startedAt, finishedAt`。
- `stage` 取值:`PARSING` / `CHUNKING` / `EMBEDDING`。

---

## 5. SSE 事件格式

`POST /chat/stream` 返回 `text/event-stream`,事件共有 4 种类型,每个 `data` 字段都是字符串(对象会被 `JSON.stringify`):

| event | data 类型 | 含义 | 频次 |
| --- | --- | --- | --- |
| `token` | string(纯文本片段) | LLM 增量 token | 多次 |
| `sources` | JSON string(`Source[]`) | 最终来源列表 | 1 次(在 done 前) |
| `done` | JSON string(`{ isAnswered, confidence, faqHit, rejectReason, ragLogId }`) | 终止事件 | 1 次 |
| `error` | JSON string(`{ code, message }`) | 异常事件 | 0/1 次 |

`Source` 类型:

```ts
interface Source {
  chunkId: string;        // 切片 ID
  documentId: string;     // 文档 ID
  title: string;          // 文档标题
  snippet: string;        // 截取的引用片段(≤ 200 字符)
  score: number;          // 相似度(0~1)
}
```

### 5.1 典型成功样例

```
event: sources
data: [{"chunkId":"ch_42","documentId":"d_admissions_2026","title":"2026 招生章程","snippet":"学费:38000 元/学年","score":0.87}]

event: token
data: 2026

event: token
data: 年国际本科项目学费为

event: token
data: 38000 元/学年。

event: done
data: {"isAnswered":true,"confidence":0.87,"faqHit":false,"rejectReason":null,"ragLogId":"r_01HZX..."}
```

### 5.2 拒答样例

```
event: sources
data: []

event: token
data: 抱歉,我未在资料库中找到相关答案,建议您联系招生办(电话 0750-xxxxxxx)。

event: done
data: {"isAnswered":false,"confidence":0.32,"faqHit":false,"rejectReason":"RAG_NO_RELEVANT_CONTEXT","ragLogId":"r_01HZX..."}
```

### 5.3 异常样例

```
event: error
data: {"code":4003,"message":"LLM upstream error: deepseek 502"}
```

### 5.4 客户端实现(浏览器 fetch)

```ts
async function stream(question: string) {
  const res = await fetch('/api/v1/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    credentials: 'include',
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop()!;
    for (const frame of frames) {
      const [eventLine, ...dataLines] = frame.split('\n');
      const event = eventLine.replace(/^event:\s*/, '');
      const data = dataLines.join('\n').replace(/^data:\s*/, '');
      handle(event, data);
    }
  }
}
```

---

## 6. FAQ / 禁答 / KB 版本 / 低置信度(管理员)

### 6.1 FAQ CRUD

| Method | Path | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/faqs` | `faq:read` | Query:`page,pageSize,q,category,isActive` |
| GET | `/admin/faqs/:id` | `faq:read` | 详情 |
| POST | `/admin/faqs` | `faq:write` + `Roles(admin/operator)` | Body:`{ question, answer, category?, priority? }` |
| PATCH | `/admin/faqs/:id` | `faq:write` | 更新 |
| DELETE | `/admin/faqs/:id` | `faq:write` | 软删(`isActive=false`) |

POST 样例:

```json
{ "question": "国际本科的学费是多少?", "answer": "38000 元/学年", "category": "tuition" }
```

### 6.2 禁答规则 CRUD

| Method | Path | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/forbidden-rules` | `forbidden-rule:read` | Query:`page,pageSize,ruleType,isActive` |
| GET | `/admin/forbidden-rules/:id` | `forbidden-rule:read` | 详情 |
| POST | `/admin/forbidden-rules` | `forbidden-rule:write` + `Roles(admin/operator)` | Body:`{ name, pattern, ruleType, reply? }` |
| PATCH | `/admin/forbidden-rules/:id` | `forbidden-rule:write` | 更新 |
| DELETE | `/admin/forbidden-rules/:id` | `forbidden-rule:write` | 软删 |

`ruleType`:
- `KEYWORD` —— `pattern` 为字符串,简单包含匹配(支持 `|` 表示或)
- `REGEX` —— `pattern` 为合法正则
- `CATEGORY` —— `pattern` 为分类名,如 "政治" / "宗教"

### 6.3 KB 版本

| Method | Path | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/kb-versions` | `kb-version:read` | 列表 |
| POST | `/admin/kb-versions` | `kb-version:write` + `Roles(admin/operator)` | Body:`{ version, description? }` |
| POST | `/admin/kb-versions/:id/activate` | `kb-version:write` | 同事务内把所有 `isActive=true` 改为 `false`,激活目标版本 |

激活响应:
```json
{ "code": 0, "data": { "id": "v_01HZX...", "version": "v2026.1", "isActive": true, "activatedAt": "..." } }
```

### 6.4 低置信度问题

| Method | Path | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/low-confidence` | `low-confidence:read` | Query:`page,pageSize,reviewed`;查 `RagLog.confidence < 0.5 && isAnswered=false` |
| POST | `/admin/low-confidence/:id/answer` | `low-confidence:write` + `Roles(admin/operator)` | Body:`{ answer, category? }`,把 RagLog.query 入 FAQ,answer 作 FaqItem.answer |

---

## 7. 用户管理(管理员)

| Method | Path | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/users` | `user:read` | Query:`page,pageSize,q,roleId,status` |
| GET | `/admin/users/:id` | `user:read` | 详情 |
| POST | `/admin/users` | `user:write` + **`Roles('admin')`** | 创建 |
| PATCH | `/admin/users/:id` | `user:write` | 更新(displayName / email / roleId / status) |
| POST | `/admin/users/:id/reset-password` | `user:write` + **`Roles('admin')`** | Body:`{ password }`,重置后强登出 |

> 重要:用户创建与重置密码**只能由 admin 操作**,即使 operator 通过 RolesGuard 也会被 `Roles('admin')` 二次拦截。

---

## 8. 数据分析(管理员)

所有路由 `@Permissions('analytics:read')`。

### 8.1 `GET /admin/analytics/logs`

- Query:`page=1&pageSize=20&isAnswered=true&faqHit=false&from=2026-05-01&to=2026-06-01&q=学费`
- 响应:`data.items[]` 含 `id, query, rewrittenQuery, isAnswered, faqHit, confidence, rejectReason, promptTokens, completionTokens, latencyMs, llmProvider, createdAt`。

### 8.2 `GET /admin/analytics/overview`

- Query:`range=24h|7d|30d`(默认 7d)
- 响应:
  ```json
  {
    "code": 0,
    "data": {
      "range": "7d",
      "sessions": 1234,
      "messages": 5678,
      "faqHitRate": 0.42,
      "avgLatencyMs": 1820,
      "p95LatencyMs": 4200,
      "totalTokens": 1234567,
      "costCny": 245.6,
      "answeredRate": 0.91,
      "lowConfidenceCount": 87
    }
  }
  ```

### 8.3 `GET /admin/analytics/top-questions`

- Query:`range=7d&limit=20&faqHit=false`
- 响应:
  ```json
  { "code": 0, "data": { "items": [{ "query": "学费", "count": 234, "hitRate": 0.6 }, ...] } }
  ```

### 8.4 `GET /admin/analytics/trends`

- Query:`range=7d&granularity=hour|day`(默认 day)
- 响应:`data.buckets[]` 含 `bucket, sessions, messages, faqHitRate, answeredRate, avgLatencyMs`。

### 8.5 `GET /admin/analytics/export.csv`

- Query:同 `logs`
- 响应:`Content-Type: text/csv; charset=utf-8`,UTF-8 BOM 防 Excel 乱码,`Content-Disposition: attachment; filename="rag-logs.csv"`。
- 字段:`id, createdAt, sessionId, query, rewrittenQuery, isAnswered, faqHit, confidence, rejectReason, promptTokens, completionTokens, latencyMs, llmProvider`。
- 走 `StreamableFile`,不会被 `ResponseInterceptor` 包装。

---

## 9. 健康检查(工具)

### 9.1 `GET /health/live`

- 鉴权:`@Public()`
- 响应:`{ "status": "live", "timestamp": 1700000000000 }`(走统一包装)

### 9.2 `GET /health/ready`

- 鉴权:`@Public()`
- 并行检查 PostgreSQL / Redis / MinIO,3s 整体超时。
- 成功:`{ "status": "ok", "db": "up", "redis": "up", "minio": "up" }`,HTTP 200
- 失败:任意依赖 down → HTTP 503,`status: "fail`,对应字段值为 `"down"`。

---

## 10. 速率限制与配额

| 维度 | 限制 | 说明 |
| --- | --- | --- |
| 全局 IP | 60 req/min | `RATE_LIMIT_PER_MIN` 可调 |
| 单访客 `/chat/stream` | 10 次/分钟 | 由 ChatService 内 Token 桶控制 |
| LLM 调用 | 受 Provider 配额 + 内部 5 RPS 限流 | `LlmService` 内信号量 |

被限流时:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000030
Content-Type: application/json

{ "code": 1005, "message": "Too many requests", "data": null, "requestId": "...", "timestamp": 0 }
```

---

## 11. 审计与日志约定

- 所有 `/admin/*` 写操作(PATCH/POST/DELETE)由 `AdminService.recordAction` 统一写 `AuditLog`。
- 失败降级 warn,不阻断主流程(审计失败 ≠ 业务失败)。
- 日志字段:`service, level, requestId, userId, action, resource, resourceId, latencyMs`。
- 敏感字段(Authorization / Cookie / password* / token)在 pino 序列化器内做 `[REDACTED]`。
