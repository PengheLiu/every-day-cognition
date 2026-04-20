import type { DialogueTip } from "@/lib/types";

export function DialogueTipsSection({ tips }: { tips: DialogueTip[] }) {
  if (!tips?.length) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
          🎯
        </span>
        <h3 className="font-semibold">对话锦囊</h3>
      </div>
      <div className="space-y-4">
        {tips.map((tip, i) => (
          <div key={i} className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
              {tip.scenario}
            </div>
            <ul className="space-y-1.5 ml-2">
              {tip.questions.map((q, j) => (
                <li
                  key={j}
                  className="text-sm text-foreground/90 flex items-start gap-2 leading-relaxed"
                >
                  <span className="text-accent mt-1 shrink-0">▸</span>
                  <span>&ldquo;{q}&rdquo;</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
