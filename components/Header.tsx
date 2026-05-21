"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fp } from "@/lib/format";
import MarketStatus from "./MarketStatus";

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
    <header className="flex items-center justify-between py-4 mb-6 border-b border-border1">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-mint/15 border border-mint/30 flex items-center justify-center">
          <span className="text-mint text-[15px] font-bold leading-none">V</span>
        </div>
        <div>
          <div className="font-vaelor text-[20px] leading-none">VAELOR</div>
          <div className="text-[9px] text-muted leading-none mt-1 tracking-[0.3em] uppercase">Portfolio Agent</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <MarketStatus />
        <span className="pill-muted font-mono">{fp(me.cash)}</span>
        {notifs > 0 && <span className="pill-mint">🔔 {notifs}</span>}
        <span className="pill-muted">{me.name}</span>
        <button onClick={signOut}
                className="text-[12px] text-muted hover:text-red transition-colors ml-1">
          Sign out
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
