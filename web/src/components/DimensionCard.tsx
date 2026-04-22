"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpertQuoteCard } from "./ExpertQuote";
import { DIMENSION_META, type DimensionContent } from "@/lib/types";

const DIMENSION_ICONS: Record<string, string> = {
  concept: "📖",
  mechanism: "⚙️",
  history: "📜",
  ecosystem: "🌐",
  application: "⚡",
  trend: "📈",
  controversy: "⚠️",
};

export function DimensionCard({
  dimension,
  onClickExpert,
  onClickImage,
}: {
  dimension: DimensionContent;
  onClickExpert?: (name: string) => void;
  onClickImage?: (src: string, alt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = DIMENSION_META[dimension.key];
  const icon = DIMENSION_ICONS[dimension.key] || "📌";

  return (
    <Card className="overflow-hidden transition-all hover:shadow-md border-border/60">
      <CardHeader
        className="cursor-pointer select-none pb-3 group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm">
              {icon}
            </span>
            <span>{meta?.label || dimension.key}</span>
          </CardTitle>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-muted-foreground transition-transform group-hover:text-primary ${expanded ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Dimension image — object-contain (not cover) so the whole
            illustration stays visible even when Gemini returns a ratio that
            doesn't match the 16:9 container (otherwise text near the edges
            gets cropped). Click opens a fullscreen lightbox. */}
        {dimension.imageUrl ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClickImage?.(dimension.imageUrl!, meta?.label || dimension.key);
            }}
            className="block w-full rounded-lg overflow-hidden bg-muted aspect-[16/9] flex items-center justify-center cursor-zoom-in group"
            aria-label="点击放大查看"
          >
            <img
              src={dimension.imageUrl}
              alt={meta?.label || dimension.key}
              className="w-full h-full object-contain transition-transform group-hover:scale-[1.02]"
            />
          </button>
        ) : null}

        {/* Summary */}
        <p className="text-sm text-foreground/90 leading-relaxed">
          {dimension.summary}
        </p>

        {/* Expert quotes */}
        {dimension.expertQuotes?.map((quote, i) => (
          <ExpertQuoteCard key={i} quote={quote} onClickPerson={onClickExpert} />
        ))}

        {/* Detail shown on expand */}
        {expanded && dimension.detail && (
          <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line border-t pt-3 mt-2">
            {dimension.detail}
          </div>
        )}

      </CardContent>
    </Card>
  );
}
