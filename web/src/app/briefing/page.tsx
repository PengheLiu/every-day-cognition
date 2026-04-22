"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { DimensionCard } from "@/components/DimensionCard";
import { GlossarySection } from "@/components/GlossarySection";
import { DialogueTipsSection } from "@/components/DialogueTips";
import { GeneratingStatus } from "@/components/GeneratingStatus";
import { ChatPanel } from "@/components/ChatPanel";
import { ExpertDetailModal } from "@/components/ExpertDetailModal";
import { ShareButton } from "@/components/ShareButton";
import { ImageLightbox } from "@/components/ImageLightbox";
import type {
  Briefing,
  SearchProgressEvent,
  DimensionContent,
  ExpertInfo,
} from "@/lib/types";
import { DIMENSION_META } from "@/lib/types";

function BriefingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const topic = searchParams.get("topic") || "";

  const [phase, setPhase] = useState<"searching" | "generating" | "done" | "error">("searching");
  const [searchEvents, setSearchEvents] = useState<SearchProgressEvent[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  // Chat / follow-up UI is temporarily disabled; kept wired for easy re-enable.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialQ, setChatInitialQ] = useState<string | undefined>();
  const [selectedExpert, setSelectedExpert] = useState<ExpertInfo | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const hasStarted = useRef(false);
  const cancelledRef = useRef(false);

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

  // Load the cached bundle and render it. Used both after a job finishes and
  // as a fast-path when the topic is already cached on first visit.
  const loadCachedBundle = useCallback(
    async (topicArg: string): Promise<boolean> => {
      const res = await fetch(
        `/api/briefing-bundle?topic=${encodeURIComponent(topicArg)}`
      );
      if (!res.ok) return false;
      const { bundle } = await res.json();
      if (!bundle || !bundle.dimensions?.length) return false;
      setBriefing(bundle);
      setPhase("done");
      if (!bundle.heroImageUrl) loadImages(bundle);
      return true;
    },
    [loadImages]
  );

  const pollJobToCompletion = useCallback(
    async (jobId: string) => {
      const INITIAL_INTERVAL = 1000;
      const MAX_INTERVAL = 3000;
      let interval = INITIAL_INTERVAL;

      while (true) {
        // Stop polling if user initiated cancellation on the client side.
        if (cancelledRef.current) return;

        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) {
          throw new Error(`轮询任务失败 (HTTP ${res.status})`);
        }
        const { job } = await res.json();
        if (!job) throw new Error("任务不存在或已被清理");

        // Sync progress events into UI
        if (Array.isArray(job.events)) {
          setSearchEvents(job.events);
        }
        if (job.status === "searching") setPhase("searching");
        else if (job.status === "generating") setPhase("generating");

        if (job.status === "done") {
          const ok = await loadCachedBundle(topic);
          if (!ok) throw new Error("任务完成但简报内容缺失");
          return;
        }
        if (job.status === "cancelled") {
          // The job was cancelled (either by this client or another tab).
          // Silently stop — the UI will have already navigated away.
          return;
        }
        if (job.status === "error") {
          throw new Error(job.error || "生成任务失败");
        }

        await new Promise((r) => setTimeout(r, interval));
        interval = Math.min(MAX_INTERVAL, interval + 500);
      }
    },
    [loadCachedBundle, topic]
  );

  const startGeneration = useCallback(async () => {
    if (!topic || hasStarted.current) return;
    hasStarted.current = true;

    try {
      // Phase 0: fast path — briefing already cached
      if (await loadCachedBundle(topic)) return;

      // Phase 1: Enqueue a generation job
      setPhase("searching");
      const enqueueRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });

      if (enqueueRes.status === 429) {
        const body = await enqueueRes.json();
        throw new Error(body.message || "并发生成任务已达上限");
      }
      if (!enqueueRes.ok) {
        const body = await enqueueRes.text();
        throw new Error(`无法启动生成任务: ${body.slice(0, 120)}`);
      }
      const data = await enqueueRes.json();

      // If cache was populated between Phase 0 and Phase 1 race, handle it
      if (data.kind === "cached") {
        if (await loadCachedBundle(topic)) return;
      }

      if (data.kind !== "job") {
        throw new Error("未知的任务响应格式");
      }

      // Remember the job ID so the cancel button can act on it
      setActiveJobId(data.job.id);

      // Kick off hero image fetch in parallel (only needs topic)
      fetchHeroImage(topic).then((url) => {
        if (url) {
          setBriefing((prev) => (prev ? { ...prev, heroImageUrl: url } : prev));
        } else {
          setHeroImageFailed(true);
        }
      });

      // Phase 2: poll until done
      await pollJobToCompletion(data.job.id);
    } catch (err) {
      console.error("Generation error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      let hint = msg;
      if (msg.includes("fetch failed") || msg.includes("ETIMEDOUT")) {
        hint = "网络连接不稳定，请稍后重试";
      } else if (msg.includes("429") || msg.includes("rate")) {
        hint = "LLM 服务限流，稍后再试";
      } else if (msg.includes("401") || msg.includes("403")) {
        hint = "LLM API 授权失败";
      }
      setErrorMsg(hint);
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, loadCachedBundle, pollJobToCompletion]);

  useEffect(() => {
    startGeneration();
  }, [startGeneration]);

  const handleCancel = useCallback(async () => {
    if (!activeJobId || cancelling) return;
    setCancelling(true);
    cancelledRef.current = true;
    try {
      await fetch(`/api/jobs/${activeJobId}`, { method: "DELETE" });
    } catch {
      // ignore — job will also auto-expire on server, and we're navigating away
    }
    // Navigate back to homepage with the topic pre-filled so user can edit
    router.push(`/?topic=${encodeURIComponent(topic)}`);
  }, [activeJobId, cancelling, router, topic]);

  const briefingSummary = briefing
    ? `主题：${briefing.topic}\n一句话速览：${briefing.oneLiner}\n维度：${briefing.dimensions
        ?.map((d: DimensionContent) => `${DIMENSION_META[d.key]?.label}: ${d.summary}`)
        .join("\n")}`
    : "";

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
      <div className="flex items-start gap-3 mb-6">
        <button
          onClick={() => router.push("/")}
          className="shrink-0 w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
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
        {/* Top-right action: Cancel while generating, Share when done */}
        <div className="shrink-0">
          {phase !== "done" && phase !== "error" && (
            <button
              onClick={handleCancel}
              disabled={cancelling || !activeJobId}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
              title="取消并回首页修改主题"
            >
              {cancelling ? (
                <>
                  <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  <span>取消中</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <span>取消</span>
                </>
              )}
            </button>
          )}
          {briefing && phase === "done" && (
            <ShareButton topic={topic} oneLiner={briefing.oneLiner} />
          )}
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
          {/* Hero image — object-contain (not cover) so the whole illustration
              stays visible even if Gemini returns a non-16:9 ratio. Click to
              open in a fullscreen lightbox. */}
          {briefing.heroImageUrl ? (
            <button
              type="button"
              onClick={() =>
                setLightbox({ src: briefing.heroImageUrl!, alt: briefing.topic })
              }
              className="block w-full rounded-xl overflow-hidden shadow-sm bg-muted aspect-[16/9] animate-in fade-in zoom-in-95 duration-500 cursor-zoom-in group"
              aria-label="点击放大查看主图"
            >
              <img
                src={briefing.heroImageUrl}
                alt={briefing.topic}
                className="w-full h-full object-contain transition-transform group-hover:scale-[1.02]"
              />
            </button>
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
                onClickImage={(src, alt) => setLightbox({ src, alt })}
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

      {/* Image lightbox */}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
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
