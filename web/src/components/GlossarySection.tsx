import type { GlossaryItem } from "@/lib/types";

export function GlossarySection({ items }: { items: GlossaryItem[] }) {
  if (!items?.length) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
          📚
        </span>
        <h3 className="font-semibold">关键术语表</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {items.length} 个术语
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-lg bg-muted/40 p-3 space-y-1 hover:bg-muted/60 transition-colors"
          >
            <div className="text-sm font-semibold text-foreground">
              {item.term}
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {item.definition}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
