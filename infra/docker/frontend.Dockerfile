# =========================================================
# Wyu RAG — Frontend Dockerfile
# Multi-stage: build (Vite) -> runtime (Nginx serving static)
# =========================================================

# ---------- Stage 1: build ----------
FROM node:20-bullseye-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile

COPY frontend ./frontend
WORKDIR /app/frontend
RUN pnpm build

# ---------- Stage 2: runtime (Nginx) ----------
FROM nginx:alpine AS runtime

RUN rm -rf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

RUN printf '%s\n' \
  'server {' \
  '    listen 80;' \
  '    server_name _;' \
  '    root /usr/share/nginx/html;' \
  '    index index.html;' \
  '    client_max_body_size 50M;' \
  '    location / {' \
  '        try_files $uri $uri/ /index.html;' \
  '    }' \
  '    location = /nginx-health { access_log off; return 200 "ok\n"; add_header Content-Type text/plain; }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]
