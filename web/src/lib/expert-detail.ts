/**
 * Expert-detail pipeline — extracts one person's structured biography from
 * live web search + fast-LLM extraction, and looks up their Google Scholar
 * profile in parallel.
 *
 * Used by:
 *   - /api/expert             (user clicks an expert → on-demand fetch)
 *   - jobs.ts prewarm         (right after Phase B, experts are known →
 *                              kick off all details in parallel with the
 *                              quote + briefing phases so the drawer opens
 *                              instantly when clicked)
 *
 * Both callers hit the same `expert_cache`, so either path benefits from
 * whichever finished first.
 */

import { chatCompletion, FAST_MODEL } from "./openrouter";
import { multiSearch, findScholarProfileUrl } from "./search";
import { buildExpertDetailQueries, buildExpertDetailPrompt } from "./prompts";
import { parseResilientJSON } from "./json-repair";
import { getCachedExpert, setCachedExpert, normalizeTopic } from "./db";
import type { ExpertDetail } from "./types";

/**
 * Per-process in-flight dedup map.
 *
 * Why: prewarm fires N expert fetches in parallel during briefing generation.
 * If the user clicks an expert WHILE its prewarm fetch is still running, the
 * naive code starts a duplicate fetch — wasting Friday/LLM quota and racing
 * the cache write. With this map, the user-click path notices an in-flight
 * Promise for the same (name, topic) and just awaits it. So:
 *
 *   - prewarm finishes first → click hits cache (fastest)
 *   - prewarm in progress → click awaits same promise (no extra cost)
 *   - prewarm hasn't started this expert yet → click fires its own fetch
 *     (and prewarm's later attempt will dedup against IT)
 *
 * Keyed identically to the SQLite cache row so the two layers agree.
 */
const inFlight = new Map<string, Promise<ExpertDetail>>();

export interface FetchExpertDetailInput {
  name: string;
  englishName?: string;
  title: string;
  org: string;
  englishOrg?: string;
  topic: string;
}

export interface FetchExpertDetailOptions {
  /**
   * "Gentle" mode caps the in-flight Friday calls per task to 2 (instead of
   * firing all 5-6 detail queries in parallel). Use this when fetchExpertDetail
   * is being driven by a batch — e.g. prewarming N experts at once during
   * briefing generation. Without this, prewarm bursts ~20+ Friday requests
   * per second, the backend rate-limits, and we end up caching empty results
   * for every expert simultaneously.
   *
   * On-demand calls (a user clicks a single expert) leave this off so latency
   * stays at one round trip.
   */
  gentle?: boolean;
}

/**
 * Fetch (or retrieve from cache) the structured detail for one expert.
 * Never throws — returns a best-effort ExpertDetail with disambiguation
 * on miss.
 */
export async function fetchExpertDetail(
  input: FetchExpertDetailInput,
  options: FetchExpertDetailOptions = {}
): Promise<ExpertDetail> {
  // Cache check (full hits 7d, empty/disambiguation 1h)
  const cached = getCachedExpert(input.name, input.topic) as ExpertDetail | null;
  if (cached) return cached;

  // In-flight dedup: if prewarm (or another tab / another user hitting the
  // same process) is already fetching this expert, await THEIR promise.
  const dedupKey = `${input.name.trim()}::${normalizeTopic(input.topic)}`;
  const existing = inFlight.get(dedupKey);
  if (existing) return existing;

  const work = doFetchExpertDetail(input, options);
  inFlight.set(dedupKey, work);
  try {
    return await work;
  } finally {
    inFlight.delete(dedupKey);
  }
}

async function doFetchExpertDetail(
  input: FetchExpertDetailInput,
  options: FetchExpertDetailOptions
): Promise<ExpertDetail> {
  const { name, englishName, title, org, englishOrg, topic } = input;
  const friday = options.gentle ? { topK: 5, concurrency: 2 } : { topK: 5 };

  // Run expert detail search and Scholar profile lookup in parallel
  const [searchResults, scholarProfileUrl] = await Promise.all([
    multiSearch(buildExpertDetailQueries(name, englishName, org, topic), friday),
    findScholarProfileUrl(name, englishName, org, englishOrg, topic).catch(() => null),
  ]);

  if (searchResults.length === 0) {
    // IMPORTANT: do NOT cache this path. Zero search results for a verified
    // expert (they passed Phase B, i.e. at least one Friday query already
    // matched them with topic context) almost always means the search
    // backend transiently failed / rate-limited — `fridaySearch` swallows
    // errors and returns []. Caching would pin a 1h "未搜索到相关公开信息"
    // screen even though the real cause is backpressure that cleared in
    // seconds. Let the next caller retry.
    return {
      name,
      englishName,
      currentTitle: `${title}${org && org !== "未知" ? ", " + org : ""}`,
      biography: "",
      currentStatus: "",
      companyInfo: "",
      notableWorks: [],
      recentUpdates: [],
      links: [],
      disambiguation: "未搜索到相关公开信息",
      scholarProfileUrl: scholarProfileUrl || undefined,
    };
  }

  const extractionPrompt = buildExpertDetailPrompt(
    name,
    title,
    org || "未知",
    topic,
    searchResults.map((r) => ({
      title: r.title,
      snippet: r.snippet,
      content: r.content?.slice(0, 1200) || "",
      url: r.url,
      publishTime: r.publishTime,
    }))
  );

  let parsed: Partial<ExpertDetail> = {};
  let llmCallFailed = false;
  try {
    const resp = await chatCompletion(
      [{ role: "user", content: extractionPrompt }],
      { temperature: 0.3, maxTokens: 3000, model: FAST_MODEL }
    );
    try {
      parsed = parseResilientJSON(resp) as Partial<ExpertDetail>;
    } catch (err) {
      console.error("[expert-detail] parse error:", err);
    }
  } catch (err) {
    console.error("[expert-detail] LLM call failed:", err);
    llmCallFailed = true;
  }

  const detail: ExpertDetail = {
    name: parsed.name || name,
    englishName: englishName,
    currentTitle:
      parsed.currentTitle ||
      `${title}${org && org !== "未知" ? ", " + org : ""}`,
    biography: parsed.biography || "",
    currentStatus: parsed.currentStatus || "",
    companyInfo: parsed.companyInfo || "",
    notableWorks: parsed.notableWorks || [],
    recentUpdates: parsed.recentUpdates || [],
    links: parsed.links || [],
    disambiguation: parsed.disambiguation || "",
    scholarProfileUrl: scholarProfileUrl || undefined,
  };

  // Caching policy:
  //   - LLM call itself failed (network/timeout/rate-limit) → DON'T cache.
  //     Next call gets a fresh attempt.
  //   - Full hit (bio or currentStatus populated) → 7d.
  //   - LLM returned structured output but couldn't match the target (true
  //     disambiguation, or extracted text is empty) → 1h retry window.
  if (!llmCallFailed) {
    const isFullHit = !!(detail.biography || detail.currentStatus);
    setCachedExpert(name, topic, detail, isFullHit ? undefined : 60 * 60 * 1000);
  }

  return detail;
}

/**
 * Kick off detail fetches for every verified expert of a briefing.
 * Resolves when all tasks complete — callers typically fire-and-forget
 * (`.catch(() => {})`) so this runs in the background alongside the
 * briefing generation phases.
 *
 * Concurrency is intentionally capped: each task makes ~5 Friday searches
 * + 1 Haiku call + several Bing (Scholar) searches, so unbounded parallelism
 * would hammer the LLM/search APIs that the main briefing pipeline is also
 * using at the same time.
 */
export async function prewarmExpertDetails(
  experts: FetchExpertDetailInput[],
  concurrency = 5
): Promise<void> {
  if (experts.length === 0) return;

  const queue = [...experts];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (!task) break;
          try {
            await fetchExpertDetail(task, { gentle: true });
          } catch (err) {
            // Prewarm is best-effort — log and move on.
            console.warn(
              `[expert-prewarm] ${task.name} (${task.topic}) failed:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      })()
    );
  }
  await Promise.all(workers);
}
