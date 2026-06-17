# =========================================================
# Wyu RAG — Backend Dockerfile (2-stage)
# builder: compile NestJS + generate Prisma client
# runtime: slim production image with libssl1.1 compat
# =========================================================

FROM node:20-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile

COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
RUN pnpm prisma generate
RUN pnpm build

# ---------- runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app

# libssl1.1 needed by Prisma engine (Bookworm ships OpenSSL 3.x only)
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init openssl curl ca-certificates \
    && echo "deb http://deb.debian.org/debian bullseye main" > /etc/apt/sources.list.d/bullseye.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libssl1.1 \
    && rm /etc/apt/sources.list.d/bullseye.list \
    && apt-get update \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/src/modules/rag/prompts ./backend/dist/src/modules/rag/prompts
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/package.json ./backend/package.json

WORKDIR /app/backend

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -sf http://localhost:3000/api/v1/health/live || exit 1

CMD ["dumb-init", "node", "dist/src/main.js"]
