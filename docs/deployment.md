# 部署指南

> 适用:开发 / 预发 / 生产
> 推荐:单台 4C8G(开发) / 双 8C16G(生产,跑 compose) / K8s(大规模)
> 一句话:**环境变量正确 + 镜像起来 + DB 迁移 + 种子** = 跑通

---

## 1. 环境要求

| 组件 | 最低 | 推荐 | 备注 |
| --- | --- | --- | --- |
| Node.js | 20.x LTS | 20.x | 启用 corepack:`corepack enable` |
| pnpm | 9.x | 9.x | 工作区包管理 |
| Docker | 24.x | 26.x | 含 Compose v2 |
| PostgreSQL | 16 + pgvector 0.7+ | 16 | 镜像 `pgvector/pgvector:pg16` |
| Redis | 7.x | 7.x | AOF 持久化 |
| MinIO | latest | RELEASE.2024-09+ | S3 兼容 |
| Nginx | 1.25+ | 1.27+ | 反代 + SSE |
| LLM Provider | — | Qwen / DeepSeek / vLLM | OpenAI 兼容端点 |
| 操作系统 | macOS / Linux | Ubuntu 22.04 LTS | Windows 需 WSL2 |
| CPU / MEM | 4C8G | 8C16G(生产) | 见 §7 容量 |

---

## 2. 五分钟本地启动(开发)

### 2.1 一键脚本

```bash
# 1) 准备环境变量
cp .env.example .env
# 至少填 LLM_API_KEY / EMBEDDING_API_KEY / JWT_ACCESS_SECRET / JWT_REFRESH_SECRET

# 2) 启动基础依赖(先开 DB / Redis / MinIO,后端跑在本地)
docker compose up -d postgres redis minio minio-init

# 3) 安装依赖
pnpm install

# 4) 数据库迁移 + 种子
pnpm --filter backend prisma:deploy
pnpm --filter backend prisma:seed

# 5) 启动前后端(dev 模式,热更新)
pnpm dev
```

启动后访问:

| 服务 | 地址 | 凭据 |
| --- | --- | --- |
| 前端(开发) | http://localhost:5173 | — |
| 前端(Nginx) | http://localhost:8080 | — |
| 后端 API | http://localhost:3000/api/v1 | — |
| MinIO 控制台 | http://localhost:9001 | minioadmin / changeme |
| PostgreSQL | localhost:5432 | wyu / wyu_rag |
| Redis | localhost:6379 | — |

### 2.2 默认管理员

```
username: admin
password: admin123
role:     admin
```

种子脚本会在 `seed.ts` 控制台打印,**首次登录后立即改密**。

### 2.3 健康检查

```bash
curl -sf http://localhost:3000/api/v1/health/live    # 存活
curl -sf http://localhost:3000/api/v1/health/ready   # 就绪(含依赖)
curl -sf http://localhost:8080/nginx-health          # Nginx
```

---

## 3. 生产部署(Docker Compose)

### 3.1 拓扑

```mermaid
graph LR
    LB[SLB / Cloudflare] -->|443| NG[Nginx :8080]
    NG -->|/api/v1/*| B1[Backend :3000 #1]
    NG -->|/api/v1/*| B2[Backend :3000 #2]
    NG -->|/*| FE[Frontend :80 static]
    B1 --> PG[(PG :5432)]
    B1 --> RD[(Redis :6379)]
    B1 --> MN[(MinIO :9000)]
    B2 --> PG
    B2 --> RD
    B2 --> MN
    B1 --> LLM[LLM Gateway]
    B2 --> LLM
```

### 3.2 上线 checklist

- [ ] `.env` 全部 `production` 级强密钥(见 §4)
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 用 `openssl rand -hex 32` 生成,**与开发不同**
- [ ] `MINIO_ROOT_PASSWORD` 改强
- [ ] `POSTGRES_PASSWORD` 改强
- [ ] `CORS_ORIGIN` 改为正式域名,不是 `*`
- [ ] `LOG_LEVEL=info`(生产不开 debug/trace)
- [ ] 关闭 `RATE_LIMIT_PER_MIN` 默认值,按 QPS 调
- [ ] `LLM_PROVIDER` 与 `LLM_FALLBACK_PROVIDERS` 至少配一主一备
- [ ] Nginx 启用 HTTPS + HSTS
- [ ] Prometheus / Grafana 已拉取 `/metrics`
- [ ] `pg_dump` 定时任务已配(cron + MinIO 远端归档)
- [ ] 域名 DNS A 记录指向服务器

### 3.3 启动

```bash
git clone <repo> && cd wyu-rag
cp .env.example .env && vim .env
docker compose pull
docker compose up -d
docker compose exec backend pnpm prisma migrate deploy
docker compose exec backend pnpm prisma db seed
docker compose ps    # 确认所有服务 healthy
```

---

## 4. 环境变量矩阵

按"系统 / LLM / DB / 第三方"四组。**生产必填项标 ⚠️**。

### 4.1 系统

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | ⚠️ | `production` 关掉 pretty 日志 |
| `APP_PORT` | `3000` | | backend 监听端口 |
| `APP_GLOBAL_PREFIX` | `/api/v1` | | 全局路由前缀 |
| `LOG_LEVEL` | `info` | | `fatal/error/warn/info/debug/trace` |
| `CORS_ORIGIN` | `*` | ⚠️ | 生产必须精确域名,逗号分隔多源 |
| `RATE_LIMIT_PER_MIN` | `60` | | 全局 IP 限流 |

### 4.2 LLM(LLM Gateway 唯一入口)

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `LLM_PROVIDER` | `qwen` | ⚠️ | `qwen` / `deepseek` / `vllm` / `openai` |
| `LLM_API_KEY` | — | ⚠️ | 主 Provider 凭据 |
| `LLM_BASE_URL` | — | ⚠️ | OpenAI 兼容端点 |
| `LLM_MODEL` | `qwen-plus` | | 模型名 |
| `LLM_TEMPERATURE` | `0.2` | | 0~2,招生场景建议 0.1~0.3 |
| `LLM_MAX_TOKENS` | `1500` | | 单次最大输出 |
| `LLM_TIMEOUT_MS` | `60000` | | 单次超时 |
| `LLM_FALLBACK_PROVIDERS` | `` | | 逗号分隔,主 Provider 失败时按序 failover |
| `EMBEDDING_API_KEY` | — | ⚠️ | 缺省回落到 `LLM_API_KEY` |
| `EMBEDDING_BASE_URL` | — | | 缺省回落 `LLM_BASE_URL` |
| `EMBEDDING_MODEL` | `text-embedding-v3` | | bge / qwen-v3 / openai text-embedding-3 |
| `EMBEDDING_DIM` | `1024` | ⚠️ | **必须**与 `DocumentChunk.embedding` 维度一致 |
| `EMBEDDING_BATCH_SIZE` | `32` | | 批大小,显存允许可调到 64 |
| `RERANK_PROVIDER` | `bge` | | `bge` / `cohere` / `none` |
| `RERANK_API_KEY` | — | | none 时可不填 |
| `RERANK_BASE_URL` | — | | BGE 自部署时填 |
| `RERANK_MODEL` | `BAAI/bge-reranker-v2-m3` | | |

### 4.3 数据库 / 缓存 / 对象存储

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | — | ⚠️ | `postgresql://user:pwd@host:5432/db?schema=public` |
| `REDIS_HOST` | `redis` | | compose 内为服务名 |
| `REDIS_PORT` | `6379` | | |
| `REDIS_PASSWORD` | — | | 强密码 ⚠️ |
| `REDIS_DB` | `0` | | |
| `REDIS_KEY_PREFIX` | `wyu:` | | 多租户可调 |
| `MINIO_ROOT_USER` | `minioadmin` | ⚠️ | |
| `MINIO_ROOT_PASSWORD` | `changeme` | ⚠️ | |
| `MINIO_ENDPOINT` | `minio` | | compose 内为服务名 |
| `MINIO_PORT` | `9000` | | |
| `MINIO_BUCKET` | `wyu-rag` | | |
| `MINIO_USE_SSL` | `false` | | 生产外部对象存储可改 `true` |

### 4.4 鉴权 / 业务 / 队列

| 变量 | 默认 | 必填 | 说明 |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | — | ⚠️ | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | — | ⚠️ | 同上,**与 access 不同** |
| `JWT_ACCESS_TTL` | `15m` | | 短 |
| `JWT_REFRESH_TTL` | `7d` | | 长 |
| `RAG_TOP_K` | `20` | | 向量召回数 |
| `RAG_RERANK_TOP_K` | `5` | | 精排后送 LLM 数 |
| `RAG_FAQ_THRESHOLD` | `0.92` | | FAQ 命中阈值 |
| `RAG_REJECT_THRESHOLD` | `0.55` | | 拒答阈值 |
| `RAG_MAX_CONTEXT_TOKENS` | `4000` | | 引用拼接上限 |
| `RAG_CACHE_TTL` | `600` | | FAQ 命中缓存秒数 |
| `BULLMQ_PREFIX` | `wyu` | | 多实例隔离 |

---

## 5. 数据库迁移与备份

### 5.1 迁移

```bash
# 开发(migration 文件)
pnpm --filter backend prisma:migrate

# 生产(只跑未应用)
pnpm --filter backend prisma:deploy

# 容器内
docker compose exec backend pnpm prisma migrate deploy
```

> pgvector 与 pg_trgm 扩展由 `infra/scripts/init-pgvector.sql` 在 PG 首次启动时启用。`datasource.db.extensions = [vector, pg_trgm]` 在 Prisma 端声明。

### 5.2 备份

```bash
# 备份(自定义格式,压缩比好)
docker compose exec -T postgres pg_dump \
  -U $POSTGRES_USER -d $POSTGRES_DB -Fc \
  -f /tmp/dump.custom
docker compose cp postgres:/tmp/dump.custom \
  ./backups/$(date +%F).dump

# 上传到 MinIO 远端归档
mc cp ./backups/$(date +%F).dump local/wyu-rag-backups/db/
```

cron 建议:每天 03:00 跑一次,保留 7 天本地 + 90 天远端。

### 5.3 恢复

```bash
# 1) 停 backend(避免连接冲掉)
docker compose stop backend

# 2) 恢复
docker compose cp ./backups/2026-06-01.dump postgres:/tmp/dump.custom
docker compose exec -T postgres pg_restore \
  -U $POSTGRES_USER -d $POSTGRES_DB \
  --clean --if-exists --no-owner /tmp/dump.custom

# 3) 启动 backend
docker compose up -d backend
```

### 5.4 Prisma seed

种子创建三角色(`admin` / `operator` / `viewer`)和默认管理员账号,**幂等**可重跑:

```bash
pnpm --filter backend prisma:seed
```

---

## 6. MinIO 备份

### 6.1 版本控制

```bash
mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD
mc version enable local/wyu-rag
```

### 6.2 跨桶/异地复制

```bash
# 同步到另一个 MinIO 集群
mc replicate add local/wyu-rag \
  --remote-bucket https://oss-dr.example.com/wyu-rag-dr
```

### 6.3 应用层记录 ETag

Document 上传时把 MinIO 返回的 `etag` 写入 `Document.metadata.etag`,便于追溯与回滚。

### 6.4 Redis 备份

```bash
# AOF 持续落盘(默认开启);RDB 快照(由 redis.conf save 触发)
docker compose exec redis sh -c 'cp /data/dump.rdb /tmp/'
docker compose cp redis:/tmp/dump.rdb ./backups/redis-$(date +%F).rdb
```

---

## 7. 扩容建议(招生季)

招生季(7~9 月)流量是平时的 5~10 倍。

| 资源 | 基线 | 招生季 | 备注 |
| --- | --- | --- | --- |
| Backend 实例 | 1 × 4C8G | ≥ 2 × 8C16G | 横向扩,RAG Pipeline 是 CPU 重 |
| PostgreSQL | 4C8G 独立 | 8C16G,主从 | 调 `shared_buffers=4GB,work_mem=64MB` |
| Redis | 2C4G | 4C8G,AOF 1s fsync | BullMQ 队列可能堆积 |
| MinIO | 4 盘 EC:2 | 4 盘 EC:4 | 容量按 5× 当前文档量预留 |
| LLM 配额 | 1 主 | 1 主 + 2 备 | 用 `LLM_FALLBACK_PROVIDERS=deepseek,vllm` |
| Nginx | 1 × 2C4G | 2 × 2C4G | 静态资源走 CDN |

### 7.1 调优项

- **pgvector HNSW**:`m=16, ef_construction=64`,查询 `ef_search=40`。回扫测试:TopK=20 P95 < 50ms。
- **Embedding 批处理**:从 32 提到 64(显存允许时)。
- **LLM 连接池**:`LlmService` 内 axios keep-alive,5 RPS 限流信号量。
- **BullMQ concurrency**:`document-ingest` 与 `embedding-batch` 各 `os.cpus().length / 2`,避免 OOM。
- **Redis 缓存**:
  - FAQ 命中缓存 TTL 600s
  - 热点 query embedding 缓存 TTL 1h
- **前端**:
  - Nginx `gzip` + `http2` + 长缓存(`Cache-Control: max-age=31536000, immutable` 给带 hash 的静态资源)
  - 首屏 SSR/SSG(Vite 5 prerender)

### 7.2 K8s 化(可选)

最小清单:

- `Deployment` × {backend, frontend, postgres, redis, minio}
- `Service` ClusterIP × {backend, postgres, redis, minio}
- `Ingress` × 1:路由 `/api/` 到 backend,`/` 到 frontend
- `PVC` × {postgres, redis, minio}
- `ConfigMap` + `Secret`
- `HPA` (CPU > 70% 扩 backend,min 2 / max 10)
- `PDB`(PodDisruptionBudget,minAvailable=1)
- `NetworkPolicy`(限制 backend → postgres/redis/minio 入口)

---

## 8. 可观测接入

### 8.1 Prometheus

`prometheus.yml` 增加:

```yaml
scrape_configs:
  - job_name: wyu-backend
    static_configs:
      - targets: ['backend:3000']
    metrics_path: /metrics
```

### 8.2 Grafana

导入仪表盘 JSON(占位,见 `infra/observability/grafana/`),核心面板:

- HTTP 5xx 率 / P95 / QPS
- RAG Pipeline 各阶段延迟(rewriter / recall / rerank / llm)
- LLM Token 消耗(按 provider/model)
- LLM 失败率(429/5xx/timeout)
- BullMQ 队列长度 / 任务成功率
- pgvector 召回 TopK 耗时
- FAQ 命中率 / 拒答率

### 8.3 Alertmanager

```yaml
groups:
- name: wyu-rag
  rules:
  - alert: High5xx
    expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01
    for: 5m
    labels: { severity: warning }
    annotations:
      summary: "HTTP 5xx 率 > 1%"

  - alert: LLMFailure
    expr: sum(rate(llm_errors_total[10m])) / sum(rate(llm_request_duration_seconds_count[10m])) > 0.05
    for: 10m
    labels: { severity: warning }

  - alert: QueueBacklog
    expr: bullmq_queue_size > 1000
    for: 5m
    labels: { severity: warning }

  - alert: RejectSpike
    expr: rate(rag_reject_total[10m]) > 50
    for: 10m
    labels: { severity: info }
    annotations:
      summary: "拒答率突增,可能知识库为空"
```

WebHook 推钉钉/飞书/Slack。

### 8.4 日志

`pino` 输出 JSON 至 stdout。生产建议:

- 容器 runtime 收集(国内用阿里云 SLS,国外用 Loki / ELK)。
- 字段过滤:`service=backend level=error requestId=...`。
- 7 天热存 + 30 天冷存。

---

## 9. 故障恢复(降级策略)

| 故障 | 检测 | 降级 | 恢复 |
| --- | --- | --- | --- |
| LLM 全挂 | `LlmService` 连续 3 次 5xx | 返回固定话术"系统升级中",code 4003 | 等 Provider 恢复,自动走 fallback |
| LLM 单 Provider 挂 | 4xx 之外 | 切到 `LLM_FALLBACK_PROVIDERS` 下一家 | 主恢复后下次请求自动回主 |
| Embedding 挂 | Embedding 5xx | DocumentModule 上传流水线失败,status=FAILED,errorMessage 落库 | 修好 Provider 后点 reindex |
| Postgres 挂 | `/health/ready` 503 | `/chat/stream` 返回 5201 | HAProxy / Patroni 切主 |
| Redis 挂 | `/health/ready` 503 | 限流降级为进程内存 LRU,Faq cache 失效 | 哨兵/Cluster 恢复 |
| MinIO 挂 | `/health/ready` 503 | 上传失败;已上传文档 RAG 仍可工作(向量在 PG) | mc admin heal 修复 |
| 后端 OOM | K8s OOMKilled | HPA 扩容 | 查内存泄漏,常驻 `pprof` 开关 |
| Nginx 挂 | LB 502 | LB 自动切 | 起新实例 |
| 招生季 DDoS | 5xx 突增 + 限流命中 | 启用 WAF / Cloudflare | 事后调限流阈值 |

---

## 10. 安全清单

| 项 | 建议 |
| --- | --- |
| HTTPS | 必须,Let's Encrypt 90 天自动续期 |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| 改默认密码 | admin123 / minioadmin / changeme / postgres 全部改强 |
| JWT Secret | 64 字节随机,production 必填 |
| 限流 | 默认 60/min/IP;`/chat/stream` 10/min/visitor |
| 上传白名单 | pdf / docx / md / html, ≤ 50MB |
| CORS | 精确域名,不开放 `*` |
| CSRF | Refresh Token 用 HttpOnly Cookie + SameSite=Lax |
| XSS | 前端用 React 默认转义;Markdown 渲染禁 raw HTML |
| SQL 注入 | Prisma 参数化 + 严格 DTO |
| 依赖审计 | `pnpm audit --prod` CI 必跑,Dependabot 周更 |
| 日志脱敏 | pino 序列化器对 Authorization/Cookie/password* 标记 `[REDACTED]` |
| 密钥管理 | `.env` 不入仓,CI 用 GitHub Secret 注入 |
| 文件权限 | 600 on `.env`,700 on backups/ |
| SSH | 禁密码,key-only,改 22 端口,`fail2ban` |
| fail2ban | 登录失败 5 次 ban 1h |
| 审计 | 所有 `/admin/*` 写操作写 AuditLog |

---

## 11. 故障排查速查

| 现象 | 排查 |
| --- | --- |
| 前端 502 | `docker compose ps nginx`,确认 backend healthy;`docker compose logs nginx` |
| `/chat/stream` 卡住 | 检查 Nginx `proxy_buffering off;` 与 `X-Accel-Buffering: no` |
| Embedding 报错 | `docker compose logs backend \| grep embedding`;核对 `EMBEDDING_API_KEY` 与 `EMBEDDING_DIM` |
| pgvector 报错 | `docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM pg_extension;"` |
| MinIO 桶不存在 | `docker compose up minio-init`(自动幂等) |
| 登录后 401 | 检查 `JWT_ACCESS_SECRET` 是否重启后变更;Redis 中是否有过期 Refresh |
| LLM 全 502 | `curl $LLM_BASE_URL/v1/models -H "Authorization: Bearer $LLM_API_KEY"` 直接验证 |
| 迁移失败 | `pnpm --filter backend prisma migrate status`,看是否 drift |
| 队列积压 | `docker compose logs backend \| grep bullmq`;Prometheus 看 `bullmq_queue_size` |
| SSE 立刻断开 | 看 Nginx `keepalive_timeout` ≥ 75s,`proxy_read_timeout` ≥ 60s |
| 限流误伤 | `redis-cli -h $REDIS_HOST KEYS 'wyu:ratelimit:*'`;`RATE_LIMIT_PER_MIN` 调高 |
| Prisma 慢查询 | `SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;` |

---

## 12. 升级流程

```bash
# 1. 拉代码
git pull

# 2. 备份(每次升级前必做)
./scripts/backup.sh

# 3. 升级后端
docker compose build backend
docker compose up -d backend
docker compose exec backend pnpm prisma migrate deploy

# 4. 升级前端
docker compose build frontend nginx
docker compose up -d frontend nginx

# 5. 烟测
curl -sf http://localhost:3000/api/v1/health/ready
curl -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"$NEW_PASSWORD"}'
```

回滚:

```bash
# 代码回滚
git checkout <tag> && docker compose up -d --build

# 数据库回滚
pnpm --filter backend prisma migrate resolve --rolled-back <migration_name>
```

---

## 13. 附录:关键服务端口

| 服务 | 端口 | 暴露 | 备注 |
| --- | --- | --- | --- |
| Nginx | 8080 | 公开 | 唯一外网入口 |
| Backend | 3000 | 内网 | 由 Nginx 反代 |
| PostgreSQL | 5432 | 内网 | wyu / wyu_rag |
| Redis | 6379 | 内网 | prefix `wyu:` |
| MinIO API | 9000 | 内网 | bucket `wyu-rag` |
| MinIO Console | 9001 | 内网 | 仅运维 |
| Prometheus | 9090 | 内网 | — |
| Grafana | 3001 | 内网 | — |
| Alertmanager | 9093 | 内网 | — |
