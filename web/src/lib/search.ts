/**
 * Search service — uses Friday universal search API (Baidu + Bing backends)
 * and web crawl API for fetching full page content.
 */

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

/**
 * Find an expert's Google Scholar profile URL.
 *
 * Runs all candidate tiers (queries) in **parallel** for latency — typical
 * time drops from ~2-8s (sequential worst case) to ~2-3s (one round trip).
 *
 * Priority: prefer T1 (most precise) if it hits, else T2, else T3, else T4.
 * If multiple tiers return a URL, we pick based on priority.
 *
 *   T1: Bing + site:scholar.google.com + `{englishName} {englishOrg}`
 *   T2: Bing + site:scholar.google.com + `{englishName}`
 *   T3: Bing + `{englishName} Google Scholar citations` (no site restrict)
 *   T4: Bing + site:scholar.google.com + `{englishName} {topic}`
 */
export async function findScholarProfileUrl(
  name: string,
  englishName?: string,
  org?: string,
  englishOrg?: string,
  topic?: string
): Promise<string | null> {
  const latinName = englishName?.trim() || stripChinese(name);
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
