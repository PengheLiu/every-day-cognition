import type { ExpertQuote as ExpertQuoteType } from "@/lib/types";

const SOURCE_ICONS: Record<string, string> = {
  博客: "📝",
  播客: "🎙️",
  演讲: "🎤",
  采访: "💬",
  访谈: "💬",
  论文: "📄",
  书籍: "📚",
  新闻报道: "📰",
  新闻: "📰",
  X: "𝕏",
  Twitter: "𝕏",
  知乎: "知",
  微博: "微",
  YouTube: "▶",
  社交媒体: "💬",
};

export function ExpertQuoteCard({
  quote,
  onClickPerson,
}: {
  quote: ExpertQuoteType;
  onClickPerson?: (name: string) => void;
}) {
  const sourceIcon = SOURCE_ICONS[quote.sourceType] || "🔗";
  const clickable = !!onClickPerson;

  return (
    <div className="my-3 rounded-lg border-l-4 border-primary bg-gradient-to-br from-primary/5 to-accent/5 p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => clickable && onClickPerson!(quote.personName)}
          disabled={!clickable}
          className={`flex items-center gap-2 text-left ${
            clickable ? "hover:opacity-80 cursor-pointer" : "cursor-default"
          } transition-opacity`}
          title={clickable ? "查看专家详情" : undefined}
        >
          <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
            {quote.personName[0]}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">
              {quote.personName}
            </span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {quote.personTitle}
            </span>
          </div>
        </button>
      </div>

      <blockquote className="text-sm text-foreground/90 italic leading-relaxed pl-1">
        &ldquo;{quote.quote}&rdquo;
      </blockquote>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span>{sourceIcon}</span>
          <span>{quote.sourceType}</span>
          {quote.sourceDate && (
            <>
              <span>·</span>
              <span>{quote.sourceDate}</span>
            </>
          )}
        </span>
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline flex items-center gap-0.5"
          >
            查看原文
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 7h10v10" />
              <path d="M7 17 17 7" />
            </svg>
          </a>
        )}
      </div>

      {quote.aiInterpretation && (
        <div className="text-[11px] text-muted-foreground bg-white/60 rounded p-2 border border-border/40">
          <span className="font-medium text-primary">💡 解读：</span>
          {quote.aiInterpretation}
        </div>
      )}
    </div>
  );
}
