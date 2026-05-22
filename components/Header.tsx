"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fp } from "@/lib/format";
import MarketStatus from "./MarketStatus";
import Logo from "./Logo";

type Me = { name: string; cash: number } | null;

export default function Header() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [notifs, setNotifs] = useState(0);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(j => {
      if (j.user) setMe({ name: j.user.name, cash: Number(j.user.cash || 0) });
      else router.replace("/login");
    });
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const r = await fetch("/api/notifications").catch(() => null);
      if (!r || !r.ok || cancelled) return;
      const j = await r.json();
      setNotifs(j.recent?.length || 0);
      for (const n of (j.undelivered || [])) {
        showBrowserPush(n.title, n.body);
        showToast(n.title, n.body);
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window
        && Notification.permission === "default")
      Notification.requestPermission().catch(() => {});
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!me) return null;
  return (
    <header className="flex items-center justify-between py-4 mb-6 border-b border-border1 gap-3">
      <Logo size="sm" showTagline />
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <MarketStatus />
        <span className="pill-muted font-mono text-[11px] sm:text-[11px]">{fp(me.cash)}</span>
        {notifs > 0 && <span className="pill-mint">🔔 {notifs}</span>}
        <span className="pill-muted hidden sm:inline-flex">{me.name}</span>
        <button onClick={signOut}
                className="flex items-center gap-1 text-muted hover:text-red transition-colors ml-0.5 sm:ml-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
               strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 sm:hidden">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="hidden sm:inline text-[12px]">Sign out</span>
        </button>
      </div>
    </header>
  );
}

function showBrowserPush(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "/favicon.ico" }); } catch {}
}

function showToast(title: string, body: string) {
  if (typeof window === "undefined") return;
  const el = document.createElement("div");
  el.className =
    "fixed top-6 right-6 z-50 max-w-sm bg-card border border-border2 rounded-lg p-4";
  el.style.cssText += "animation:slideIn .25s ease-out;box-shadow:0 8px 24px -8px rgba(0,0,0,.5)";
  el.innerHTML =
    `<div class="text-sm font-semibold text-ink mb-1">${esc(title)}</div>` +
    `<div class="text-xs text-ink2">${esc(body)}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, c => (({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"} as any)[c]));
}
