"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface HistoryItem {
  topic: string;
  created_at: number;
}

interface Me {
  id: string;
  phone: string;
  nickname: string | null;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export default function MePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, histRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/history"),
        ]);
        const meData = await meRes.json();
        const histData = await histRes.json();
        setMe(meData.user);
        setHistory(histData.items || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">请先登录查看个人历史</p>
          <Link
            href="/login?next=/me"
            className="inline-block px-5 py-2 rounded-lg bg-primary text-primary-foreground"
          >
            前往登录
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
      {/* Profile header */}
      <div className="rounded-xl border bg-card p-5 mb-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-lg font-semibold">
          {(me.nickname?.trim()?.[0] || me.phone.slice(-2, -1)).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">
            {me.nickname?.trim() || me.phone.slice(0, 3) + "****" + me.phone.slice(7)}
          </div>
          <div className="text-xs text-muted-foreground">
            {me.phone.slice(0, 3) + "****" + me.phone.slice(7)} · 共探索过 {history.length} 个领域
          </div>
        </div>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/");
          }}
          className="text-sm text-muted-foreground hover:text-destructive transition-colors"
        >
          退出登录
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            📚
          </span>
          <h2 className="font-semibold">我的探索历史</h2>
          <span className="text-xs text-muted-foreground ml-auto">
            {history.length} 条
          </span>
        </div>

        {history.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center space-y-3">
            <p className="text-muted-foreground text-sm">
              还没有探索过任何领域
            </p>
            <Link
              href="/"
              className="inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
            >
              去首页探索
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((item, i) => (
              <Link
                key={`${item.topic}-${item.created_at}-${i}`}
                href={`/briefing?topic=${encodeURIComponent(item.topic)}`}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary hover:shadow-sm transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {item.topic}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelative(item.created_at)}
                  </div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/50 group-hover:text-primary transition-colors">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
