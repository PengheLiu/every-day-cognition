# syntax=docker/dockerfile:1.6

# ============================================================================
# 认知学习 — 容器镜像
# 多阶段构建，最终镜像只含运行时必需文件（Next standalone + better-sqlite3）
#
# 构建:
#   docker build -t cognitive-learning .
#
# 运行（data/ 挂载为持久卷，env 可通过 --env-file 传入）:
#   docker run -d -p 3000:3000 \
#     --env-file web/.env.local \
#     -v $(pwd)/data:/app/data \
#     --name cl cognitive-learning
# ============================================================================

# ---------- Stage 1: deps ----------
# better-sqlite3 需要 python + make + g++ 来编译 native binding
FROM node:22-bookworm-slim AS deps

RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/web

# 只复制 package 描述文件以最大化 docker layer 缓存
COPY web/package.json web/package-lock.json* ./

RUN npm ci --no-audit --no-fund

# ---------- Stage 2: builder ----------
FROM node:22-bookworm-slim AS builder

WORKDIR /app/web

# 复用 deps 阶段的 node_modules
COPY --from=deps /app/web/node_modules ./node_modules
# 复制源码
COPY web/ ./

ENV NEXT_TELEMETRY_DISABLED=1
# 构建时 LLM key 不参与（只在运行时需要）
RUN npx next build

# ---------- Stage 3: runner (production) ----------
FROM node:22-bookworm-slim AS runner

# 安装仅运行时必需的包
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends \
      ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 新建非 root 用户
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone 产物（最小集合 — 含 server.js + 必需的 node_modules）
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
# 静态资源（CSS/JS chunk/_next/static）
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
# public/ 里的 PWA 图标 / manifest / sw.js
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

# 数据目录（SQLite 文件）— 建议通过 -v 挂载持久卷
RUN mkdir -p /app/web/data && chown -R nextjs:nodejs /app/web/data
VOLUME ["/app/web/data"]

USER nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# dumb-init 处理 SIGTERM，保证容器优雅关闭
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
# Next standalone 的 server.js 就在 /app/web/server.js（从 standalone 根目录复制来的）
CMD ["node", "web/server.js"]
