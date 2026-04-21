# 认知学习 · Cognitive Learning

> 几分钟内建立结构化认知框架，让你能和任何领域的人自信对话。

基于**真实大佬观点**的认知学习 Web 应用：输入任意主题 → 实时搜索该领域真实存在的专家 → 提取他们的公开言论 → 生成 7 维度结构化简报（含专家引用卡片、个人 Google Scholar 链接）。

## 核心特性

- **搜索驱动的专家识别**：从真实搜索结果中提取该领域关键人物（创始人 / 学者 / 意见领袖），对每位候选做独立验证搜索，剔除 LLM 幻觉
- **7 维度认知框架**：概念定义 / 原理机制 / 历史脉络 / 生态格局 / 实践应用 / 趋势展望 / 争议边界
- **可信引用**：每条专家观点都标注人名、身份、原话、来源类型（博客/播客/演讲等）、时间、原文链接
- **专家个人详情**：点击专家 → 抽屉展示生平 / 现状 / 代表作 / 近期动态 / **Google Scholar 个人主页**
- **1 天简报缓存 + 7 天专家缓存**：重复访问同一主题秒开
- **AI 生成插图**：主题主图 + 7 个维度分镜图（Gemini Flash Image）
- **PWA**：支持"添加到主屏幕"，离线首页可用
- **手机号登录**：开发环境固定验证码 `123456`，上线时可切换真实 SMS

## 技术栈

- **前端**：Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- **后端**：Next.js API Routes
- **数据库**：SQLite (better-sqlite3)
- **LLM**：OpenRouter（默认 Claude Sonnet 4.5），可替换任意 OpenAI 兼容接口
- **图像**：Gemini 2.5 Flash Image（经 OpenRouter）
- **搜索**：Friday 通用搜索（Meituan 内网）— 中文走 `baidu-search-v2`、国际内容走 `bing`
- **认证**：Session cookie（JWT），手机号+验证码

## 目录结构

```
.
├── web/                    # Next.js 应用主体
│   ├── src/
│   │   ├── app/            # 页面和 API 路由
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
└── task.md                 # 最初的产品需求描述
```

## 本地开发

```bash
cd web
cp .env.example .env.local
# 编辑 .env.local 填入你的 LLM_API_KEY / FRIDAY_API_KEY

npm install
npm run dev
# 打开 http://localhost:3000
```

默认开发环境下：
- 登录时任意手机号 + 验证码 `123456` 即可
- SQLite 文件自动建在 `web/data/app.db`
- 刷新浏览器即可加载最新代码（Turbopack HMR）

## 关键架构决策

- **幻觉防护**：专家识别分 3 个阶段（领域搜索 → LLM 提取 → 独立验证）。无法通过验证的专家直接剔除，绝不让 LLM 凭空编造人物
- **JSON Repair**：LLM 输出 JSON 被 `max_tokens` 截断或含未转义引号时，容错解析器会回退到最后安全点、提取顶层字段，保证至少展示部分内容
- **Scholar 个人主页**：通过 Bing 搜索 `site:scholar.google.com` 精准获取个人页 URL（如 `citations?user=XXX`），对已知学者命中率 100%
- **搜索结果复用**：Phase A 领域搜索结果被 Phase C 的专家观点提取复用，避免重复调用外部 API

## 部署

### 方式一：一键脚本（裸机 / 任何 Linux 容器内）

```bash
# 生产模式（会 npm ci + next build + 启动 standalone 服务）
./scripts/start.sh

# 开发模式（热更新）
./scripts/start.sh dev

# 自定义端口
PORT=8080 ./scripts/start.sh

# 绑定特定地址
HOST=127.0.0.1 PORT=8080 ./scripts/start.sh
```

要求：Node.js ≥ 20；`web/.env.local` 或 `web/.env` 里填好 API key。

### 方式二：Docker（推荐生产环境）

```bash
# 构建镜像 + 启动（首次）
docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

说明：
- SQLite 数据库自动持久化到宿主机 `./data`
- 环境变量从 `web/.env.local` 或 `web/.env` 读取
- 默认 3000 端口；想改用 `HOST_PORT=8080 docker compose up -d`
- 镜像基于 `node:22-bookworm-slim`，多阶段构建最终镜像约 250MB
- 非 root 用户运行（`nextjs:1001`），含健康检查

### 方式三：原生 npm 命令

```bash
cd web
npm ci
npm run build
npm run start
```

### 注意事项（内网依赖）

当前后端调用 Meituan 内网 Friday 搜索 API（`agi.sankuai.com`）。部署到公网环境前需要：
- 替换搜索源（Tavily / Serper / 自行实现）
- 或者在能访问美团内网的机器（跳板机 / VPN）上部署

## License

Private — internal use only.
