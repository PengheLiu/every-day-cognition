"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Me {
  id: string;
  phone: string;
  nickname: string | null;
}

export function UserChip() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = loading
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Refresh auth state on mount AND when pathname changes (so navigating back
  // from /login or /me picks up the latest session)
  useEffect(() => {
    refresh();
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-user-chip]")) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const refresh = async () => {
    try {
      const r = await fetch("/api/auth/me");
      const d = await r.json();
      setMe(d.user);
    } catch {
      setMe(null);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    setOpen(false);
    // Hard reload so any page-level data (history, me page) resets
    window.location.href = "/";
  };

  if (me === undefined) {
    return (
      <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
    );
  }

  if (!me) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground transition-colors text-sm"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" x2="3" y1="12" y2="12" />
        </svg>
        登录
      </Link>
    );
  }

  // Prefer the nickname for display; fall back to a masked phone for legacy
  // accounts created before the nickname field existed.
  const displayName =
    me.nickname?.trim() || me.phone.slice(0, 3) + "****" + me.phone.slice(7);
  // Avatar initial: first character of the nickname (or first phone digit).
  const initial = (me.nickname?.trim()?.[0] || me.phone.slice(-2, -1)).toUpperCase();

  return (
    <div className="relative" data-user-chip>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-full hover:bg-muted transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
          {initial}
        </div>
        <span className="text-sm text-foreground hidden sm:inline max-w-[8rem] truncate">
          {displayName}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border bg-white shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <Link
            href="/me"
            className="block px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            📚 我的历史
          </Link>
          <div className="border-t my-1" />
          <button
            onClick={handleLogout}
            className="w-full text-left block px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
