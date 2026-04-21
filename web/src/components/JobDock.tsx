"use client";

/**
 * Floating bottom-right dock showing the user's currently-running briefing
 * generation jobs. Click an item to jump to the corresponding briefing page.
 * Polls /api/jobs?active=true every 3 seconds.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface JobSummary {
  id: string;
  topic: string;
  status: "pending" | "searching" | "generating" | "done" | "error" | "cancelled";
  progress_message: string | null;
  created_at: number;
  updated_at: number;
  error: string | null;
}

const POLL_INTERVAL = 3000;
const RECENT_DONE_WINDOW_MS = 30 * 1000; // keep "done" jobs visible for 30s after completion

export function JobDock() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [recentlyCompleted, setRecentlyCompleted] = useState<JobSummary[]>([]);
  // IDs of jobs the user cancelled from this dock — never re-display them
  const [dismissedIds] = useState<Set<string>>(() => new Set<string>());
  // Mirror of `jobs` state held in a ref, so we can compute disappearance
  // diffs outside of `setJobs` callbacks (which React Strict Mode invokes
  // twice in dev, causing the promotion side-effect to fire twice).
  const prevJobsRef = useRef<JobSummary[]>([]);
  // Guard so we never promote the same job ID twice even if poll races.
  const promotedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;

    const pollOnce = async () => {
      try {
        const res = await fetch("/api/jobs?active=true&limit=20");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        const activeNow: JobSummary[] = data.jobs || [];

        // Compute disappearance diff from the ref, not inside setJobs, so
        // Strict-Mode's double-invoke of functional updaters does not trigger
        // the promotion side effect twice.
        const prev = prevJobsRef.current;
        const nowIds = new Set(activeNow.map((j) => j.id));
        const disappeared = prev.filter(
          (j) => !nowIds.has(j.id) && !promotedIdsRef.current.has(j.id)
        );
        prevJobsRef.current = activeNow;
        setJobs(activeNow);

        if (disappeared.length > 0) {
          // Mark immediately to prevent race-condition double-promotion
          disappeared.forEach((j) => promotedIdsRef.current.add(j.id));

          const full = await fetch("/api/jobs?limit=10")
            .then((r) => r.json())
            .catch(() => null);
          if (!mounted || !full) return;

          const map = new Map<string, JobSummary>(
            (full.jobs || []).map((j: JobSummary) => [j.id, j])
          );
          const resolved = disappeared
            .map((d) => map.get(d.id))
            .filter(
              (j): j is JobSummary =>
                !!j && j.status !== "cancelled" // hide cancelled entirely
            );
          if (resolved.length > 0) {
            setRecentlyCompleted((rc) => {
              // De-dupe by id (belt and suspenders)
              const existingIds = new Set(rc.map((x) => x.id));
              const additions = resolved.filter((r) => !existingIds.has(r.id));
              return [...additions, ...rc].slice(0, 3);
            });
            setTimeout(() => {
              if (!mounted) return;
              setRecentlyCompleted((rc) =>
                rc.filter((j) => !resolved.some((r) => r.id === j.id))
              );
            }, RECENT_DONE_WINDOW_MS);
          }
        }
      } catch {
        /* ignore transient errors */
      }
    };

    const loop = async () => {
      await pollOnce();
      if (!mounted) return;
      timer = setTimeout(loop, POLL_INTERVAL);
    };
    loop();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const visible = [...jobs, ...recentlyCompleted].filter(
    (j) => !dismissedIds.has(j.id)
  );
  if (visible.length === 0) return null;

  const handleItemCancelled = (id: string) => {
    dismissedIds.add(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setRecentlyCompleted((prev) => prev.filter((j) => j.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)]">
      <div className="rounded-xl border bg-white shadow-lg overflow-hidden">
        {/* Header — always visible */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 border-b bg-muted/30 hover:bg-muted/60 transition-colors"
        >
          <div className="relative">
            {jobs.length > 0 ? (
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <span className="text-sm">✓</span>
            )}
          </div>
          <span className="text-sm font-medium flex-1 text-left">
            {jobs.length > 0
              ? `正在生成 ${jobs.length} 个简报`
              : `${visible.length} 个任务刚完成`}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-muted-foreground transition-transform ${collapsed ? "" : "rotate-180"}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* Job list */}
        {!collapsed && (
          <ul className="divide-y max-h-80 overflow-y-auto">
            {visible.map((job) => (
              <JobDockItem
                key={job.id}
                job={job}
                onCancelled={handleItemCancelled}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function JobDockItem({
  job,
  onCancelled,
}: {
  job: JobSummary;
  onCancelled: (id: string) => void;
}) {
  const isDone = job.status === "done";
  const isError = job.status === "error" || job.status === "cancelled";
  const isActive = job.status === "pending" || job.status === "searching" || job.status === "generating";
  const statusLabel = {
    pending: "排队中",
    searching: "搜索中",
    generating: "生成中",
    done: "已完成",
    error: "失败",
    cancelled: "已取消",
  }[job.status];

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Optimistically remove from UI immediately — no waiting for next poll,
    // no "已取消" flash.
    onCancelled(job.id);
    try {
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    } catch {
      /* ignore — server will also auto-expire */
    }
  };

  return (
    <li className="relative group/item">
      <Link
        href={`/briefing?topic=${encodeURIComponent(job.topic)}`}
        className="block px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{job.topic}</div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {job.progress_message || statusLabel}
            </div>
            {isError && job.error && (
              <div className="text-[11px] text-destructive truncate mt-0.5">
                {job.error}
              </div>
            )}
          </div>
          <span
            className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${
              isDone
                ? "bg-green-100 text-green-700"
                : isError
                ? "bg-red-100 text-red-700"
                : "bg-primary/10 text-primary"
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </Link>

      {/* Cancel button, only on active jobs; visible on hover */}
      {isActive && (
        <button
          onClick={handleCancel}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors opacity-0 group-hover/item:opacity-100"
          aria-label="取消生成"
          title="取消生成"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </li>
  );
}
