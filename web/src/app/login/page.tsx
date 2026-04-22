"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

function LoginContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = nickname.trim().length > 0 && /^1[3-9]\d{9}$/.test(phone);

  const handleSubmit = async () => {
    setError("");
    if (!nickname.trim()) {
      setError("请填写昵称");
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError("请输入 11 位大陆手机号");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, nickname: nickname.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        return;
      }
      // Hard navigation so TopBar/UserChip remounts and reads the new session
      window.location.href = next;
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 space-y-5 shadow-sm">
        <div className="text-center space-y-1">
          <div className="text-3xl">🧠</div>
          <h1 className="text-xl font-bold">登录认知学习</h1>
          <p className="text-xs text-muted-foreground">填写昵称和手机号即可开始使用</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">昵称</label>
            <Input
              type="text"
              maxLength={20}
              placeholder="想被怎么称呼"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="h-11"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit();
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">手机号</label>
            <Input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              placeholder="13800138000"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              className="h-11"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit();
              }}
            />
          </div>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {submitting ? "登录中..." : "登录"}
        </button>

        <p className="text-[11px] text-center text-muted-foreground">
          登录即表示同意我们的服务条款与隐私政策
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <LoginContent />
    </Suspense>
  );
}
