#!/bin/bash
set -e
cd /opt/wyu-rag

echo "=== 1. 生成自签名 SSL 证书(有效期 3650 天) ==="
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout nginx/ssl/wyu.key \
  -out nginx/ssl/wyu.crt \
  -subj "/C=CN/ST=Guangdong/L=Jiangmen/O=WYU/OU=International/CN=47.107.173.200" \
  -addext "subjectAltName=IP:47.107.173.200"
chmod 600 nginx/ssl/wyu.key
echo "SSL 证书生成完成"

echo "=== 2. 创建生产 .env ==="
DB_PASS=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)
JWT_ACCESS=$(openssl rand -base64 48)
JWT_REFRESH=$(openssl rand -base64 48)
MINIO_PASS=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)

cat > .env << ENVEOF
POSTGRES_USER=wyu
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=wyu_rag
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-24e27b9bcb59424d9e9d3d997f76b399
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=1500
LLM_TIMEOUT_MS=60000
LLM_FALLBACK_PROVIDERS=qwen
EMBEDDING_API_KEY=sk-25b6212f8e3a4e609b606c7538494533
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode
EMBEDDING_MODEL=text-embedding-v3
EMBEDDING_DIM=1024
RERANK_PROVIDER=none
RERANK_MODEL=BAAI/bge-reranker-v2-m3
DATABASE_URL=postgresql://wyu:${DB_PASS}@postgres:5432/wyu_rag?schema=public
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_KEY_PREFIX=wyu:
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=${MINIO_PASS}
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_BUCKET=wyu-rag
MINIO_USE_SSL=false
JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
NODE_ENV=production
APP_PORT=3000
APP_GLOBAL_PREFIX=/api/v1
LOG_LEVEL=info
RATE_LIMIT_PER_MIN=120
CORS_ORIGIN=https://47.107.173.200
RAG_TOP_K=10
RAG_RERANK_TOP_K=5
RAG_FAQ_THRESHOLD=0.68
RAG_REJECT_THRESHOLD=0.40
RAG_NO_ANSWER_TEXT=抱歉，暂时未能从学院官方招生资料中找到与该问题直接相关的内容。建议您直接联系五邑大学国际教育学院招生办，或拨打学院咨询热线获取准确信息。
RAG_MAX_CONTEXT_TOKENS=4000
RAG_CACHE_TTL=600
BULLMQ_PREFIX=wyu
ENVEOF

echo "生产 .env 已生成，随机密码已设置"

echo "=== 3. 配置 Docker 镜像加速 ==="
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'DOCKEREOF'
{
  "registry-mirrors": ["https://mirror.aliyuncs.com"]
}
DOCKEREOF
systemctl reload docker 2>/dev/null || true
sleep 2

echo "=== 4. 构建镜像(首次约10-15分钟) ==="
docker compose build

echo "=== 5. 启动基础服务(postgres/redis/minio) ==="
docker compose up -d postgres redis minio minio-init
echo "等待 postgres 就绪..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U wyu -d wyu_rag > /dev/null 2>&1; then
    echo "PostgreSQL 就绪!"
    break
  fi
  sleep 3
done

echo "=== 6. 数据库迁移 + 初始化管理员 ==="
docker compose run --rm backend npx prisma migrate deploy
docker compose run --rm backend npx prisma db seed

echo "=== 7. 导入知识库数据(FAQ + 文档) ==="
if [ -f /opt/wyu-data.sql ]; then
  docker compose exec -T postgres psql -U wyu -d wyu_rag < /opt/wyu-data.sql
  echo "知识库数据导入完成"
else
  echo "警告: /opt/wyu-data.sql 不存在，跳过知识库导入"
fi

echo "=== 8. 启动全部服务 ==="
docker compose up -d

echo "等待 backend 就绪(最多5分钟)..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/api/v1/health/live > /dev/null 2>&1; then
    echo "Backend 就绪!"
    break
  fi
  printf "  等待... (%d/60)\r" $i
  sleep 5
done

echo "=== 9. 安装 fail2ban 防SSH爆破 ==="
dnf install -y fail2ban 2>&1 | tail -2
cat > /etc/fail2ban/jail.d/sshd.local << 'F2BEOF'
[sshd]
enabled  = true
port     = ssh
maxretry = 5
bantime  = 3600
findtime = 600
F2BEOF
systemctl enable --now fail2ban
echo "fail2ban 已启动"

echo ""
echo "========================================="
echo "部署完成!"
echo "访问地址: https://47.107.173.200"
echo "管理后台: https://47.107.173.200/admin"
echo "管理员账号: admin / admin123"
echo ""
echo "提示: 浏览器打开会提示'证书不安全'"
echo "  Chrome: 点'高级'→'继续前往 47.107.173.200'"
echo "  Firefox: 点'高级'→'接受风险并继续'"
echo "========================================="
