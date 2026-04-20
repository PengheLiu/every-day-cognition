"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ca_pwa_install_dismissed_at";
const DISMISS_TTL_DAYS = 7;

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Register service worker (production only — in dev it prevents seeing fresh code)
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("SW register failed:", err));
    } else if (!isProd && "serviceWorker" in navigator) {
      // Dev: unregister any previously-registered SW so latest code always shows
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
    }

    // Check if already installed (standalone mode)
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari legacy
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    // Detect iOS (Safari on iPhone/iPad) — separate flow since no beforeinstallprompt
    const ua = window.navigator.userAgent;
    const ios =
      /iPad|iPhone|iPod/.test(ua) &&
      !/CriOS|FxiOS|EdgiOS/.test(ua); // Only show for Safari, not Chrome/Firefox on iOS
    setIsIOS(ios);

    // Recently-dismissed check
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const ageMs = Date.now() - parseInt(dismissedAt, 10);
      if (ageMs < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000) {
        setDismissed(true);
        return;
      }
    }

    // Capture install prompt event (Android / desktop Chrome)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    const onAppInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onAppInstalled);

    // For iOS, show hint after a short delay (give user time to orient)
    if (ios) {
      const t = setTimeout(() => setShowIOSHint(true), 3000);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
        window.removeEventListener("appinstalled", onAppInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
    setShowIOSHint(false);
  };

  // Don't render if already installed or recently dismissed
  if (installed || dismissed) return null;

  // Android / desktop Chrome install banner
  if (deferredPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 rounded-xl border bg-white shadow-xl p-4 z-40 animate-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-lg">
            🧠
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-semibold">添加到主屏幕</p>
            <p className="text-xs text-muted-foreground">
              每日使用更方便，像 App 一样启动
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 w-6 h-6 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleInstall}
            className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            安装
          </button>
          <button
            onClick={handleDismiss}
            className="px-4 h-9 rounded-lg border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            稍后
          </button>
        </div>
      </div>
    );
  }

  // iOS manual install hint
  if (isIOS && showIOSHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 rounded-xl border bg-white shadow-xl p-4 z-40 animate-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-lg">
            🧠
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="text-sm font-semibold">添加到主屏幕</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              在 Safari 底部点{" "}
              <span className="inline-block align-middle text-base">⬆️</span> 分享按钮，
              然后选择「添加到主屏幕」。
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 w-6 h-6 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return null;
}
