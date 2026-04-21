#!/usr/bin/env bash
#
# 认知学习 — 一键启动脚本
# 用法:
#   ./scripts/start.sh               # 生产模式（默认）：install → build → start
#   ./scripts/start.sh dev           # 开发模式：install → next dev
#   MODE=dev ./scripts/start.sh      # 同上（env 方式）
#   PORT=8080 ./scripts/start.sh     # 自定义端口
#
# 前置要求:
#   - Node.js ≥ 20 (推荐 22+)
#   - 可联网（安装依赖、LLM/搜索 API 调用）
#   - web/.env.local 或 web/.env 中包含必需 API key（见 web/.env.example）
#
set -euo pipefail

# ---------- path setup ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

# ---------- args / env ----------
MODE="${1:-${MODE:-production}}"
PORT="${PORT:-3000}"
# NOTE: don't use $HOSTNAME — Linux/macOS set it to the machine's hostname,
# which fails getaddrinfo. Use $HOST (our var) and export HOSTNAME explicitly.
HOST="${HOST:-0.0.0.0}"
export PORT
export HOSTNAME="$HOST"
export NODE_ENV="${NODE_ENV:-production}"

# Dev mode overrides NODE_ENV
if [[ "$MODE" == "dev" || "$MODE" == "development" ]]; then
  MODE="dev"
  export NODE_ENV="development"
fi

# ---------- pretty output ----------
log()  { printf "\033[1;36m[start.sh]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[start.sh]\033[0m %s\n" "$*" >&2; }
err()  { printf "\033[1;31m[start.sh]\033[0m %s\n" "$*" >&2; }

# ---------- checks ----------
command -v node >/dev/null 2>&1 || { err "Node.js 未安装 — 请先装 Node.js ≥ 20"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node.js 版本过低 ($NODE_MAJOR.x)，需要 ≥ 20"
  exit 1
fi
log "Node.js $(node -v) · npm $(npm -v)"

if [[ ! -d "$WEB_DIR" ]]; then
  err "$WEB_DIR 不存在"
  exit 1
fi

cd "$WEB_DIR"

# ---------- env file check ----------
if [[ ! -f ".env.local" && ! -f ".env" ]]; then
  warn "未找到 .env.local 或 .env —— 拷贝 .env.example 作为起点"
  if [[ -f ".env.example" ]]; then
    cp .env.example .env.local
    warn "已生成 .env.local，但里面的 API key 需要你手动填充后重启"
  fi
fi

# ---------- install deps ----------
if [[ ! -d "node_modules" || "package.json" -nt "node_modules/.package-lock.json" ]]; then
  log "安装依赖 (npm ci)..."
  if [[ -f "package-lock.json" ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
else
  log "依赖已最新，跳过 npm install"
fi

# ---------- make sure data dir exists (SQLite needs it) ----------
mkdir -p data

# ---------- start ----------
if [[ "$MODE" == "dev" ]]; then
  log "🚀 启动开发服务器 (next dev) on http://$HOST:$PORT"
  exec npx next dev -H "$HOST" -p "$PORT"
fi

# Production: build if needed, then start
if [[ ! -f ".next/BUILD_ID" || "src" -nt ".next/BUILD_ID" ]]; then
  log "构建生产产物 (next build)..."
  npx next build
else
  log "构建产物已最新，跳过 next build"
fi

# Prefer standalone server if present (smaller footprint, no need for next CLI)
if [[ -f ".next/standalone/server.js" ]]; then
  # Copy public/ and .next/static into standalone (required for asset serving)
  if [[ ! -d ".next/standalone/public" ]]; then
    cp -r public .next/standalone/
  fi
  if [[ ! -d ".next/standalone/.next/static" ]]; then
    mkdir -p .next/standalone/.next
    cp -r .next/static .next/standalone/.next/
  fi
  log "🚀 启动 standalone 服务 on http://$HOST:$PORT"
  cd .next/standalone
  exec node server.js
fi

# Fallback: plain next start
log "🚀 启动生产服务 (next start) on http://$HOST:$PORT"
exec npx next start -H "$HOST" -p "$PORT"
