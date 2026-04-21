"use client";

import { useEffect, useState } from "react";
import type { ExpertInfo, ExpertDetail } from "@/lib/types";

export function ExpertDetailModal({
  expert,
  topic,
  onClose,
}: {
  expert: ExpertInfo;
  topic: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/expert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: expert.name,
            englishName: expert.englishName,
            title: expert.title,
            org: expert.org,
            englishOrg: expert.englishOrg,
            topic,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ExpertDetail;
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expert.name, expert.englishName, expert.title, expert.org, topic]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />
      {/* Panel — right-side drawer on desktop, bottom sheet on mobile */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b bg-gradient-to-br from-primary/5 to-accent/5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-base font-bold text-primary shrink-0">
                {expert.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold truncate">
                  {expert.name}
                </div>
                {expert.englishName && (
                  <div className="text-xs text-muted-foreground truncate">
                    {expert.englishName}
                  </div>
                )}
                <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {detail?.currentTitle ||
                    `${expert.title}${expert.org && expert.org !== "未知" ? " · " + expert.org : ""}`}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="关闭"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Quick external links — Scholar front-and-center */}
          <HeaderQuickLinks
            name={expert.name}
            englishName={expert.englishName}
            org={expert.org}
            scholarProfileUrl={detail?.scholarProfileUrl}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <ExpertSkeleton />}

          {error && !loading && (
            <div className="text-sm text-muted-foreground">
              加载失败：{error}
            </div>
          )}

          {detail && !loading && (
            <>
              {/* Disambiguation warning if search couldn't confirm identity */}
              {detail.disambiguation && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
                    <span>⚠️</span>
                    <span>未能确认身份</span>
                  </div>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    {detail.disambiguation}
                  </p>
                  <p className="text-[11px] text-amber-700/80">
                    建议：这可能是简报识别阶段的误判，或公开信息较少。点击顶部的专家名字可去搜索引擎进一步查证。
                  </p>
                </div>
              )}

              {/* Why this person matters */}
              {expert.reason && (
                <Section title="为什么重要" icon="⭐">
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {expert.reason}
                  </p>
                </Section>
              )}

              {/* Biography */}
              {detail.biography && (
                <Section title="生平简介" icon="📖">
                  <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                    {detail.biography}
                  </p>
                </Section>
              )}

              {/* Current status */}
              {detail.currentStatus && (
                <Section title="现状" icon="📍">
                  <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                    {detail.currentStatus}
                  </p>
                </Section>
              )}

              {/* Company / org */}
              {detail.companyInfo && (
                <Section title="所在机构" icon="🏛️">
                  <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                    {detail.companyInfo}
                  </p>
                </Section>
              )}

              {/* Notable works */}
              {detail.notableWorks && detail.notableWorks.length > 0 && (
                <Section title="代表作与成就" icon="🏆">
                  <ul className="space-y-1.5">
                    {detail.notableWorks.map((w, i) => (
                      <li
                        key={i}
                        className="text-sm text-foreground/90 flex items-start gap-2"
                      >
                        <span className="text-accent mt-1 shrink-0">▸</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Recent updates */}
              {detail.recentUpdates && detail.recentUpdates.length > 0 && (
                <Section title="近期动态" icon="🗞️">
                  <div className="space-y-3">
                    {detail.recentUpdates.map((u, i) => (
                      <div
                        key={i}
                        className="rounded-lg border p-3 space-y-1 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium leading-snug">
                            {u.title}
                          </div>
                          {u.date && (
                            <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                              {u.date}
                            </span>
                          )}
                        </div>
                        {u.summary && (
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {u.summary}
                          </p>
                        )}
                        {u.sourceUrl && (
                          <a
                            href={u.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline mt-0.5"
                          >
                            查看原文
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M7 7h10v10" />
                              <path d="M7 17 17 7" />
                            </svg>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Extended external search (less common engines, below-the-fold) */}
              <Section title="更多检索" icon="🔎">
                <ExternalSearchLinks
                  name={expert.name}
                  englishName={expert.englishName}
                />
              </Section>

              {/* Links (LLM-extracted, specific URLs) */}
              {detail.links && detail.links.length > 0 && (
                <Section title="推荐关注" icon="🔗">
                  <div className="flex flex-wrap gap-2">
                    {detail.links.map((l, i) => (
                      <a
                        key={i}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-muted hover:bg-primary hover:text-primary-foreground transition-colors"
                      >
                        {l.label}
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M7 7h10v10" />
                          <path d="M7 17 17 7" />
                        </svg>
                      </a>
                    ))}
                  </div>
                </Section>
              )}

              {/* Empty state */}
              {!detail.biography &&
                !detail.currentStatus &&
                !detail.notableWorks?.length &&
                !detail.recentUpdates?.length && (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    暂未能找到该专家的详细公开信息。
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}

/** Scholar query helpers */
function scholarQueryFor(name: string, englishName?: string): string {
  return englishName?.trim() || name;
}

/**
 * Build a Scholar AUTHOR search URL (not article search).
 * Lands on a list of matching authors with avatar/affiliation/citations,
 * letting the user one-click into the right person's profile.
 * Including org keyword in mauthors greatly improves match precision.
 */
function scholarAuthorSearchUrl(
  name: string,
  englishName?: string,
  org?: string
): string {
  const base = englishName?.trim() || name;
  // Strip Chinese chars from org for Scholar search (mostly Latin index)
  const orgKey = org && org !== "未知" ? org.replace(/[\u4e00-\u9fa5]/g, " ").trim() : "";
  const query = orgKey ? `${base} ${orgKey}` : base;
  return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(query)}&hl=en`;
}

/** Prominent header quick-links row. Scholar = personal profile if found, else author search. */
function HeaderQuickLinks({
  name,
  englishName,
  org,
  scholarProfileUrl,
}: {
  name: string;
  englishName?: string;
  org?: string;
  scholarProfileUrl?: string;
}) {
  const query = scholarQueryFor(name, englishName);
  const webQuery = englishName?.trim() ? `${englishName} ${name}` : name;

  const hasProfile = !!scholarProfileUrl;
  // When we have the actual Scholar profile, that's the one authoritative
  // link the user needs — fuzzy searches (Google/X) add noise, so hide them.
  const primary: { label: string; icon: string; url: string; tooltip: string; star?: boolean }[] = hasProfile
    ? [
        {
          label: "Scholar 主页",
          icon: "🎓",
          url: scholarProfileUrl!,
          tooltip: `${name} 的 Google Scholar 个人主页`,
          star: true,
        },
      ]
    : [
        {
          label: "Scholar 作者",
          icon: "🎓",
          url: scholarAuthorSearchUrl(name, englishName, org),
          tooltip: `在 Google Scholar 作者库搜索 ${query}${org ? ` · ${org}` : ""}（点开后选择对应作者即可进入主页）`,
        },
        {
          label: "Google",
          icon: "🔍",
          url: `https://www.google.com/search?q=${encodeURIComponent(webQuery)}`,
          tooltip: `在 Google 搜索 ${webQuery}`,
        },
        {
          label: "X",
          icon: "𝕏",
          url: `https://x.com/search?q=${encodeURIComponent(query)}&f=user`,
          tooltip: `在 X / Twitter 搜索 ${query}`,
        },
      ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {primary.map((l, i) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
            i === 0
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-white border hover:border-primary hover:text-primary"
          }`}
          title={l.tooltip}
        >
          {l.star && <span className="text-[9px] leading-none">✓</span>}
          <span className="text-xs leading-none">{l.icon}</span>
          <span>{l.label}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-70"
          >
            <path d="M7 7h10v10" />
            <path d="M7 17 17 7" />
          </svg>
        </a>
      ))}
    </div>
  );
}

/** Secondary external search engines (extended set, below-the-fold). */
function ExternalSearchLinks({
  name,
  englishName,
}: {
  name: string;
  englishName?: string;
}) {
  const query = scholarQueryFor(name, englishName);

  const links: { label: string; icon: string; url: string }[] = [
    {
      label: "Wikipedia",
      icon: "📖",
      url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`,
    },
    {
      label: "百度学术",
      icon: "📚",
      url: `https://xueshu.baidu.com/s?wd=${encodeURIComponent(name)}`,
    },
    {
      label: "知乎",
      icon: "知",
      url: `https://www.zhihu.com/search?type=people&q=${encodeURIComponent(name)}`,
    },
    {
      label: "LinkedIn",
      icon: "in",
      url: `https://www.google.com/search?q=${encodeURIComponent(query + " site:linkedin.com")}`,
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-muted text-foreground hover:bg-primary hover:text-primary-foreground transition-all"
          title={`在 ${l.label} 搜索 ${query}`}
        >
          <span className="text-sm leading-none">{l.icon}</span>
          <span>{l.label}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-60"
          >
            <path d="M7 7h10v10" />
            <path d="M7 17 17 7" />
          </svg>
        </a>
      ))}
    </div>
  );
}

function ExpertSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-4 shimmer-bg rounded w-1/3" />
        <div className="h-3 shimmer-bg rounded w-full" />
        <div className="h-3 shimmer-bg rounded w-5/6" />
        <div className="h-3 shimmer-bg rounded w-4/6" />
      </div>
      <div className="space-y-2">
        <div className="h-4 shimmer-bg rounded w-1/4" />
        <div className="h-3 shimmer-bg rounded w-full" />
        <div className="h-3 shimmer-bg rounded w-3/4" />
      </div>
      <div className="space-y-2">
        <div className="h-4 shimmer-bg rounded w-1/3" />
        <div className="h-16 shimmer-bg rounded w-full" />
      </div>
    </div>
  );
}
