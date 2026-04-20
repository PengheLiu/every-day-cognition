"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { DimensionCard } from "@/components/DimensionCard";
import { GlossarySection } from "@/components/GlossarySection";
import { DialogueTipsSection } from "@/components/DialogueTips";
import { GeneratingStatus } from "@/components/GeneratingStatus";
import { ChatPanel } from "@/components/ChatPanel";
import { ExpertDetailModal } from "@/components/ExpertDetailModal";
import type {
  Briefing,
  SearchProgressEvent,
  SearchResult,
  DimensionKey,
  DimensionContent,
  ExpertInfo,
} from "@/lib/types";
import { DIMENSION_META } from "@/lib/types";
import { parseResilientJSON } from "@/lib/json-repair";

function BriefingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const topic = searchParams.get("topic") || "";

  const [phase, setPhase] = useState<"searching" | "generating" | "done" | "error">("searching");
  const [searchEvents, setSearchEvents] = useState<SearchProgressEvent[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [rawText, setRawText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  // Chat / follow-up UI is temporarily disabled; kept wired for easy re-enable.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialQ, setChatInitialQ] = useState<string | undefined>();
  const [selectedExpert, setSelectedExpert] = useState<ExpertInfo | null>(null);
  const hasStarted = useRef(false);

  const fetchHeroImage = useCallback(async (topic: string) => {
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "hero", topic }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.imageUrl || null;
    } catch {
      return null;
    }
  }, []);

  const fetchDimensionImage = useCallback(
    async (topic: string, dimensionLabel: string, summary: string) => {
      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "dimension", topic, dimensionLabel, summary }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.imageUrl || null;
      } catch {
        return null;
      }
    },
    []
  );

  const startGeneration = useCallback(async () => {
    if (!topic || hasStarted.current) return;
    hasStarted.current = true;

    // Phase 0: Check cache first (1-day TTL on server)
    try {
      const cacheRes = await fetch(
        `/api/briefing-bundle?topic=${encodeURIComponent(topic)}`
      );
      if (cacheRes.ok) {
        const { bundle } = await cacheRes.json();
        if (bundle && bundle.dimensions?.length) {
          setBriefing(bundle);
          setPhase("done");
          // Still record the visit as a search event (history)
          fetch("/api/briefing-bundle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, bundle }),
          }).catch(() => {});
          // If the cached bundle has no images yet, load them
          if (!bundle.heroImageUrl) loadImages(bundle);
          return;
        }
      }
    } catch {
      // fall through to fresh generation
    }

    // Phase 1: Search
    setPhase("searching");
    let searchResult: SearchResult = { experts: [], quotes: [] };

    try {
      const searchRes = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      if (!searchRes.ok) throw new Error("Search failed");

      const reader = searchRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(trimmed.slice(6));
            if (event.type === "done" && event.result) {
              searchResult = event.result;
            } else if (event.type) {
              setSearchEvents((prev) => [...prev, event]);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    }

    // Phase 2: Briefing generation
    setPhase("generating");

    // Kick off hero image fetch in parallel with briefing gen (needs only topic)
    fetchHeroImage(topic).then((url) => {
      if (url) {
        setBriefing((prev) => (prev ? { ...prev, heroImageUrl: url } : prev));
      } else {
        setHeroImageFailed(true);
      }
    });

    try {
      const briefingRes = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          experts: searchResult.experts,
          quotes: searchResult.quotes,
        }),
      });

      if (!briefingRes.ok) {
        const body = await briefingRes.text();
        let hint = "生成简报时出错";
        if (body.includes("fetch failed") || body.includes("ETIMEDOUT")) {
          hint = "网络连接到 LLM 服务不稳定";
        } else if (body.includes("429") || body.includes("rate")) {
          hint = "LLM 服务限流，稍后再试";
        } else if (body.includes("401") || body.includes("403")) {
          hint = "LLM API 授权失败，请检查 key";
        }
        throw new Error(`${hint} (${body.slice(0, 120)})`);
      }

      const briefingReader = briefingRes.body!.getReader();
      const briefingDecoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await briefingReader.read();
        if (done) break;

        buffer += briefingDecoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.text) {
              accumulated += data.text;
              setRawText(accumulated);
            }
          } catch {
            // skip
          }
        }
      }

      // Parse final briefing (resilient to truncation/minor issues)
      try {
        const parsed = parseResilientJSON(accumulated) as Partial<Briefing>;
        const finalBriefing: Briefing = {
          topic: parsed.topic || topic,
          oneLiner: parsed.oneLiner || "",
          dimensions: parsed.dimensions || [],
          glossary: parsed.glossary || [],
          dialogueTips: parsed.dialogueTips || [],
          experts: searchResult.experts,
        };
        setBriefing(finalBriefing);
        setPhase("done");

        // Phase 2.5: Backfill missing dimensions (if any) — parallel, non-blocking.
        // Records the FULL bundle to cache only after backfills complete.
        const ALL_DIM_KEYS: DimensionKey[] = [
          "concept", "mechanism", "history", "ecosystem",
          "application", "trend", "controversy",
        ];
        const presentKeys = new Set(
          (finalBriefing.dimensions || []).map((d: DimensionContent) => d.key)
        );
        const missingKeys = ALL_DIM_KEYS.filter((k) => !presentKeys.has(k));

        const finalizeAndCache = (bundle: Briefing) => {
          fetch("/api/briefing-bundle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, bundle }),
          }).catch(() => {});
        };

        if (missingKeys.length > 0) {
          console.log(`[briefing] Backfilling ${missingKeys.length} missing dimensions:`, missingKeys);
          const backfills = missingKeys.map(async (key) => {
            try {
              const res = await fetch("/api/dimension", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  topic,
                  dimensionKey: key,
                  dimensionLabel: DIMENSION_META[key]?.label || key,
                  oneLiner: finalBriefing.oneLiner,
                  quotes: searchResult.quotes,
                }),
              });
              if (!res.ok) return null;
              const data = await res.json();
              return data.dimension as DimensionContent | null;
            } catch {
              return null;
            }
          });

          Promise.all(backfills).then((results) => {
            const newDims = results.filter((d): d is DimensionContent => !!d && !!d.summary);
            if (newDims.length > 0) {
              setBriefing((prev) => {
                if (!prev) return prev;
                const merged = [...prev.dimensions];
                // Insert each backfilled dim at its canonical position
                for (const d of newDims) {
                  if (!merged.find((x) => x.key === d.key)) merged.push(d);
                }
                // Sort by canonical order
                merged.sort(
                  (a, b) =>
                    ALL_DIM_KEYS.indexOf(a.key) - ALL_DIM_KEYS.indexOf(b.key)
                );
                const updated = { ...prev, dimensions: merged };
                finalizeAndCache(updated);
                return updated;
              });
            } else {
              finalizeAndCache(finalBriefing);
            }
          });
        } else {
          finalizeAndCache(finalBriefing);
        }

        // Phase 3: Load images in parallel (non-blocking)
        loadImages(finalBriefing);
      } catch (parseErr) {
        console.error("Failed to parse briefing JSON:", parseErr);
        console.error("Raw accumulated length:", accumulated.length);
        // Post raw content to server so we can inspect it
        fetch("/api/debug-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, content: accumulated, error: String(parseErr) }),
        }).catch(() => {});
        setPhase("done");
      }
    } catch (err) {
      console.error("Generation error:", err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  const loadImages = useCallback(
    async (finalBriefing: Briefing) => {
      // Hero image: only fetch if not already kicked off / not in cached bundle
      if (!finalBriefing.heroImageUrl) {
        fetchHeroImage(finalBriefing.topic).then((url) => {
          if (url) {
            setBriefing((prev) => (prev ? { ...prev, heroImageUrl: url } : prev));
          } else {
            setHeroImageFailed(true);
          }
        });
      }

      // Dimension images (stagger to avoid rate limits)
      for (let i = 0; i < (finalBriefing.dimensions?.length || 0); i++) {
        const dim = finalBriefing.dimensions[i];
        const label = DIMENSION_META[dim.key]?.label || dim.key;
        const delay = i * 400;
        setTimeout(() => {
          fetchDimensionImage(finalBriefing.topic, label, dim.summary).then((url) => {
            if (url) {
              setBriefing((prev) => {
                if (!prev) return prev;
                const newDims = prev.dimensions.map((d) =>
                  d.key === dim.key ? { ...d, imageUrl: url } : d
                );
                return { ...prev, dimensions: newDims };
              });
            }
          });
        }, delay);
      }
    },
    [fetchHeroImage, fetchDimensionImage]
  );

  useEffect(() => {
    startGeneration();
  }, [startGeneration]);

  const briefingSummary = briefing
    ? `主题：${briefing.topic}\n一句话速览：${briefing.oneLiner}\n维度：${briefing.dimensions
        ?.map((d: DimensionContent) => `${DIMENSION_META[d.key]?.label}: ${d.summary}`)
        .join("\n")}`
    : rawText.slice(0, 2000);

  if (!topic) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">
          请输入一个主题。
          <button onClick={() => router.push("/")} className="text-primary ml-2 hover:underline">
            返回首页
          </button>
        </p>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/")}
          className="w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="返回"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
            认知简报
          </div>
          <h1 className="text-2xl font-bold break-words leading-tight">{topic}</h1>
        </div>
      </div>

      {/* Searching / Generating */}
      {phase !== "done" && phase !== "error" && (
        <GeneratingStatus events={searchEvents} phase={phase} />
      )}

      {/* Error state */}
      {phase === "error" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3">
          <div className="flex items-center gap-2 text-destructive font-semibold">
            <span>⚠️</span>
            <span>生成失败</span>
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed break-all">
            {errorMsg || "未知错误"}
          </p>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => {
                hasStarted.current = false;
                setErrorMsg("");
                setSearchEvents([]);
                setRawText("");
                setBriefing(null);
                setPhase("searching");
                startGeneration();
              }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              重试
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 rounded-lg border text-sm hover:bg-muted transition-colors"
            >
              返回首页
            </button>
          </div>
        </div>
      )}

      {/* Briefing content */}
      {briefing && phase === "done" && (
        <div className="space-y-5 animate-in fade-in duration-500">
          {/* Hero image */}
          {briefing.heroImageUrl ? (
            <div className="rounded-xl overflow-hidden shadow-sm bg-muted aspect-[16/9] animate-in fade-in zoom-in-95 duration-500">
              <img
                src={briefing.heroImageUrl}
                alt={briefing.topic}
                className="w-full h-full object-cover"
              />
            </div>
          ) : heroImageFailed ? (
            <div className="rounded-xl overflow-hidden bg-gradient-to-br from-primary/10 via-accent/10 to-primary/5 aspect-[16/9] flex items-center justify-center border border-primary/10">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <span className="text-4xl opacity-60">🧠</span>
                <button
                  onClick={() => {
                    setHeroImageFailed(false);
                    fetchHeroImage(briefing.topic).then((url) => {
                      if (url) setBriefing((prev) => (prev ? { ...prev, heroImageUrl: url } : prev));
                      else setHeroImageFailed(true);
                    });
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  主图绘制超时，点此重试
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5 aspect-[16/9] flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-xs">正在绘制主图...</span>
              </div>
            </div>
          )}

          {/* One-liner */}
          {briefing.oneLiner && (
            <div className="rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 p-5">
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">💡</span>
                <div>
                  <div className="text-[11px] font-medium text-primary uppercase tracking-wider mb-1">
                    一句话速览
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed">
                    {briefing.oneLiner}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Experts identified */}
          {briefing.experts?.length > 0 && (
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  👥
                </span>
                <h3 className="font-semibold">领域专家</h3>
                <span className="text-xs text-muted-foreground ml-auto">
                  {briefing.experts.length} 位
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {briefing.experts.map((expert, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedExpert(expert)}
                    className="group flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/60 hover:ring-1 hover:ring-primary/20 transition-all text-left cursor-pointer"
                    title="点击查看详细介绍"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/15 group-hover:bg-primary group-hover:text-primary-foreground flex items-center justify-center text-xs font-bold text-primary shrink-0 transition-colors">
                      {expert.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate flex items-center gap-1">
                        {expert.name}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {expert.title}
                        {expert.org && expert.org !== "未知" ? ` · ${expert.org}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dimension cards */}
          <div className="space-y-4">
            {briefing.dimensions?.map((dim: DimensionContent) => (
              <DimensionCard
                key={dim.key}
                dimension={dim}
                onClickExpert={(name) => {
                  const matched = briefing.experts?.find((e) => e.name === name);
                  if (matched) {
                    setSelectedExpert(matched);
                  } else {
                    // Fallback: build a minimal ExpertInfo from the quote
                    setSelectedExpert({
                      name,
                      title: "",
                      org: "",
                      reason: "",
                    });
                  }
                }}
              />
            ))}
          </div>

          {/* Glossary */}
          <GlossarySection items={briefing.glossary} />

          {/* Dialogue Tips */}
          <DialogueTipsSection tips={briefing.dialogueTips} />
        </div>
      )}

      {/* Raw text fallback (only when parse fails gracefully, not hard error) */}
      {!briefing && phase === "done" && rawText && (
        <div className="rounded-xl border p-5 mt-4">
          <p className="text-sm text-muted-foreground mb-3">
            简报生成完成，但 JSON 格式解析失败。原始内容：
          </p>
          <pre className="text-sm text-foreground whitespace-pre-wrap font-mono">
            {rawText}
          </pre>
        </div>
      )}

      {/* Chat panel (disabled — follow-up UI is removed; kept for future re-enable) */}
      {chatOpen && (
        <ChatPanel
          topic={topic}
          briefingSummary={briefingSummary}
          initialQuestion={chatInitialQ}
          onClose={() => {
            setChatOpen(false);
            setChatInitialQ(undefined);
          }}
        />
      )}

      {/* Expert detail modal */}
      {selectedExpert && (
        <ExpertDetailModal
          expert={selectedExpert}
          topic={topic}
          onClose={() => setSelectedExpert(null)}
        />
      )}
    </main>
  );
}

export default function BriefingPage() {
  return (
    <Suspense
      fallback={
        <main className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </main>
      }
    >
      <BriefingContent />
    </Suspense>
  );
}
