# WYU 招生 RAG —— 可观测性配置

本目录是 WYU 招生 RAG 问答系统的运维配置集合,包含 Prometheus / Alertmanager / Grafana
三件套的**纯配置文件**(不内置 docker-compose 编排),由运维同学按环境独立挂载。

后端指标的来源是 `backend/src/common/metrics/prom.service.ts`,由 `MetricsController`
在 `/api/v1/metrics` 暴露(PromService 已就绪,见 `tasks.md` Task 14.1)。

---

## 1. 目录结构

```
infra/observability/
├── prometheus/
│   ├── prometheus.yml                 # 主抓取配置
│   └── rules/
│       └── alerts.yml                 # 4 组告警规则(13 条)
├── alertmanager/
│   └── alertmanager.yml               # 路由 / 抑制 / 接收人
├── grafana/
│   └── dashboards/
│       └── wyu-rag-overview.json      # 18 panels 总览仪表盘
└── README.md                          # 本文件
```

---

## 2. 启动方式

本目录**不**含 docker-compose;Prometheus / Grafana / Alertmanager 由运维按本仓库
统一基础设施管理(可以是 docker-compose,也可以是 K8s Helm)。最小占位命令:

```bash
# 仅占位,实际 compose 在 infra/docker/ 之外的运维仓库
docker compose -f docker-compose.observability.yml up -d
```

挂载关键:

| 服务       | 挂载点                                       |
| ---------- | -------------------------------------------- |
| Prometheus | `./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro`<br>`./prometheus/rules/:/etc/prometheus/rules/:ro` |
| Alertmanager | `./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro` |
| Grafana    | `./grafana/dashboards/:/var/lib/grafana/dashboards/:ro` |

> 后端 metrics 端点:`http://backend:3000/api/v1/metrics`(`prometheus.yml` 中
> `backend` job 已默认指向 `host.docker.internal:3000`,生产请改 service DNS)。

---

## 3. Grafana 仪表盘导入

仪表盘 `wyu-rag-overview.json` 已包含 `__inputs`,会要求你选择 Prometheus 数据源。
两种方式导入:

### 方式 A:UI 导入(推荐)

1. 登录 Grafana → **Dashboards → New → Import**
2. 上传 `infra/observability/grafana/dashboards/wyu-rag-overview.json`
3. 在 "Select a Prometheus data source" 下拉中选择已配置的 Prometheus
4. 点击 **Import** 即可

### 方式 B:Provisioning(批量 / CI)

将仪表盘目录与 provisioning YAML 挂入 Grafana 容器:

```yaml
# /etc/grafana/provisioning/dashboards/wyu.yaml
apiVersion: 1
providers:
  - name: 'wyu-rag'
    orgId: 1
    folder: 'WYU'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
```

数据源 provisioning:

```yaml
# /etc/grafana/provisioning/datasources/prometheus.yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    uid: PBFA97CFB590B2093   # 与仪表盘默认 uid 对齐
    isDefault: true
```

### 仪表盘变量

| 变量         | 类型         | 来源                                                            |
| ------------ | ------------ | --------------------------------------------------------------- |
| `datasource` | datasource   | Prometheus 数据源                                               |
| `instance`   | query(multi) | `label_values(http_requests_total{job="backend"}, instance)`    |
| `route`      | query(multi) | `label_values(http_requests_total{job="backend"}, route)`       |
| `model`      | query(multi) | `label_values(llm_tokens_total, model)`                         |

支持按实例 / 路由 / LLM 模型过滤,All 选中走 `$__all`。

---

## 4. 告警 webhook 接入

`alertmanager/alertmanager.yml` 中所有 webhook URL 是占位
(`https://hooks.example.com/...`),需在生产替换为:

| Receiver             | 推荐集成                             | 替换字段                                  |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| `default`            | 团队 IM 群(钉钉 / 飞书 / Slack)    | `webhook_configs.url`                     |
| `pager`              | PagerDuty / 飞书值班机器人           | `webhook_configs.url` + 调整 `severity=critical` 路由 |
| `infra-team`         | 邮件 + IM                            | `email_configs.to` + `webhook_configs.url` |
| `rag-platform-team`  | 邮件 + IM                            | 同上                                      |

修改完成后无需重启其它服务,Alertmanager 自身支持热加载:

```bash
curl -X POST http://alertmanager:9093/-/reload
```

### 抑制规则(inhibit_rules)

- `severity=critical` 抑制同 `alertname` + `instance` 的 `warning`,避免重复通知。
- `BackendDown` 抑制 `HighErrorRate5xx` / `SlowP99Latency`(后端挂了就别再发延迟告警了)。

---

## 5. 告警分组与阈值

| 规则组       | 规则数 | 主要阈值                                    | 备注                                       |
| ------------ | ------ | ------------------------------------------- | ------------------------------------------ |
| backend-app  | 4      | 5xx>5%、P99>2s、Down>5m、HealthFail>1m     | 包含 Blackbox(可选)                       |
| rag-llm      | 5      | RAG 未答率>30%、P99>15s、LLM 错误>0.5/s、LLM P99>30s、token>1M/h | token 预算告警可调                         |
| queues       | 2      | backlog>1000、失败率>10%                    | `document-ingest` / `embedding-batch` 队列 |
| infra        | 5      | pg/redis down、minio 磁盘 down、disk<10%、mem>90% | 主机资源来自 node-exporter                 |

---

## 6. 阈值调优建议

**先观察,再固定** —— 阈值要基于真实历史 P50/P95,不是拍脑袋。

```promql
# 1) HTTP P95 / P99 历史基线
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1h])))
histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[1h])))

# 2) LLM P95 / P99(按 model)
histogram_quantile(0.95, sum by (le, model) (rate(llm_request_duration_seconds_bucket[1h])))

# 3) RAG 未答率历史
sum(rate(rag_requests_total{isAnswered="false"}[1h]))
  /
sum(rate(rag_requests_total[1h]))

# 4) BullMQ 队列每日峰值
max_over_time(bull_jobs_waiting{queue="document-ingest"}[24h])

# 5) 队列失败率
sum(rate(queue_jobs_total{status="failed"}[6h]))
  /
sum(rate(queue_jobs_total[6h]))
```

调优建议:

- **观察 2~4 周** 自然流量 / 错误率 / 延迟分布后,把告警阈值设为 P95×1.5~2 倍。
- **`LLMTokenExhausted`** 阈值 `1M tokens/h` 是起点,应改为"月度预算 80%"的速率阈值,
  通过 recording rule 算 `monthly_spend` 后再告警。
- **`BackendDown` `for: 5m`** 是为容忍滚动重启;若希望更激进,缩到 2min 并配合
  PagerDuty `severity:critical` 路由。
- **`HighErrorRate5xx` 5%** 在低 QPS 时期容易被噪声触发,可加 `and on() (sum(rate(http_requests_total[5m])) > 1)`
  做"流量"门限。

---

## 7. 故障排查 cheat-sheet

| 现象                          | 优先看什么                                                          |
| ----------------------------- | ------------------------------------------------------------------- |
| `BackendDown` 持续 fire       | `docker compose ps backend`、`docker compose logs --tail=200 backend` |
| `HighErrorRate5xx`            | 按 `route` 拆 stat,看是否单一路由,关联 LLM/RAG/DB 上游             |
| `LLMUpstreamErrors`           | 查 `provider` 标签,确认 token / 限流 / 5xx;检查 `LLM_PROVIDER` 切换 |
| `BullMQQueueBacklog`          | Bull Board(默认 3000 端口未暴露,需运维开启) + Worker 日志          |
| `MinIOStorageDown`            | 立即看 MinIO 控制台 `http://<host>:9001` 健康                       |
| `DiskSpaceLow`                | `du -sh /var/lib/docker`,`docker system prune -a --volumes` 慎用   |

---

## 8. 版本兼容

- Prometheus 2.45+(支持 alertmanager_config v2 路由)
- Grafana 8.5+(本仪表盘 `schemaVersion: 38`,Grafana 8.x/9.x/10.x 兼容)
- Alertmanager 0.25+(matchers 标签路由)

部署前请先在 staging 环境 dry-run 一次:

```bash
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/rules/alerts.yml
amtool check-config /etc/alertmanager/alertmanager.yml
```
