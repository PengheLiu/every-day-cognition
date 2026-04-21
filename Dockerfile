# syntax=docker/dockerfile:1.6

# ============================================================================
# 认知学习 — 容器镜像
# 使用 Node 22+ 内置 `node:sqlite`（无 native 编译），任何现代 Linux 都能跑
#
# 构建:
#   docker build -t cognitive-learning .
#
# 运行（data/ 挂载为持久卷，env 可通过 --env-file 传入）:
#   docker run -d -p 8000:8000 \
#     --env-file web/.env.local \
#     -v $(pwd)/data:/app/data \
#     --name cl cognitive-learning
# ============================================================================

# ---------- Stage 1: deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
# Include devDependencies — next build needs @tailwindcss/postcss, typescript, etc.
RUN npm ci --include=dev --no-audit --no-fund

# ---------- Stage 2: builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app/web
COPY --from=deps /app/web/node_modules ./node_modules
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# node:sqlite needs --experimental-sqlite in Node 22.x
ENV NODE_OPTIONS="--experimental-sqlite --no-warnings=ExperimentalWarning"
RUN npx next build

# ---------- Stage 3: runner ----------
FROM node:22-bookworm-slim AS runner
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 非 root 运行
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next standalone 产物
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

# SQLite 数据目录
RUN mkdir -p /app/web/data && chown -R nextjs:nodejs /app/web/data
VOLUME ["/app/web/data"]

USER nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8000
ENV HOSTNAME=0.0.0.0
# node:sqlite experimental flag (Node 22.x)
ENV NODE_OPTIONS="--experimental-sqlite --no-warnings=ExperimentalWarning"

EXPOSE 8000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "web/server.js"]
