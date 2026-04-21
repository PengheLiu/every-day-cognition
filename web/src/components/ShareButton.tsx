"use client";

import { useState } from "react";

/**
 * Share button for the briefing page.
 *   - Mobile: uses navigator.share (native share sheet on iOS/Android)
 *   - Desktop / no Web Share API: copies canonical URL to clipboard + toast
 *
 * The shared URL is the current briefing URL itself (/briefing?topic=X).
 * Since briefings are cached server-side for 1 day, any recipient opening
 * the link within that window gets the same content instantly.
 */
export function ShareButton({
  topic,
  oneLiner,
}: {
  topic: string;
  oneLiner?: string;
}) {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const title = `认知学习：${topic}`;
    const text = oneLiner
      ? `${oneLiner}\n\n来自认知学习`
      : `和我一起了解「${topic}」—— 来自认知学习`;

    // Prefer native share sheet
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & {
          share: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
        }).share({ title, text, url });
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    // Fallback: clipboard
    try {
      await navigator.clipboard.writeText(url);
      showToast("链接已复制");
    } catch {
      // Last resort: show URL in prompt (uncommon)
      showToast("复制失败，请手动复制地址栏链接");
    }
  };

  return (
    <>
      <button
        onClick={handleShare}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border bg-white hover:border-primary hover:text-primary transition-colors text-sm"
        aria-label="分享"
        title="分享这份简报"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span>分享</span>
      </button>

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-foreground text-background text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
          role="status"
        >
          {toast}
        </div>
      )}
    </>
  );
}
