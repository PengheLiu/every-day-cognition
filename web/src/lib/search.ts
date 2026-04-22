/**
 * Search service — uses Friday universal search API (Baidu + Bing backends)
 * and web crawl API for fetching full page content.
 */

import { chatCompletion, FAST_MODEL } from "./openrouter";

const FRIDAY_SEARCH_URL = process.env.FRIDAY_SEARCH_URL || "http://agi.sankuai.com/tools/universal-search/api/v1";
const FRIDAY_API_KEY = process.env.FRIDAY_API_KEY || "";
const CRAWL_API_URL = process.env.CRAWL_API_URL || "http://agi.sankuai.com/sa/web_browse/crawl_and_parse";

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
  content: string;
  source: string;
  publishTime: string;
}

/**
 * Search using Friday universal search API.
 * - `baidu-search-v2`: best for Chinese-language content
 * - `bing`: best for English content, international sites, and anything blocked
 *   by the GFW (e.g. scholar.google.com, twitter.com)
 */
export async function fridaySearch(
  query: string,
  options: {
    topK?: number;
    sources?: string[];
    timeout?: number;
    /** Restrict search to specific domains (Bing only: filed as site: filter) */
    siteRestrictions?: string[];
  } = {}
): Promise<SearchResultItem[]> {
  const { topK = 10, sources = ["baidu-search-v2"], timeout = 10, siteRestrictions } = options;

  const body: Record<string, unknown> = {
    query,
    sources,
    topK,
    isFast: true,
    timeout,
    ttl: 0,
  };
  if (siteRestrictions && siteRestrictions.length > 0) {
    body.bingSearchParam = { sites: siteRestrictions };
  }

  try {
    const res = await fetch(FRIDAY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FRIDAY_API_KEY}`,
        "Content-Type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((timeout + 5) * 1000),
    });

    if (!res.ok) {
      console.error(`Friday search error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const results = data?.data?.results ?? [];

    return results.map((item: Record<string, string>) => ({
      url: item.url || "",
      title: item.title || "",
      snippet: item.snippet || "",
      content: item.content || "",
      source: item.source || "",
      publishTime: item.publish_time || "",
    }));
  } catch (err) {
    console.error("Friday search failed:", err);
    return [];
  }
}

/**
 * Crawl and parse web pages to get full text content.
 */
export async function crawlPages(
  urls: string[],
  timeoutMs = 20000
): Promise<{ url: string; title: string; text: string }[]> {
  try {
    const res = await fetch(CRAWL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Basic auth: beam:mima_for_beam
      body: JSON.stringify({
        urls,
        timeout_in_ms: timeoutMs,
        noProxy: false,
      }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });

    if (!res.ok) return [];

    const data = await res.json();
    return (data?.data ?? [])
      .filter((item: Record<string, string>) => !item.error_status)
      .map((item: Record<string, string>) => ({
        url: item.url || "",
        title: item.title || "",
        text: (item.text || "").slice(0, 3000), // limit text length
      }));
  } catch (err) {
    console.error("Crawl failed:", err);
    return [];
  }
}


const SCHOLAR_USER_PATTERN =
  /https?:\/\/scholar\.google\.[a-z.]+\/citations\?[^"'\s<>)]*user=([A-Za-z0-9_-]+)/i;

function stripChinese(s: string): string {
  return s.replace(/[一-龥]/g, " ").replace(/\s+/g, " ").trim();
}

function extractFirstUserId(results: SearchResultItem[]): string | null {
  for (const r of results) {
    const text = `${r.url} ${r.title} ${r.snippet} ${r.content}`;
    const m = text.match(SCHOLAR_USER_PATTERN);
    if (m) return m[1];
  }
  return null;
}

const HAN_RE = /[一-龥]/;

/**
 * In-process cache of Chinese-name → academic English spelling.
 * Transliteration is deterministic per person, so once resolved we never
 * need to re-ask the LLM during the same process lifetime.
 */
const enNameCache = new Map<string, string>();

/**
 * Ask the fast LLM for the canonical English spelling a Chinese scholar uses
 * when publishing (e.g., 何恺明 → "Kaiming He", 孙剑 → "Jian Sun"). We keep
 * this narrowly scoped to transliteration — not identity invention — and
 * bias the model toward "return empty string if unsure" to avoid hallucinated
 * names for obscure people.
 */
async function inferAcademicEnglishName(
  chineseName: string,
  topic?: string,
  org?: string
): Promise<string | null> {
  const cacheKey = `${chineseName}||${topic || ""}||${org || ""}`;
  const cached = enNameCache.get(cacheKey);
  if (cached !== undefined) return cached || null;

  const ctx = [
    topic ? `研究领域：${topic}` : "",
    org && org !== "未知" ? `所在机构：${org}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `以下是一位华人学者/研究员的中文姓名。请给出他/她在英文学术论文（Google Scholar / arXiv / ACM / IEEE / CVPR 等）上署名时使用的**惯用英文拼写**。

${ctx}
中文名：${chineseName}

硬性规则：
- 只输出英文拼写本身，例如 "Kaiming He" / "Jian Sun" / "Fei-Fei Li"，不要引号、不要解释、不要任何其他字符
- 使用该学者实际在论文中使用的拼法和大小写（通常是西方惯例：名在前、姓在后，名的多音节合并成一个词）
- **如果你不能确定此人的惯用学术英文拼写，只输出一个空字符串**（不要猜测）`;

  try {
    const resp = await chatCompletion(
      [{ role: "user", content: prompt }],
      { temperature: 0, maxTokens: 40, model: FAST_MODEL }
    );
    const cleaned = resp.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    // Validate: pure Latin, reasonable length, no sentence punctuation
    const ok =
      cleaned.length >= 3 &&
      cleaned.length <= 60 &&
      !HAN_RE.test(cleaned) &&
      /^[A-Za-z][A-Za-z\s.\-']*$/.test(cleaned);
    const result = ok ? cleaned : "";
    enNameCache.set(cacheKey, result);
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Find an expert's Google Scholar profile URL.
 *
 * Runs all candidate tiers (queries) in **parallel** for latency — typical
 * time drops from ~2-8s (sequential worst case) to ~2-3s (one round trip).
 *
 * Tiers (all use Latin-spelled name — Scholar's index is overwhelmingly Latin,
 * so `"Kaiming He"` massively outperforms `"何恺明"`):
 *   T1: Bing + site:scholar.google.com + `{latinName} {latinOrg}`
 *   T2: Bing + site:scholar.google.com + `{latinName}`
 *   T3: Bing + `{latinName} Google Scholar citations` (no site restrict)
 *   T4: Bing + site:scholar.google.com + `{latinName} {latinTopic}`
 *
 * When the candidate extractor didn't capture `englishName` for a Chinese
 * scholar (common — Chinese search pages often only use 中文名), we first
 * ask the fast LLM for the academic English spelling (何恺明 → "Kaiming He"),
 * then run the Latin tiers above.
 */
export async function findScholarProfileUrl(
  name: string,
  englishName?: string,
  org?: string,
  englishOrg?: string,
  topic?: string
): Promise<string | null> {
  let latinName = englishName?.trim() || stripChinese(name);
  // Chinese-only name → infer the academic English spelling before searching.
  // Without this, Chinese-char-only names were `stripChinese()`-ed to "" and
  // we'd bail out before ever hitting Scholar.
  if (!latinName && HAN_RE.test(name)) {
    const inferred = await inferAcademicEnglishName(name.trim(), topic, org);
    if (inferred) latinName = inferred;
  }
  if (!latinName) return null;

  const latinOrg = (englishOrg?.trim() || stripChinese(org || "")).trim();
  const latinTopic = topic ? stripChinese(topic) : "";

  const runTier = async (
    query: string,
    opts: { siteRestrict?: boolean; topK?: number } = {}
  ): Promise<string | null> => {
    const { siteRestrict = true, topK = 5 } = opts;
    const results = await fridaySearch(query, {
      sources: ["bing"],
      topK,
      siteRestrictions: siteRestrict ? ["scholar.google.com"] : undefined,
      timeout: 8,
    });
    const userId = extractFirstUserId(results);
    return userId ? `https://scholar.google.com/citations?user=${userId}&hl=en` : null;
  };

  // Build the tier list with priority. Skip tiers whose inputs are missing.
  const tiers: Array<() => Promise<string | null>> = [];
  if (latinOrg) tiers.push(() => runTier(`${latinName} ${latinOrg}`));
  tiers.push(() => runTier(latinName));
  tiers.push(() =>
    runTier(`${latinName} Google Scholar citations`, {
      siteRestrict: false,
      topK: 8,
    })
  );
  if (latinTopic && latinTopic !== latinName) {
    tiers.push(() => runTier(`${latinName} ${latinTopic}`));
  }

  // Fire all in parallel, keep results in priority order
  const results = await Promise.all(tiers.map((t) => t().catch(() => null)));
  for (const r of results) {
    if (r) return r; // first hit wins (priority-ordered)
  }
  return null;
}

/**
 * Run multiple search queries in parallel and deduplicate results by URL.
 */
export async function multiSearch(
  queries: string[],
  options: { topK?: number } = {}
): Promise<SearchResultItem[]> {
  const results = await Promise.all(
    queries.map((q) => fridaySearch(q, { topK: options.topK ?? 5 }))
  );

  const seen = new Set<string>();
  const merged: SearchResultItem[] = [];

  for (const batch of results) {
    for (const item of batch) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        merged.push(item);
      }
    }
  }

  return merged;
}
