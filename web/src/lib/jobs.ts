/**
 * Async briefing-generation job runner.
 *
 * Unlike the original /api/search + /api/briefing SSE streaming flow (which is
 * tied to the client connection and aborts if the user navigates away), this
 * runner is fire-and-forget on the server side. It writes progress/status to
 * the generation_jobs table so the client can poll.
 *
 * Pipeline (same as the original but inline here):
 *   A) domain search → LLM extract candidate experts
 *   B) verify each candidate with its own search
 *   C) per verified expert, extract quotes
 *   D) generate 7-dim briefing JSON
 *   E) backfill any missing dimensions
 *   F) save the final bundle to briefing_cache
 */

import {
  appendJobEvent,
  createJob,
  getJob,
  listUserJobs,
  setCachedBriefing,
  updateJob,
  countActiveJobs,
  getActiveJobLimit,
  findReusableJob,
  normalizeTopic,
  getCachedBriefing,
  getCachedDomainSearch,
  setCachedDomainSearch,
  recordSearch,
  type GenerationJob,
} from "./db";
import type { SearchResultItem } from "./search";
import { chatCompletion, FAST_MODEL } from "./openrouter";
import { multiSearch, fridaySearch } from "./search";
import { prewarmExpertDetails } from "./expert-detail";
import {
  buildDomainSearchQueries,
  buildExpertExtractionPrompt,
  buildSearchQueries,
  buildQuoteExtractionPrompt,
  buildBriefingMetaPrompt,
  buildSingleDimensionPrompt,
} from "./prompts";
import { parseResilientJSON } from "./json-repair";
import type {
  Briefing,
  DimensionContent,
  DimensionKey,
  ExpertInfo,
  ExpertQuote,
} from "./types";
import { DIMENSION_META } from "./types";

const ALL_DIM_KEYS: DimensionKey[] = [
  "concept",
  "mechanism",
  "history",
  "ecosystem",
  "application",
  "trend",
  "controversy",
];

/** Sentinel error signalling that the user cancelled the job. */
class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Throw if the job has been marked cancelled. Called at phase boundaries.
 * Can't interrupt an in-flight LLM HTTP request, but prevents starting the
 * next heavy step — so cancellation takes effect within a few seconds.
 */
function throwIfCancelled(jobId: string): void {
  const job = getJob(jobId);
  if (job && job.status === "cancelled") {
    throw new CancelledError();
  }
}

/**
 * Enqueue a briefing-generation job for a user.
 * Returns:
 *   - existing job if one is already running/recent for the same topic
 *   - { cached: true } if bundle is already cached (caller should redirect)
 *   - new GenerationJob otherwise
 * Throws if user has >= 5 active jobs.
 */
export function enqueueBriefingJob(
  userId: string | null,
  topic: string
): { kind: "cached"; topic: string } | { kind: "job"; job: GenerationJob; reused: boolean } {
  const trimmed = topic.trim();
  if (!trimmed) throw new Error("topic required");

  // 1) if already cached, no need to kick off a job
  const cached = getCachedBriefing(trimmed);
  if (cached) {
    // Record the search event for history/trending
    recordSearch(userId, trimmed);
    return { kind: "cached", topic: normalizeTopic(trimmed) };
  }

  // 2) reuse any running or recently-done job for same (user, topic)
  const reuse = findReusableJob(userId, trimmed);
  if (reuse) return { kind: "job", job: reuse, reused: true };

  // 3) enforce per-user active limit
  const active = countActiveJobs(userId);
  const limit = getActiveJobLimit();
  if (active >= limit) {
    throw new Error(`LIMIT_EXCEEDED:已有 ${active}/${limit} 个任务在生成中，请等待其中一个完成再开始新主题`);
  }

  // 4) create + fire-and-forget run
  const job = createJob(userId, trimmed);
  // Record search immediately so it appears in history right away
  recordSearch(userId, trimmed);

  // Schedule background execution. setImmediate lets the HTTP handler
  // return the response first.
  setImmediate(() => {
    runJobInBackground(job.id).catch((err) => {
      console.error(`[job ${job.id}] crashed:`, err);
      updateJob(job.id, { status: "error", error: String(err) });
    });
  });

  return { kind: "job", job, reused: false };
}

/** Summary for UI list (excludes heavy events array). */
export interface JobSummary {
  id: string;
  topic: string;
  status: GenerationJob["status"];
  progress_message: string | null;
  created_at: number;
  updated_at: number;
  error: string | null;
}

export function summarizeJob(job: GenerationJob): JobSummary {
  return {
    id: job.id,
    topic: job.topic,
    status: job.status,
    progress_message: job.progress_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
    error: job.error,
  };
}

export function listUserJobSummaries(
  userId: string | null,
  options: { limit?: number; onlyActive?: boolean } = {}
): JobSummary[] {
  return listUserJobs(userId, options).map(summarizeJob);
}

// ============================================================================
// Pipeline implementation
// ============================================================================

async function runJobInBackground(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  const { topic } = job;

  try {
    throwIfCancelled(jobId);
    const { experts, quotes } = await runSearchPhase(jobId, topic);
    throwIfCancelled(jobId);
    if (!experts.length) {
      updateJob(jobId, {
        status: "error",
        error: "未能从真实资料中识别到该领域的专家",
      });
      return;
    }

    const bundle = await runBriefingPhase(jobId, topic, experts, quotes);
    throwIfCancelled(jobId);
    if (!bundle) return;

    // Save to cache + mark job done
    setCachedBriefing(topic, bundle);
    updateJob(jobId, {
      status: "done",
      progress_message: "简报生成完成",
      result_topic: normalizeTopic(topic),
    });
    appendJobEvent(jobId, { type: "done", message: "简报生成完成" });
  } catch (err) {
    if (err instanceof CancelledError) {
      console.log(`[job ${jobId}] cancelled by user`);
      // cancelJob already set status to 'cancelled' — just record the event
      appendJobEvent(jobId, { type: "cancelled", message: "已取消" });
      return;
    }
    console.error(`[job ${jobId}] error:`, err);
    updateJob(jobId, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runSearchPhase(
  jobId: string,
  topic: string
): Promise<{ experts: ExpertInfo[]; quotes: (ExpertQuote & { dimension: string })[] }> {
  updateJob(jobId, { status: "searching", progress_message: `搜索「${topic}」领域的真实资料...` });
  appendJobEvent(jobId, { type: "identifying_experts", message: `搜索「${topic}」领域的真实资料...` });

  // Phase A: domain search (cross-user cache first, 1-day TTL)
  let domainResults: SearchResultItem[] = [];
  const cachedDomain = getCachedDomainSearch<SearchResultItem[]>(topic);
  if (cachedDomain && cachedDomain.length > 0) {
    domainResults = cachedDomain;
    appendJobEvent(jobId, {
      type: "identifying_experts",
      message: `复用 ${domainResults.length} 条缓存的领域资料`,
    });
  } else {
    const domainQueries = buildDomainSearchQueries(topic);
    domainResults = await multiSearch(domainQueries, { topK: 5 });
    if (domainResults.length > 0) {
      setCachedDomainSearch(topic, domainResults);
    }
  }
  if (domainResults.length === 0) return { experts: [], quotes: [] };

  appendJobEvent(jobId, {
    type: "identifying_experts",
    message: `从 ${domainResults.length} 条资料中提取候选专家...`,
  });

  const extractionPrompt = buildExpertExtractionPrompt(
    topic,
    domainResults.slice(0, 30).map((r) => ({
      title: r.title,
      snippet: r.snippet,
      content: r.content?.slice(0, 1200) || "",
      url: r.url,
      publishTime: r.publishTime,
    }))
  );
  const candidateJson = await chatCompletion(
    [{ role: "user", content: extractionPrompt }],
    { temperature: 0.2, maxTokens: 3000, model: FAST_MODEL }
  );
  let candidates: (ExpertInfo & { evidenceQuote?: string })[] = [];
  try {
    const parsed = parseResilientJSON(candidateJson);
    if (Array.isArray(parsed)) candidates = parsed as typeof candidates;
  } catch {
    // fall through
  }
  if (candidates.length === 0) return { experts: [], quotes: [] };

  appendJobEvent(jobId, {
    type: "identifying_experts",
    message: `提取到 ${candidates.length} 位候选，开始验证身份...`,
  });

  // Phase B: independent verification with concurrency
  const verifiedExperts: ExpertInfo[] = [];
  // Higher concurrency so 15+ candidates verify in a single batch
  // (Friday search can handle it; LLM isn't involved here)
  const PHASE_B_CONCURRENCY = 15;

  const verifyOne = async (cand: (typeof candidates)[number]) => {
    throwIfCancelled(jobId);
    if (!cand.name || cand.name.length < 2 || cand.name.length > 30) return;
    const q =
      cand.org && cand.org !== "未知" ? `${cand.name} ${cand.org}` : `${cand.name} ${topic}`;
    const merged = await fridaySearch(q, { topK: 3 });
    const nameLower = cand.name.toLowerCase();
    const topicLower = topic.toLowerCase();
    const relevantCount = merged.filter((r) => {
      const text = `${r.title} ${r.snippet} ${r.content}`.toLowerCase();
      const mentionsName =
        text.includes(nameLower) ||
        (cand.englishName && text.includes(cand.englishName.toLowerCase()));
      const mentionsContext =
        text.includes(topicLower) ||
        (cand.org && cand.org !== "未知" && text.includes(cand.org.toLowerCase()));
      return mentionsName && mentionsContext;
    }).length;
    if (relevantCount >= 1) {
      verifiedExperts.push({
        name: cand.name,
        englishName: cand.englishName || undefined,
        title: cand.title || "",
        org: cand.org || "",
        englishOrg:
          (cand as ExpertInfo).englishOrg ||
          // Heuristic: if org is already Latin-only, reuse it
          (cand.org && /^[\x00-\x7F]+$/.test(cand.org) ? cand.org : undefined),
        reason: cand.reason || "",
      });
    }
  };

  {
    const queue = [...candidates];
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(PHASE_B_CONCURRENCY, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const cand = queue.shift();
            if (!cand) break;
            await verifyOne(cand);
          }
        })()
      );
    }
    await Promise.all(workers);
  }

  if (verifiedExperts.length === 0) return { experts: [], quotes: [] };
  appendJobEvent(jobId, {
    type: "searching_expert",
    message: `验证通过 ${verifiedExperts.length} 位真实专家`,
    expertsFound: verifiedExperts.length,
  });

  // Prewarm expert detail pages in the background. Fires here (end of Phase B)
  // so it runs concurrently with Phase C (quote extraction) and Phase D
  // (briefing generation) — by the time the user sees the briefing and clicks
  // an expert, expert_cache is already populated and the drawer opens instantly.
  //
  // Burst control: prewarm uses { gentle: true } which caps each task's Friday
  // calls to 2-in-flight (instead of firing all 5 in parallel). Combined with
  // concurrency=3 here, the search backend sees max ~6 parallel Friday from
  // prewarm — small enough to coexist with Phase C (~12 Haiku, occasional
  // Friday for orphan experts) without triggering rate limits that previously
  // cached poisoned "未搜索到" entries for every expert at once.
  //
  // Fire-and-forget — a failure must not affect the briefing itself.
  prewarmExpertDetails(
    verifiedExperts.map((e) => ({
      name: e.name,
      englishName: e.englishName,
      title: e.title,
      org: e.org,
      englishOrg: e.englishOrg,
      topic,
    })),
    3
  ).catch((err) => {
    console.warn(`[job ${jobId}] expert prewarm batch failed:`, err);
  });

  // Phase C: quote extraction (reuse Phase A results first)
  const allQuotes: (ExpertQuote & { dimension: string })[] = [];
  // With Haiku being ~3s per call, 12 parallel calls fits in a single batch
  // for most topics. Keeps 15 experts finishing in one round rather than two.
  const PHASE_C_CONCURRENCY = 12;

  const processExpert = async (expert: ExpertInfo) => {
    throwIfCancelled(jobId);
    appendJobEvent(jobId, { type: "searching_expert", message: `分析 ${expert.name} 的观点...` });
    const nameLower = expert.name.toLowerCase();
    const engLower = expert.englishName?.toLowerCase() || "";
    const filtered = domainResults.filter((r) => {
      const text = `${r.title} ${r.snippet} ${r.content}`.toLowerCase();
      return text.includes(nameLower) || (engLower && text.includes(engLower));
    });

    let searchResults = filtered;
    if (filtered.length < 1) {
      // Only do an extra focused search when Phase A yielded nothing for this
      // expert. 1+ result is usually enough context for quote extraction.
      const queries = buildSearchQueries(topic, expert.name, expert.englishName);
      const extra = await multiSearch(queries, { topK: 5 });
      const seen = new Set(filtered.map((r) => r.url));
      for (const r of extra) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          filtered.push(r);
        }
      }
      searchResults = filtered;
    }
    if (searchResults.length === 0) return;

    let quotesJson = "";
    try {
      quotesJson = await chatCompletion(
        [
          {
            role: "user",
            content: buildQuoteExtractionPrompt(
              topic,
              expert.name,
              `${expert.title}, ${expert.org}`,
              searchResults.map((r) => ({
                title: r.title,
                snippet: r.snippet,
                content: r.content?.slice(0, 1500) || "",
                url: r.url,
                publishTime: r.publishTime,
              }))
            ),
          },
        ],
        { temperature: 0.2, maxTokens: 2048, model: FAST_MODEL }
      );
    } catch {
      return;
    }
    try {
      const quotes = parseResilientJSON(quotesJson);
      if (!Array.isArray(quotes)) return;
      for (const q of quotes as Record<string, string>[]) {
        if (!q.quote) continue;
        allQuotes.push({
          personName: expert.name,
          personTitle: `${expert.title}${expert.org ? ", " + expert.org : ""}`,
          quote: q.quote,
          sourceType: q.sourceType || "公开资料",
          sourceUrl: q.sourceUrl,
          sourceDate: q.sourceDate,
          aiInterpretation: q.aiInterpretation,
          dimension: q.dimension || "concept",
        });
      }
    } catch {
      /* skip */
    }
  };

  {
    const queue = [...verifiedExperts];
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(PHASE_C_CONCURRENCY, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const expert = queue.shift();
            if (!expert) break;
            await processExpert(expert);
          }
        })()
      );
    }
    await Promise.all(workers);
  }

  appendJobEvent(jobId, {
    type: "extracting_quotes",
    message: `共采集 ${allQuotes.length} 条大佬观点`,
    quotesFound: allQuotes.length,
  });

  return { experts: verifiedExperts, quotes: allQuotes };
}

/**
 * Generate the briefing in PARALLEL:
 *   - 1 meta call:   oneLiner + glossary + dialogueTips
 *   - 7 dim calls:   one per dimension (concept, mechanism, ...)
 *
 * This replaces the old single-call approach (one 64k-token JSON) and cuts
 * briefing generation time from ~30-50s to ~10-15s (all 8 calls run in parallel,
 * each ~8-12s, bounded by the slowest one).
 *
 * If any dimension call fails individually, the briefing still ships with the
 * remaining 6 dimensions (and optionally another retry as "backfill"). Meta
 * failure is degraded but doesn't kill the briefing — we fall back to defaults.
 */
async function runBriefingPhase(
  jobId: string,
  topic: string,
  experts: ExpertInfo[],
  quotes: (ExpertQuote & { dimension: string })[]
): Promise<Briefing | null> {
  updateJob(jobId, { status: "generating", progress_message: "并行生成 7 个维度..." });
  appendJobEvent(jobId, { type: "generating", message: "并行生成 7 个维度..." });

  // Group quotes per expert for meta prompt
  const expertQuoteMap = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const list = expertQuoteMap.get(q.personName) || [];
    list.push(q);
    expertQuoteMap.set(q.personName, list);
  }
  const expertsWithQuotes = experts.map((expert) => ({
    expert: { name: expert.name, title: expert.title, org: expert.org },
    quotes: (expertQuoteMap.get(expert.name) || []).map((q) => ({
      quote: q.quote,
      sourceType: q.sourceType,
      sourceUrl: q.sourceUrl,
      sourceDate: q.sourceDate,
      dimension: q.dimension,
      aiInterpretation: q.aiInterpretation,
    })),
  }));

  // --- Parallel tasks ---
  const metaTask = (async () => {
    try {
      const resp = await chatCompletion(
        [{ role: "user", content: buildBriefingMetaPrompt(topic, expertsWithQuotes) }],
        { temperature: 0.4, maxTokens: 4000 }
      );
      const parsed = parseResilientJSON(resp) as {
        oneLiner?: string;
        glossary?: Briefing["glossary"];
        dialogueTips?: Briefing["dialogueTips"];
      };
      return {
        oneLiner: parsed.oneLiner || "",
        glossary: parsed.glossary || [],
        dialogueTips: parsed.dialogueTips || [],
      };
    } catch (err) {
      console.error(`[job ${jobId}] meta generation failed:`, err);
      return { oneLiner: "", glossary: [], dialogueTips: [] };
    }
  })();

  const dimensionTasks = ALL_DIM_KEYS.map((key) =>
    (async (): Promise<DimensionContent | null> => {
      try {
        const prompt = buildSingleDimensionPrompt(
          topic,
          key,
          DIMENSION_META[key]?.label || key,
          "", // oneLiner not yet available — dimension prompt doesn't strictly need it
          quotes
        );
        const resp = await chatCompletion(
          [{ role: "user", content: prompt }],
          { temperature: 0.4, maxTokens: 4000 }
        );
        const p = parseResilientJSON(resp) as Partial<DimensionContent>;
        if (!p.summary) return null;
        return {
          key: (p.key || key) as DimensionKey,
          summary: p.summary || "",
          detail: p.detail || "",
          expertQuotes: p.expertQuotes || [],
        };
      } catch (err) {
        console.error(`[job ${jobId}] dimension ${key} failed:`, err);
        return null;
      }
    })()
  );

  const [meta, ...dims] = await Promise.all([metaTask, ...dimensionTasks]);

  const successfulDims = dims.filter((d): d is DimensionContent => !!d && !!d.summary);

  appendJobEvent(jobId, {
    type: "generating",
    message: `已生成 ${successfulDims.length}/7 维度 + 概览`,
  });

  // --- Retry failures once, in parallel ---
  const firstPassKeys = new Set(successfulDims.map((d) => d.key));
  const failedKeys = ALL_DIM_KEYS.filter((k) => !firstPassKeys.has(k));
  if (failedKeys.length > 0) {
    appendJobEvent(jobId, {
      type: "generating",
      message: `重试 ${failedKeys.length} 个失败维度...`,
    });
    const retries = await Promise.all(
      failedKeys.map(async (key): Promise<DimensionContent | null> => {
        try {
          const prompt = buildSingleDimensionPrompt(
            topic,
            key,
            DIMENSION_META[key]?.label || key,
            meta.oneLiner,
            quotes
          );
          const resp = await chatCompletion(
            [{ role: "user", content: prompt }],
            { temperature: 0.3, maxTokens: 4000 }
          );
          const p = parseResilientJSON(resp) as Partial<DimensionContent>;
          if (!p.summary) return null;
          return {
            key: (p.key || key) as DimensionKey,
            summary: p.summary || "",
            detail: p.detail || "",
            expertQuotes: p.expertQuotes || [],
          };
        } catch {
          return null;
        }
      })
    );
    for (const d of retries) {
      if (d) successfulDims.push(d);
    }
  }

  // Canonical order
  successfulDims.sort(
    (a, b) => ALL_DIM_KEYS.indexOf(a.key) - ALL_DIM_KEYS.indexOf(b.key)
  );

  return {
    topic,
    oneLiner: meta.oneLiner,
    dimensions: successfulDims,
    glossary: meta.glossary,
    dialogueTips: meta.dialogueTips,
    experts,
  };
}

// Re-export for routes
export { getJob, listUserJobs };
export type { GenerationJob };
