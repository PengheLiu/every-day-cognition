/** 认知的 7 个维度 */
export type DimensionKey =
  | "concept"      // 概念定义
  | "mechanism"    // 原理机制
  | "history"      // 历史脉络
  | "ecosystem"    // 生态格局
  | "application"  // 实践应用
  | "trend"        // 趋势展望
  | "controversy"; // 争议边界

export const DIMENSION_META: Record<DimensionKey, { icon: string; label: string; description: string }> = {
  concept:     { icon: "book-open",   label: "概念定义", description: "它是什么" },
  mechanism:   { icon: "cog",         label: "原理机制", description: "它怎么运作" },
  history:     { icon: "clock",       label: "历史脉络", description: "它怎么来的" },
  ecosystem:   { icon: "network",     label: "生态格局", description: "谁在玩、什么关系" },
  application: { icon: "zap",         label: "实践应用", description: "现实中怎么用" },
  trend:       { icon: "trending-up", label: "趋势展望", description: "往哪走" },
  controversy: { icon: "alert-circle",label: "争议边界", description: "什么有争议" },
};

/** 大佬观点引用 */
export interface ExpertQuote {
  personName: string;
  personTitle: string;   // e.g. "ThoughtWorks 首席科学家"
  quote: string;         // 原话或核心观点
  sourceType: string;    // 博客/播客/X/知乎/演讲/论文/采访
  sourceUrl?: string;    // 原始链接
  sourceDate?: string;   // e.g. "2015.03"
  aiInterpretation?: string; // AI 解读
}

/** 搜索到的专家信息 */
export interface ExpertInfo {
  name: string;
  englishName?: string;
  title: string;    // 职位/头衔
  org: string;      // 所属机构（中文或原文）
  englishOrg?: string; // 英文机构名（用于 Scholar/Wikipedia 等国际检索）
  reason: string;   // 为什么是这个领域的关键人物
}

/** 专家详细介绍（点击专家弹出抽屉时用） */
export interface ExpertDetail {
  name: string;
  englishName?: string;
  currentTitle: string;      // 当前头衔+所在机构
  biography: string;         // 生平简介（200-300 字）
  currentStatus: string;     // 现状（最近在做什么）
  companyInfo?: string;      // 所在公司/机构背景
  notableWorks: string[];    // 代表作/成就（书籍/论文/公司/产品）
  recentUpdates: Array<{     // 近期动态
    title: string;
    summary: string;
    sourceUrl?: string;
    date?: string;
  }>;
  links?: Array<{            // 推荐阅读/关注
    label: string;
    url: string;
  }>;
  /** 如果搜索结果中的人与期望身份不匹配（如同名不同人），在此说明；否则留空 */
  disambiguation?: string;
  /** 专家的 Google Scholar 个人主页 URL（如 https://scholar.google.com/citations?user=XXX）；没找到则留空 */
  scholarProfileUrl?: string;
}

/** 一个维度的内容 */
export interface DimensionContent {
  key: DimensionKey;
  summary: string;          // 摘要 (2-3 句话)
  detail: string;           // 展开后的详细内容
  expertQuotes: ExpertQuote[];
  imageUrl?: string;        // AI 生成的维度插图（base64 data URL）
}

/** 术语表条目 */
export interface GlossaryItem {
  term: string;
  definition: string;
}

/** 对话锦囊 */
export interface DialogueTip {
  scenario: string;   // e.g. "和技术人员聊时可以问"
  questions: string[];
}

/** 完整的认知简报 */
export interface Briefing {
  topic: string;
  oneLiner: string;          // 一句话速览
  dimensions: DimensionContent[];
  glossary: GlossaryItem[];
  dialogueTips: DialogueTip[];
  experts: ExpertInfo[];     // 识别出的专家列表
  heroImageUrl?: string;     // 主图（base64 data URL）
}

/** 搜索阶段的进度事件 */
export interface SearchProgressEvent {
  type: "identifying_experts" | "searching_expert" | "extracting_quotes" | "done";
  message: string;
  expert?: ExpertInfo;
  quotesFound?: number;
}

/** 搜索结果（传给 briefing 生成用） */
export interface SearchResult {
  experts: ExpertInfo[];
  quotes: ExpertQuote[];
}

/** 追问对话消息 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
