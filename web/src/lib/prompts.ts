/**
 * System prompts for the cognitive learning engine.
 */

/** Step 0: Queries to find domain-level content — balanced Chinese + English */
export function buildDomainSearchQueries(topic: string): string[] {
  return [
    // Chinese (3 queries)
    `${topic} 创始人 CEO 公司`,
    `${topic} 知名专家 学者 教授`,
    `${topic} 行业 领军人物 代表人物`,
    // English (5 queries — skewed toward English to surface more international experts)
    `${topic} founder CEO startup company`,
    `${topic} leading researcher professor expert`,
    `${topic} pioneers thought leaders`,
    `${topic} Stanford MIT Google DeepMind`,
    `${topic} influential people 2024 2025`,
  ];
}

/** Step 1: Extract real experts from actual search results (grounded, not hallucinated) */
export function buildExpertExtractionPrompt(
  topic: string,
  searchResults: { title: string; snippet: string; content: string; url: string; publishTime: string }[]
): string {
  const resultsText = searchResults
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n时间: ${r.publishTime}\n内容: ${(r.snippet || r.content || "").slice(0, 600)}`)
    .join("\n\n");

  return `你是一个严谨的信息提取系统。以下是关于「${topic}」领域的真实搜索结果，请从中提取在该领域确实被提及的、真实存在的关键人物。

搜索结果：
${resultsText}

硬性规则（违反即失败）：
1. **只能提取搜索结果里明确出现过的人名** —— 不得依靠你的训练知识编造或补充搜索结果之外的人物
2. 提取的每个人物，必须在搜索结果中能看到其姓名 + 身份/职务/机构的描述
3. 每个人物的 title、org、reason 字段必须能从搜索结果的具体片段得到支撑
4. 如果无法从搜索结果中提取任何真实人物，返回空数组 []
5. 不要捏造英文名；如果搜索结果里没有英文名，englishName 字段留空字符串

提取目标：
- 尽量提取 **12-18 位**（多一点更有代表性；后续会自动验证和剔除站不住的候选）
- 覆盖不同角色（创始人/CEO、学者/教授、研究员、意见领袖、畅销书作者、资深从业者）
- **中外兼顾**：必须同时包含**国外专家**（例如该领域的国际权威、美欧知名公司创始人、海外顶尖大学教授）和**中国专家**（国内公司创始人、高校学者、产业推动者）
- **国外专家至少占 40%**（如果搜索结果里有相关信息）
- 英文人名请保持英文，不要翻译成中文（例如 "Geoffrey Hinton" 不要写成 "辛顿"）
- 按搜索结果中被提及的影响力排序

输出格式：必须是合法的 JSON 数组，首字符是 \`[\`。不要 markdown 围栏，不要 JSON 外的文字。

输出结构：
[
  {
    "name": "中文名（从搜索结果里取得的）",
    "englishName": "如果搜索结果里有，否则空字符串",
    "title": "具体职务（如 创始人兼CEO / 教授 / 首席科学家）",
    "org": "所属机构（中文或原文，如 清华大学 / OpenAI）",
    "englishOrg": "机构的**英文名**（如 Tsinghua University / OpenAI / Stanford / DeepMind）。如果 org 本来就是英文就复制过来；如果搜索结果能推断则给出；否则留空",
    "reason": "一句话说明为什么在该领域重要（基于搜索结果，不要虚构）",
    "evidenceQuote": "搜索结果中支撑此人身份的一句原文片段（≤80字）"
  }
]

立即输出 JSON 数组，首字符必须是 \`[\`。`;
}

/** (legacy, no longer used directly — kept for backward compatibility) */
export function buildExpertIdentificationPrompt(topic: string): string {
  return `请列举「${topic}」领域真实存在的关键人物（创始人、学者、意见领袖等），返回 JSON 数组。`;
}

/** Step 2: Generate search queries for an expert */
export function buildSearchQueries(
  topic: string,
  expertName: string,
  expertEnglishName?: string
): string[] {
  // Keep queries simple — name + topic gets the best recall. Adding restrictive
  // keywords like "观点" or "opinion" drops search results dramatically.
  const queries: string[] = [`${expertName} ${topic}`];

  if (expertEnglishName && expertEnglishName !== expertName) {
    queries.push(`${expertEnglishName} ${topic}`);
  }

  return queries;
}

/** Step 3: Extract structured quotes from search results */
export function buildQuoteExtractionPrompt(
  topic: string,
  expertName: string,
  expertTitle: string,
  searchResults: { title: string; snippet: string; content: string; url: string; publishTime: string }[]
): string {
  const resultsText = searchResults
    .map((r, i) => `[${i + 1}] 标题: ${r.title}\nURL: ${r.url}\n发布时间: ${r.publishTime}\n内容: ${r.snippet || r.content}`)
    .join("\n\n");

  return `你是一个信息提取专家。以下是关于「${expertName}」(${expertTitle}) 在「${topic}」领域的搜索结果。

请从中提取该人物关于「${topic}」的核心观点。

要求：
1. 只提取有明确出处的真实观点，绝不编造或推测
2. 优先提取直接引语（原话）
3. 如果没有直接引语，可以准确概括其核心观点
4. 每条观点标注来源类型（博客/播客/演讲/采访/论文/社交媒体/新闻报道）
5. 标注时间（精确到年月，格式如 2024.03）
6. 标注原始 URL
7. 最多提取 3 条最有价值的观点
8. 判断每条观点最适合放在哪个认知维度：concept(概念定义)、mechanism(原理机制)、history(历史脉络)、ecosystem(生态格局)、application(实践应用)、trend(趋势展望)、controversy(争议边界)

搜索结果：
${resultsText}

请严格按以下 JSON 格式返回，不要输出任何其他内容。如果搜索结果中没有找到有价值的观点，返回空数组 []：
[
  {
    "quote": "引用的原话或准确概括的观点",
    "sourceType": "来源类型",
    "sourceUrl": "原始URL",
    "sourceDate": "2024.03",
    "dimension": "concept",
    "aiInterpretation": "用通俗语言解释这个观点的含义和重要性（1-2句话）"
  }
]`;
}

/** Step 4: Generate the full structured briefing */
export function buildBriefingPrompt(
  topic: string,
  expertsWithQuotes: {
    expert: { name: string; title: string; org: string };
    quotes: {
      quote: string;
      sourceType: string;
      sourceUrl?: string;
      sourceDate?: string;
      dimension: string;
      aiInterpretation?: string;
    }[];
  }[]
): string {
  const quotesContext = expertsWithQuotes
    .map((eq) => {
      const quotesText = eq.quotes
        .map((q) => `  - [${q.dimension}] "${q.quote}" (${q.sourceType}, ${q.sourceDate || "时间不详"}, ${q.sourceUrl || "无链接"})`)
        .join("\n");
      return `${eq.expert.name} (${eq.expert.title}, ${eq.expert.org}):\n${quotesText || "  (未找到相关观点)"}`;
    })
    .join("\n\n");

  return `你是一个顶级的认知学习专家。用户想快速了解「${topic}」这个领域，目标是在几分钟内建立结构化认知框架，达到"能和该领域的人自信对话"的水平（L3 水平）。

以下是我们搜索到的该领域大佬的真实观点（这些观点有真实出处，请务必充分使用）：

${quotesContext}

请基于以上真实观点 + 你的知识，生成一份结构化认知简报。

内容要求：
1. 开头给出"一句话速览"：用一句话（不超过 40 字）概括这个领域的本质
2. **必须完整输出全部 7 个维度**，顺序固定为：concept → mechanism → history → ecosystem → application → trend → controversy。每个维度包含：
   - summary: 2-3 句话的核心摘要（每句 ≤30 字）
   - detail: 1-2 段展开说明，**控制在 150-250 字之内**（不是越长越好）
   - expertQuotes: 1-2 条相关的大佬观点（从上面提供的真实观点中挑选最相关的，完整填入 personName/personTitle/quote/sourceType/sourceUrl/sourceDate/aiInterpretation）
3. 提供关键术语表（8-12 个专业术语），每个术语用一句话（≤40 字）解释
4. 提供对话锦囊（2-3 个典型对话场景，每个场景推荐 3 个可以问的好问题）

**长度预算控制**：
- 每个 dimension 的 summary + detail 合计约 200-350 字（过长会耗尽 tokens 导致后续维度无法输出）
- 所有 dimensions 加起来约 1500-2500 字
- 宁可 detail 精炼，也要保证 7 个维度都输出齐全

质量准则：
- 通俗易懂，避免堆砌术语，多用类比
- 像一个耐心的高手在给你讲解，不装腔作势
- 优先使用真实大佬的原话，不要编造引用
- 重点是帮用户"听懂别人在说什么"+ "知道该问什么"
- 每个维度的大佬引用必须来自上面提供的真实观点，不要虚构人物和引用

⚠️ 输出格式硬性规则（违反即无效）：
- 整个回复必须是**一个合法的 JSON 对象**，从 \`{\` 开始，到 \`}\` 结束
- 不要输出任何 markdown 代码围栏（不要 \`\`\`json 也不要 \`\`\`）
- 不要在 JSON 前后添加任何解释性文字、前言、后记
- 所有字符串值中的英文双引号必须用 \\" 转义；中文使用"曲引号"或「书名号」
- 字符串值不要包含换行符，需要换段落用 \\n
- 输出前检查一遍：整体是否能被 JSON.parse 成功

输出 JSON 结构：
{
  "topic": "主题",
  "oneLiner": "一句话速览",
  "dimensions": [
    {
      "key": "concept|mechanism|history|ecosystem|application|trend|controversy",
      "summary": "...",
      "detail": "...",
      "expertQuotes": [
        {
          "personName": "...",
          "personTitle": "...",
          "quote": "...",
          "sourceType": "博客|播客|演讲|采访|论文|新闻|社交媒体",
          "sourceUrl": "...",
          "sourceDate": "YYYY.MM",
          "aiInterpretation": "..."
        }
      ]
    }
  ],
  "glossary": [{"term": "...", "definition": "..."}],
  "dialogueTips": [{"scenario": "...", "questions": ["...", "...", "..."]}]
}

立即开始输出 JSON，第一个字符必须是 \`{\`。`;
}

/** Build search queries to gather info about a specific expert with topic context. */
export function buildExpertDetailQueries(
  expertName: string,
  expertEnglishName: string | undefined,
  org: string | undefined,
  topic: string
): string[] {
  const queries: string[] = [];

  // Primary: bind name + topic + org to disambiguate same-name people
  if (org && org !== "未知") {
    queries.push(`${expertName} ${org}`);
    queries.push(`${expertName} ${org} ${topic}`);
  } else {
    queries.push(`${expertName} ${topic}`);
  }

  // Role-specific
  queries.push(`${expertName} ${topic} 创始人 CEO 创立`);
  queries.push(`${expertName} ${topic} 近况 动态 最新`);

  // English alias if any
  if (expertEnglishName) {
    if (org && org !== "未知") {
      queries.push(`${expertEnglishName} ${org}`);
    } else {
      queries.push(`${expertEnglishName} ${topic}`);
    }
    queries.push(`${expertEnglishName} ${topic} latest news`);
  }

  // (Scholar profile lookup is done separately via findScholarProfileUrl with Bing + site:scholar.google.com)

  return queries;
}

/**
 * Extract the first Google Scholar profile URL (citations?user=XXX) from a batch of search results.
 * Returns null if no profile URL found.
 */
export function extractScholarProfileUrl(
  searchResults: { url?: string; title?: string; snippet?: string; content?: string }[]
): string | null {
  // Match: scholar.google.{com,com.hk,cn,de,...}/citations?...user=XXXX
  const pattern = /https?:\/\/scholar\.google\.[a-z.]+\/citations\?[^"'\s<>)]*user=[A-Za-z0-9_-]+/gi;

  for (const r of searchResults) {
    // URL itself first
    if (r.url) {
      const m = r.url.match(pattern);
      if (m) return normalizeScholarUrl(m[0]);
    }
    // Then title/snippet/content
    const text = `${r.title || ""}\n${r.snippet || ""}\n${r.content || ""}`;
    const m = text.match(pattern);
    if (m) return normalizeScholarUrl(m[0]);
  }
  return null;
}

function normalizeScholarUrl(url: string): string {
  // Strip tracking params, keep only user=... (and hl if present)
  try {
    const u = new URL(url);
    const user = u.searchParams.get("user");
    if (!user) return url;
    // Canonical form
    return `https://scholar.google.com/citations?user=${user}&hl=en`;
  } catch {
    return url;
  }
}

/** Prompt to extract structured expert detail from search results with strict identity binding. */
export function buildExpertDetailPrompt(
  expertName: string,
  expertTitle: string,
  expertOrg: string,
  topic: string,
  searchResults: { title: string; snippet: string; content: string; url: string; publishTime: string }[]
): string {
  const resultsText = searchResults
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n时间: ${r.publishTime}\n内容: ${(r.snippet || r.content || "").slice(0, 800)}`)
    .join("\n\n");

  const orgText = expertOrg && expertOrg !== "未知" ? `，所在机构「${expertOrg}」` : "";

  return `你是一个严谨的人物简介编辑。目标：为「${expertName}」（身份：${expertTitle}${orgText}，在「${topic}」领域）生成一份结构化的人物介绍。

⚠️ 关键身份约束（同名消歧）：
- 目标人物的身份是：**${expertName}，${expertTitle}${orgText}，活跃于「${topic}」领域**
- 搜索结果中可能包含**同名的其他人物**（例如同名的其他行业知名人士），这些人的信息**一律不要采用**
- 只采用**明确匹配上述身份**的搜索结果：内容中必须能关联到「${topic}」领域${expertOrg && expertOrg !== "未知" ? `或机构「${expertOrg}」` : ""}或 ${expertTitle} 这个角色
- 如果搜索结果里的信息无法确定是否为目标人物，或明显是另一个同名人物，**宁可留空，也不要混用**

搜索结果（可能含同名干扰）：
${resultsText}

输出要求：
1. biography: 该人物的生平介绍（150-250 字），仅基于与目标身份匹配的资料
2. currentStatus: 该人物目前在「${topic}」领域在做什么（2-3 句）
3. companyInfo: 该人物所在机构「${expertOrg}」的简介（100-150 字）
4. notableWorks: 3-6 项与目标身份匹配的代表作/成就
5. recentUpdates: 2-4 条与目标身份匹配的近期公开动态（含 title / summary / sourceUrl / date）
6. links: 2-4 个推荐阅读链接
7. disambiguation: 如果搜索结果中**大部分信息都是同名的其他人物**，没有与目标身份匹配的内容：
   - 上述 biography / currentStatus / companyInfo / notableWorks / recentUpdates 字段**全部留空**（空字符串或空数组）
   - 在 disambiguation 字段用一句话说明：比如"搜索结果中未找到与${expertTitle}${orgText}身份匹配的公开信息"
   - 如果信息完整匹配，disambiguation 留空字符串

硬性输出规则：
- 整个回复必须是**一个合法的 JSON 对象**，从 \`{\` 开始到 \`}\` 结束
- 不要输出 markdown 围栏，不要任何 JSON 外的解释文字
- 字符串内的英文双引号用 \\" 转义；字符串值不要含换行符
- 不要编造信息，宁缺毋滥

输出 JSON 结构：
{
  "name": "${expertName}",
  "currentTitle": "...",
  "biography": "...",
  "currentStatus": "...",
  "companyInfo": "...",
  "notableWorks": ["...", "...", "..."],
  "recentUpdates": [
    {"title": "...", "summary": "...", "sourceUrl": "...", "date": "2024.03"}
  ],
  "links": [{"label": "...", "url": "..."}],
  "disambiguation": ""
}

立即输出 JSON，首字符必须是 \`{\`。`;
}

/**
 * Prompt for generating just the briefing's "meta" fields:
 * oneLiner + glossary + dialogueTips. Lightweight (~2-3k tokens output).
 * Use with the dimension prompts in parallel for fast briefing assembly.
 */
export function buildBriefingMetaPrompt(
  topic: string,
  expertsWithQuotes: {
    expert: { name: string; title: string; org: string };
    quotes: { quote: string; sourceType: string; sourceDate?: string; dimension: string }[];
  }[]
): string {
  const quotesContext = expertsWithQuotes
    .map((eq) => {
      const qs = eq.quotes
        .slice(0, 3)
        .map((q) => `  - "${q.quote.slice(0, 120)}" (${q.sourceType})`)
        .join("\n");
      return `${eq.expert.name} (${eq.expert.title}):\n${qs || "  (暂无观点)"}`;
    })
    .join("\n\n");

  return `基于该领域真实大佬的观点，为「${topic}」生成认知简报的**整体概览**部分（不含 7 维度详情）。

大佬观点样本（仅供上下文参考，不需要直接引用）：
${quotesContext}

你只需生成 3 个字段：

1. **oneLiner**: 一句话速览（不超过 40 字），直击「${topic}」的本质
2. **glossary**: 8-12 个关键术语，每条含 term + definition（≤40 字，通俗解释）
3. **dialogueTips**: 2-3 个典型对话场景，每个场景包含 scenario（一句话描述）和 questions（3 个可以问的好问题）

硬性规则：
- 整个回复必须是**合法 JSON**，从 \`{\` 开始到 \`}\` 结束
- 不要 markdown 围栏、不要多余文字
- 字符串内英文引号用 \\" 转义，不要换行符

输出结构：
{
  "oneLiner": "...",
  "glossary": [{ "term": "...", "definition": "..." }],
  "dialogueTips": [
    { "scenario": "...", "questions": ["...", "...", "..."] }
  ]
}

立即输出 JSON，首字符必须是 \`{\`。`;
}

/** Prompt to fill in a single missing dimension (used when first-pass briefing truncates). */
export function buildSingleDimensionPrompt(
  topic: string,
  dimensionKey: string,
  dimensionLabel: string,
  existingOneLiner: string,
  availableQuotes: {
    personName: string;
    personTitle: string;
    quote: string;
    sourceType: string;
    sourceUrl?: string;
    sourceDate?: string;
    aiInterpretation?: string;
    dimension: string;
  }[]
): string {
  const relevantQuotes = availableQuotes
    .filter((q) => q.dimension === dimensionKey)
    .slice(0, 3);
  const quoteCtx = relevantQuotes.length
    ? relevantQuotes.map((q) => `- ${q.personName} (${q.personTitle}): "${q.quote}" [${q.sourceType} ${q.sourceDate || ""}]`).join("\n")
    : "（该维度暂无相关的大佬观点搜索结果）";

  return `为「${topic}」领域生成**单个维度**「${dimensionLabel}」（key="${dimensionKey}"）的简报片段。

已有上下文：
- 一句话速览：${existingOneLiner}
- 与本维度相关的大佬观点：
${quoteCtx}

输出规则：
- summary：2-3 句话（每句 ≤30 字）
- detail：1-2 段，控制在 150-250 字
- expertQuotes：如有相关大佬观点，挑 1-2 条完整引用（含 sourceUrl / sourceDate / aiInterpretation）
- 整个回复必须是**一个合法 JSON 对象**，从 \`{\` 开始到 \`}\` 结束
- 不要输出 markdown 围栏，不要 JSON 外的文字
- 字符串里的英文双引号用 \\" 转义

输出 JSON 结构：
{
  "key": "${dimensionKey}",
  "summary": "...",
  "detail": "...",
  "expertQuotes": [
    {
      "personName": "...",
      "personTitle": "...",
      "quote": "...",
      "sourceType": "...",
      "sourceUrl": "...",
      "sourceDate": "...",
      "aiInterpretation": "..."
    }
  ]
}

立即输出 JSON，首字符必须是 \`{\`。`;
}

/** Follow-up chat system prompt */
export function buildChatSystemPrompt(topic: string, briefingJson: string): string {
  return `你是「${topic}」领域的认知教练。用户刚阅读了一份关于这个领域的认知简报，现在想深入了解某些方面。

简报内容摘要：
${briefingJson}

你的角色：
- 耐心解答用户的追问，语言通俗易懂
- 如果用户问到简报中提到的大佬观点，进一步展开解释
- 用类比和例子帮助理解
- 如果你不确定某个信息，诚实说明
- 保持回答简洁，每次回答控制在 3-5 段以内
- 使用中文回答`;
}
