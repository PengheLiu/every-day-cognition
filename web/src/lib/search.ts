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

/**
 * Find an expert's Google Scholar profile URL by searching Bing restricted to
 * scholar.google.com. Returns the first citations?user= URL found, or null.
 *
 * Bing is essential here because:
 *  - baidu-search-v2 doesn't index scholar.google.com at all (GFW-blocked)
 *  - Bing indexes international sites and supports site: restriction
 */
export async function findScholarProfileUrl(
  name: string,
  englishName?: string,
  org?: string
): Promise<string | null> {
  // Query prefers English name (Scholar is Latin-indexed)
  const q = englishName?.trim() || name;
  const orgHint = org && org !== "未知" ? org.replace(/[\u4e00-\u9fa5]/g, " ").trim() : "";
  const query = orgHint ? `${q} ${orgHint}` : q;

  const results = await fridaySearch(query, {
    sources: ["bing"],
    topK: 10,
    siteRestrictions: ["scholar.google.com"],
    timeout: 8,
  });

  // Look for a citations?user=XXX URL. The first result is almost always the
  // intended author's profile when searching with site:scholar.google.com.
  const pattern = /https?:\/\/scholar\.google\.[a-z.]+\/citations\?[^"'\s<>)]*user=([A-Za-z0-9_-]+)/i;
  for (const r of results) {
    const text = `${r.url} ${r.title} ${r.snippet} ${r.content}`;
    const m = text.match(pattern);
    if (m) {
      const userId = m[1];
      return `https://scholar.google.com/citations?user=${userId}&hl=en`;
    }
  }

  // Fallback: try a broader Bing search without site restriction, in case the
  // profile URL only appears in a referring page (e.g. Wikipedia).
  const broader = await fridaySearch(`${q} Google Scholar citations`, {
    sources: ["bing"],
    topK: 5,
    timeout: 8,
  });
  for (const r of broader) {
    const text = `${r.url} ${r.title} ${r.snippet} ${r.content}`;
    const m = text.match(pattern);
    if (m) {
      const userId = m[1];
      return `https://scholar.google.com/citations?user=${userId}&hl=en`;
    }
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
