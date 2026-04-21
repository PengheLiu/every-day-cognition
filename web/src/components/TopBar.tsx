"use client";

import Link from "next/link";
import { UserChip } from "./UserChip";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 w-full bg-background/85 backdrop-blur border-b">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold">
            🧠
          </div>
          <span className="font-semibold group-hover:text-primary transition-colors">
            认知学习
          </span>
        </Link>
        <UserChip />
      </div>
    </header>
  );
}
