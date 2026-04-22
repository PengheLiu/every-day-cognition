"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";

const FALLBACK_TOPICS = [
  { label: "人工智能", emoji: "🤖" },
  { label: "区块链", emoji: "⛓️" },
  { label: "新能源汽车", emoji: "🔋" },
  { label: "微服务架构", emoji: "🧩" },
  { label: "量子计算", emoji: "⚛️" },
  { label: "基因编辑", emoji: "🧬" },
  { label: "碳中和", emoji: "🌱" },
  { label: "Web3", emoji: "🌐" },
  { label: "大语言模型", emoji: "💬" },
  { label: "芯片半导体", emoji: "💾" },
];

const EMOJI_POOL = ["💡", "🎯", "🚀", "🔥", "⚡", "🌟", "📊", "🎨", "🧪", "📚", "🎭", "🏆"];

function pickEmoji(topic: string): string {
  let hash = 0;
  for (let i = 0; i < topic.length; i++) hash = (hash * 31 + topic.charCodeAt(i)) >>> 0;
  return EMOJI_POOL[hash % EMOJI_POOL.length];
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

interface TrendingItem {
  topic: string;
  count: number;
}
interface HistoryItem {
  topic: string;
  created_at: number;
}
interface ActiveJob {
  id: string;
  topic: string;
  status: string;
  progress_message: string | null;
}

function HomeContent() {
  const searchParams = useSearchParams();
  // Pre-fill with `?topic=X` (e.g. after user cancels and wants to edit)
  const initialTopic = searchParams.get("topic") || "";
  const [topic, setTopic] = useState(initialTopic);
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [blockNotice, setBlockNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      // Put cursor at end if prefilled (easier to edit/append)
      if (initialTopic) {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }, 100);
    (async () => {
      try {
        const [meRes, trendRes, histRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/trending"),
          fetch("/api/history"),
        ]);
        const me = await meRes.json();
        const tr = await trendRes.json();
        const hist = await histRes.json();
        setLoggedIn(!!me.user);
        setTrending(tr.items || []);
        setHistory(hist.items || []);
      } catch {
        setLoggedIn(false);
      }
    })();
    return () => clearTimeout(t);
  }, [initialTopic]);

  // Track the user's currently-running job (server cap is 1). While active,
  // we disable the input + show a banner that links back to the in-progress
  // briefing. Polled every 4s so the UI clears within a few seconds of
  // completion / cancellation.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/jobs?active=true&limit=1");
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const job: ActiveJob | undefined = d.jobs?.[0];
        setActiveJob(job ?? null);
        // If the active topic matches what the user is typing, clear any old
        // "blocked" notice — they're effectively just continuing that job.
        setBlockNotice((prev) =>
          job && job.topic === topic.trim() ? "" : prev
        );
      } catch {
        // ignore — will retry on next tick
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // intentionally re-poll when topic changes so the "matches active" logic
    // re-evaluates without waiting for the next 4s tick
  }, [topic]);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Server cap is 1 active job per user. If a different topic is already
    // running, refuse — surface the active topic so the user can resume it.
    if (activeJob && activeJob.topic !== trimmed) {
      setBlockNotice(
        `已有「${activeJob.topic}」在生成中，请等待完成后再开始新主题`
      );
      return;
    }
    router.push(`/briefing?topic=${encodeURIComponent(trimmed)}`);
  };

  // Trending: if API returns items, use them; otherwise fall back to curated list
  const trendingTopics =
    trending.length > 0
      ? trending.map((t) => ({ label: t.topic, emoji: pickEmoji(t.topic), count: t.count }))
      : FALLBACK_TOPICS.map((t) => ({ ...t, count: 0 }));

  return (
    <main className="flex-1 px-4 py-10">
      <div className="w-full max-w-2xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center space-y-4 pt-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            基于真实大佬观点的认知学习
          </div>
          <h1 className="text-5xl font-bold tracking-tight">
            每天学<span className="text-primary">一个认知</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            几分钟内建立结构化认知框架，让你能和任何领域的人自信对话
          </p>
        </div>

        {/* Active-job banner — shown when user has a job currently running.
            Links back to the in-progress briefing so they can pick up where
            they left off without losing the work. */}
        {activeJob && (
          <Link
            href={`/briefing?topic=${encodeURIComponent(activeJob.topic)}`}
            className="block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 hover:bg-primary/10 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  正在生成「{activeJob.topic}」
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {activeJob.progress_message || "处理中..."}
                </div>
              </div>
              <span className="text-xs text-primary group-hover:translate-x-0.5 transition-transform shrink-0">
                继续查看 →
              </span>
            </div>
          </Link>
        )}

        {/* Search Input */}
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-xl blur-xl opacity-0 group-hover:opacity-50 group-focus-within:opacity-50 transition-opacity" />
          <div className="relative">
            <Input
              ref={inputRef}
              type="text"
              placeholder={
                activeJob
                  ? `等「${activeJob.topic}」生成完才能开新主题`
                  : "你想了解什么领域？例如：微服务架构、量子计算..."
              }
              className="h-16 text-lg px-6 pr-16 rounded-xl shadow-sm border-2 focus:border-primary transition-all bg-white disabled:bg-muted/40 disabled:cursor-not-allowed"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                if (blockNotice) setBlockNotice("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit(topic);
              }}
              disabled={!!activeJob}
            />
            <button
              onClick={() => handleSubmit(topic)}
              disabled={!topic.trim() || !!activeJob}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              aria-label="开始学习这个领域"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          </div>
          {blockNotice && (
            <div className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {blockNotice}
            </div>
          )}
        </div>

        {/* Personal history (logged in users) */}
        {loggedIn && history.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">🕒</span>
                <span className="text-sm font-medium">最近探索</span>
              </div>
              <Link href="/me" className="text-xs text-primary hover:underline">
                查看全部 →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {history.slice(0, 6).map((item) => (
                <button
                  key={`${item.topic}-${item.created_at}`}
                  onClick={() => handleSubmit(item.topic)}
                  className="flex items-center gap-2.5 p-3 rounded-lg border bg-white hover:border-primary hover:shadow-sm transition-all group text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!!activeJob && activeJob.topic !== item.topic}
                >
                  <span className="text-base">{pickEmoji(item.topic)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {item.topic}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatRelative(item.created_at)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Login prompt for guests */}
        {loggedIn === false && (
          <section className="rounded-xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/20 p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">登录后保存你的探索历史</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                随时回看，跨设备同步
              </div>
            </div>
            <Link
              href="/login"
              className="shrink-0 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              登录
            </Link>
          </section>
        )}

        {/* Trending topics */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">🔥</span>
            <span className="text-sm font-medium">
              {trending.length > 0 ? "热门探索" : "试试这些主题"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {trendingTopics.map((t, i) => {
              const blocked = !!activeJob && activeJob.topic !== t.label;
              return (
                <button
                  key={t.label}
                  onClick={() => handleSubmit(t.label)}
                  disabled={blocked}
                  className="group/tag inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-border hover:border-primary hover:text-primary hover:shadow-sm transition-all text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-foreground disabled:hover:shadow-none"
                >
                  <span className="text-base">{t.emoji}</span>
                  <span>{t.label}</span>
                  {t.count > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-0.5">
                      · {t.count}
                    </span>
                  )}
                  {i === 0 && trending.length > 0 && (
                    <span className="text-[10px] text-accent">#1</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Value props */}
        <div className="flex flex-wrap gap-3 justify-center pt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-primary" />
            实时搜索大佬观点
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-accent" />
            7 维度结构化认知
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-primary" />
            1 天内重复访问走缓存
          </span>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </main>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
