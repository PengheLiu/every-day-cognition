"use client";

import type { SearchProgressEvent, ExpertInfo } from "@/lib/types";

const PHASE_META = {
  searching: { icon: "🔍", label: "正在搜索领域专家和真实观点", hint: "从博客、访谈、演讲、播客中提取" },
  generating: { icon: "🧠", label: "正在生成结构化认知简报", hint: "融合 7 维度 + 大佬引用" },
  done: { icon: "✓", label: "完成", hint: "" },
};

export function GeneratingStatus({
  events,
  phase,
}: {
  events: SearchProgressEvent[];
  phase: "searching" | "generating" | "done";
}) {
  const meta = PHASE_META[phase];
  const discoveredExperts = events
    .filter((e) => e.expert)
    .map((e) => e.expert!)
    .filter((e, i, arr) => arr.findIndex((x) => x.name === e.name) === i);

  const quotesFound = events
    .filter((e) => e.quotesFound !== undefined)
    .reduce((sum, e) => sum + (e.quotesFound || 0), 0);

  return (
    <div className="w-full space-y-6 py-8">
      {/* Phase indicator */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
          {phase !== "done" && (
            <div className="absolute inset-0 rounded-xl border-2 border-primary/30 border-t-primary animate-spin" />
          )}
          <span className="text-xl">{meta.icon}</span>
        </div>
        <div className="flex-1 pt-1">
          <p className="font-medium text-foreground">{meta.label}</p>
          {meta.hint && <p className="text-xs text-muted-foreground mt-0.5">{meta.hint}</p>}
        </div>
      </div>

      {/* Stats */}
      {(discoveredExperts.length > 0 || quotesFound > 0) && (
        <div className="flex items-center gap-6 text-sm">
          {discoveredExperts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-primary font-semibold tabular-nums">{discoveredExperts.length}</span>
              <span className="text-muted-foreground">位专家</span>
            </div>
          )}
          {quotesFound > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-accent font-semibold tabular-nums">{quotesFound}</span>
              <span className="text-muted-foreground">条观点</span>
            </div>
          )}
        </div>
      )}

      {/* Expert chips */}
      {discoveredExperts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {discoveredExperts.map((expert) => (
            <ExpertChip
              key={expert.name}
              expert={expert}
              found={events.some((e) => e.expert?.name === expert.name && e.quotesFound !== undefined && e.quotesFound > 0)}
            />
          ))}
        </div>
      )}

      {/* Latest event log (last 3) */}
      <div className="space-y-1.5 min-h-[60px]">
        {events.slice(-3).reverse().map((event, i) => (
          <div
            key={`${events.length - i}`}
            className="text-xs text-muted-foreground flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-300"
            style={{ opacity: 1 - i * 0.3 }}
          >
            <EventDot type={event.type} />
            <span className="truncate">{event.message}</span>
          </div>
        ))}
      </div>

      {/* Skeleton preview of briefing */}
      {phase === "generating" && (
        <div className="space-y-3 pt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="h-4 shimmer-bg rounded w-1/3" />
              <div className="h-3 shimmer-bg rounded w-full" />
              <div className="h-3 shimmer-bg rounded w-4/5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpertChip({ expert, found }: { expert: ExpertInfo; found: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-all animate-in fade-in zoom-in-95 duration-300 ${
        found
          ? "bg-primary/10 text-primary ring-1 ring-primary/20"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          found ? "bg-primary text-primary-foreground" : "bg-background pulse-soft"
        }`}
      >
        {expert.name[0]}
      </div>
      <span className="font-medium">{expert.name}</span>
      {found && <span className="text-[10px]">✓</span>}
    </div>
  );
}

function EventDot({ type }: { type: string }) {
  const colors: Record<string, string> = {
    identifying_experts: "bg-primary",
    searching_expert: "bg-accent",
    extracting_quotes: "bg-amber-500",
  };
  return <span className={`w-1 h-1 rounded-full shrink-0 ${colors[type] || "bg-muted-foreground"}`} />;
}
