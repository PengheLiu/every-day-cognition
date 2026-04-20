"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Input } from "@/components/ui/input";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") {
      setTimeout(() => codeInputRef.current?.focus(), 100);
    }
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSendCode = async () => {
    setError("");
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError("请输入 11 位大陆手机号");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "发送失败");
        return;
      }
      setStep("code");
      setCooldown(60);
      setNotice(data.message || "验证码已发送");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSending(false);
    }
  };

  const handleLogin = async () => {
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("验证码应为 6 位数字");
      return;
    }
    setLoggingIn(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
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
      setLoggingIn(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 space-y-5 shadow-sm">
        <div className="text-center space-y-1">
          <div className="text-3xl">🧠</div>
          <h1 className="text-xl font-bold">登录认知对齐</h1>
          <p className="text-xs text-muted-foreground">开发环境：验证码固定为 123456</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">手机号</label>
            <Input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              placeholder="13800138000"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              disabled={step === "code"}
              className="h-11"
              onKeyDown={(e) => {
                if (e.key === "Enter" && step === "phone") handleSendCode();
              }}
            />
          </div>

          {step === "code" && (
            <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">验证码</label>
                <button
                  onClick={handleSendCode}
                  disabled={cooldown > 0 || sending}
                  className="text-xs text-primary disabled:text-muted-foreground"
                >
                  {cooldown > 0 ? `${cooldown}s 后可重发` : "重新发送"}
                </button>
              </div>
              <Input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 位数字"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="h-11 tracking-widest"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
              />
              {notice && <p className="text-xs text-primary">{notice}</p>}
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        {step === "phone" ? (
          <button
            onClick={handleSendCode}
            disabled={sending || !phone}
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {sending ? "发送中..." : "获取验证码"}
          </button>
        ) : (
          <button
            onClick={handleLogin}
            disabled={loggingIn || code.length !== 6}
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loggingIn ? "登录中..." : "登录"}
          </button>
        )}

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
