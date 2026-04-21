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

# ---------- Node.js resolution ----------
# Requirement: Node ≥ 20 (Next.js 16 minimum). On modern distros we use the
# system Node. On old systems (CentOS 7 / RHEL 7 with GLIBC 2.17), the
# vanilla Node binary fails with "GLIBC_2.28 not found"; we auto-download
# the official **glibc-217 unofficial build** (statically linked) into
# ~/.local/share/cl-node and add it to PATH.
NODE_VER="v22.12.0"
NODE_CACHE="$HOME/.local/share/cl-node"

needs_legacy_node() {
  # Returns 0 if we need the glibc-217 build (system node missing or too old
  # or hits GLIBC errors).
  if ! command -v node >/dev/null 2>&1; then return 0; fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$major" -lt 20 ]]; then return 0; fi
  # Probe: if running `node -v` spits GLIBC error, we need legacy
  if ! node -v >/dev/null 2>&1; then return 0; fi
  return 1
}

install_legacy_node() {
  local url="https://unofficial-builds.nodejs.org/download/release/${NODE_VER}/node-${NODE_VER}-linux-x64-glibc-217.tar.gz"
  local dest="$NODE_CACHE/node-${NODE_VER}-linux-x64-glibc-217"

  if [[ -x "$dest/bin/node" ]]; then
    log "复用已下载的 glibc-217 Node: $dest"
  else
    warn "检测到老旧 GLIBC 环境（CentOS 7 / RHEL 7），下载兼容 Node ${NODE_VER}..."
    mkdir -p "$NODE_CACHE"
    local tarball="$NODE_CACHE/node.tar.gz"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$url" -o "$tarball" || { err "下载 Node 失败: $url"; exit 1; }
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$url" -O "$tarball" || { err "下载 Node 失败: $url"; exit 1; }
    else
      err "需要 curl 或 wget 来下载 Node"; exit 1
    fi
    tar -xzf "$tarball" -C "$NODE_CACHE"
    rm -f "$tarball"
  fi
  export PATH="$dest/bin:$PATH"
  log "已切换到 glibc-217 兼容 Node: $(node -v)"
}

if needs_legacy_node; then
  install_legacy_node
fi

# Final check
if ! node -v >/dev/null 2>&1; then
  err "Node.js 不可用 — 请手动安装 Node ≥ 20 并重试"
  exit 1
fi
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
# On old distros (CentOS 7), better-sqlite3's prebuilt binary may not match
# the glibc version → it'll try to compile from source, which needs a modern
# C++ toolchain. Warn early so the failure mode is obvious.
if [[ -f "/etc/os-release" ]] && grep -qE 'CentOS Linux 7|Red Hat Enterprise Linux (Server|Client)? *(release)? *7' /etc/os-release 2>/dev/null; then
  if ! command -v g++ >/dev/null 2>&1 || ! g++ -dumpversion 2>/dev/null | awk -F. '{exit ($1>=8) ? 0 : 1}'; then
    warn "CentOS 7 + 老旧 g++ 可能无法编译 better-sqlite3 native 模块。"
    warn "  若安装失败，请运行: sudo yum install -y centos-release-scl && sudo yum install -y devtoolset-11 && scl enable devtoolset-11 bash"
  fi
fi

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
