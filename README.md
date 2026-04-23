# 每天学一个认知 · Cognitive Alignment

> 几分钟建立一个领域的结构化认知框架，让你和任何专业人士都能自信对话。

一个基于 **真实大佬观点** 的认知学习 Web 应用：
输入任意主题 → 实时搜索该领域真实存在的专家 → 提取他们的公开言论 → 生成 **7 维度结构化简报**（含专家引用卡片 + Google Scholar 个人主页链接）。

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 核心特性

- **🔍 搜索驱动的专家识别**：从真实搜索结果中提取该领域关键人物（创始人 / 学者 / 意见领袖），对每位候选做独立验证搜索，剔除 LLM 幻觉
- **🧩 7 维度认知框架**：概念定义 / 原理机制 / 历史脉络 / 生态格局 / 实践应用 / 趋势展望 / 争议边界
- **📎 可信引用**：每条专家观点都标注人名、身份、原话、来源类型（博客 / 播客 / 演讲 / 论文等）、时间、原文链接
- **👤 专家个人详情**：点击专家 → 抽屉展示生平 / 现状 / 代表作 / 近期动态 / **Google Scholar 个人主页**
- **⚡ 缓存加速**：1 天简报缓存 + 7 天专家缓存，重复访问同一主题秒开
- **🎨 AI 生成插图**：主题主图 + 7 个维度分镜图（Gemini 2.5 Flash Image）
- **📱 PWA**：支持「添加到主屏幕」，离线首页可用
- **🔐 轻量登录**：昵称 + 手机号直接登录；每用户单任务限流，避免重复跑

## 技术栈

| 分层 | 选型 |
|---|---|
| 前端 | Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui |
| 后端 | Next.js API Routes |
| 数据库 | SQLite（Node.js 22 内置 `node:sqlite`，零原生依赖） |
| LLM | OpenRouter（默认 Claude Sonnet 4.5 + Haiku 4.5），可替换任意 OpenAI 兼容接口 |
| 图像 | Gemini 2.5 Flash Image（经 OpenRouter） |
| 搜索 | Friday 通用搜索（见下方「搜索源」） |
| 认证 | Session cookie（JWT） |

## 快速开始

```bash
git clone https://github.com/PengheLiu/every-day-cognition.git
cd every-day-cognition/web

# 1. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的 LLM_API_KEY（OpenRouter）+ FRIDAY_API_KEY（或替换搜索源，见下）

# 2. 启动开发服务器
npm install
npm run dev
# 打开 http://localhost:3000
```

**前置要求**：Node.js ≥ 20（推荐 22+，可用内置 `node:sqlite`，无需编译原生模块）

**默认开发体验**：
- 登录时任意昵称 + 手机号即可（无短信验证，开发态快速体验）
- SQLite 文件自动建在 `web/data/app.db`
- Turbopack HMR 刷新页面即可加载最新代码

## 环境变量

所有需要配置的变量见 [`web/.env.example`](web/.env.example)，关键项：

| 变量 | 用途 | 必需 |
|---|---|---|
| `LLM_API_KEY` | OpenAI 兼容 LLM key（推荐 OpenRouter） | ✅ |
| `LLM_API_BASE_URL` | LLM API 地址 | ✅ |
| `LLM_MODEL` | 主模型（默认 `anthropic/claude-sonnet-4.5`） | ✅ |
| `LLM_FAST_MODEL` | 快速模型，用于专家提取 / 维度生成（默认 `anthropic/claude-haiku-4.5`） | ✅ |
| `IMAGE_MODEL` | 图像生成模型（默认 `google/gemini-2.5-flash-image`） | 可选 |
| `FRIDAY_SEARCH_URL` + `FRIDAY_API_KEY` | 搜索服务 | ✅ |
| `CRAWL_API_URL` | 网页抓取（预留，当前未启用） | 可选 |

> **敏感信息绝对不要提交**：`.env`、`.env.local`、`.env.*.local` 都已在 `.gitignore` 白名单里。

## 搜索源（重要）

项目默认调用的 **Friday 通用搜索**（`agi.sankuai.com`）是美团内网服务，外网不可达。想在公网运行，有两条路：

1. **替换成公网搜索 API**：修改 [`web/src/lib/search.ts`](web/src/lib/search.ts)，把 Friday 请求替换成 [Tavily](https://tavily.com) / [Serper](https://serper.dev) / [Brave Search](https://brave.com/search/api/) / [SerpAPI](https://serpapi.com/) 任一家。接口契约：输入 query + 路由（`baidu-search-v2` 走中文、`bing` 走国际），输出 `{title, url, snippet}[]`。
2. **在内网机器部署**：如果你也在美团内部，直接用跳板机 / VPN 里的容器跑。

Python 参考实现（`friday_search.py` / `web_fetch.py`）仅供了解调用方式，web 端实际走的是 `web/src/lib/search.ts`。

## 目录结构

```
.
├── web/                    # Next.js 应用主体（主要代码都在这里）
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/        # /search /briefing /briefing-bundle /expert /chat /auth/* 等
│   │   │   ├── briefing/   # 简报详情页
│   │   │   ├── login/      # 登录页
│   │   │   └── me/         # 我的历史页
│   │   ├── components/     # DimensionCard / ExpertDetailModal / TopBar / UserChip 等
│   │   └── lib/            # db.ts / auth.ts / openrouter.ts / search.ts / prompts.ts / json-repair.ts
│   ├── public/             # 图标 / manifest / service worker
│   └── data/               # SQLite 数据库（gitignored）
├── friday_search.py        # Friday 搜索 API Python 参考实现
├── web_fetch.py            # 网页抓取 API Python 参考实现
├── scripts/start.sh        # 一键启动脚本（支持老版 CentOS / GLIBC 2.17）
├── Dockerfile              # 多阶段生产镜像（node:22-bookworm-slim，~250MB）
└── docker-compose.yml      # docker compose up -d 启动
```

## 关键架构决策

- **幻觉防护**：专家识别分 3 个阶段（领域搜索 → LLM 提取候选 → 独立验证搜索）。无法通过验证的专家直接剔除，绝不让 LLM 凭空编造人物。
- **JSON Repair**：LLM 输出 JSON 被 `max_tokens` 截断或含未转义引号时，容错解析器回退到最后安全点并提取顶层字段，保证至少能展示部分内容，而不是整页白屏。
- **Scholar 个人主页**：通过 Bing 搜索 `site:scholar.google.com "Name"` 精准获取个人页 URL（如 `citations?user=XXX`），对已知学者命中率接近 100%。
- **搜索结果复用**：Phase A 领域搜索结果被 Phase C（专家观点提取）复用，避免重复调用外部 API。
- **单用户任务限流**：同一用户同时只能跑 1 个生成任务，避免刷新 / 多标签把 LLM 配额烧干。

## 部署

### 一键脚本（裸机 / 任何 Linux 容器）

```bash
./scripts/start.sh              # 生产模式：npm ci → next build → standalone server
./scripts/start.sh dev          # 开发模式（热更新）
PORT=8080 ./scripts/start.sh    # 自定义端口
HOST=127.0.0.1 PORT=8080 ./scripts/start.sh  # 绑定特定地址
```

脚本会自动：Node 版本探测 / 老 GLIBC 环境自动下载兼容 Node / 环境文件加载 / 增量构建。

### Docker（推荐生产环境）

```bash
docker compose up -d --build    # 构建 + 启动（首次）
docker compose logs -f          # 查看日志
docker compose down             # 停止
HOST_PORT=9000 docker compose up -d  # 换端口
```

- SQLite 数据库持久化到宿主机 `./data`
- 环境变量从 `web/.env.local` 或 `web/.env` 读取
- 镜像基于 `node:22-bookworm-slim`，多阶段构建终态 ~250MB
- 非 root 用户运行（`nextjs:1001`），自带健康检查

### 原生 npm

```bash
cd web && npm ci && npm run build && npm run start
```

## 贡献

Issue / PR 欢迎。项目尚处早期，接口和数据结构可能还会变动。如果你替换了搜索源做出了公网可运行版本，欢迎 PR 回来分享。

## License

[MIT](./LICENSE) © 2026 Penghe Liu
