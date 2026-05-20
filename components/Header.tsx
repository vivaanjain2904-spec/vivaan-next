"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fp } from "@/lib/format";

type Me = { name: string; cash: number } | null;

export default function Header() {
  const router = useRouter();
  const [me, setMe]       = useState<Me>(null);
  const [notifs, setNotifs] = useState(0);
  const [now, setNow]     = useState("");

  // Initial /me fetch
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(j => {
      if (j.user) setMe({ name: j.user.name, cash: Number(j.user.cash || 0) });
      else router.replace("/login");
    });
  }, [router]);

  // Time
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date().toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Poll undelivered notifications -> toast + browser push
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const r = await fetch("/api/notifications").catch(() => null);
      if (!r || !r.ok || cancelled) return;
      const j = await r.json();
      setNotifs(j.recent?.length || 0);
      const newOnes = j.undelivered || [];
      for (const n of newOnes) {
        showBrowserPush(n.title, n.body);
        showToast(n.title, n.body);
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Ask browser permission once
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window
        && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!me) return null;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-6 border-b border-border1 relative">
      <div className="absolute -bottom-px left-0 w-32 h-px bg-gradient-to-r from-mint to-transparent" />
      <div className="font-extrabold tracking-[.24em] uppercase text-base sm:text-lg"
           style={{ background: "linear-gradient(135deg,#3ff5a0,#22c46e)",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    filter: "drop-shadow(0 0 18px rgba(63,245,160,.45))" }}>
        VIVAAN.IO
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="pill bg-mint/8 text-mint border border-mint/20 font-mono">
          <span className="animate-blink">●</span> {fp(me.cash)}
        </span>
        {notifs > 0 && (
          <span className="pill bg-mint/10 text-mint border border-mint/30 animate-pulse-glow">
            🔔 {notifs}
          </span>
        )}
        <span className="pill bg-mint/8 text-ink border border-mint/20 font-semibold">
          👤 {me.name}
        </span>
        <span className="text-[11px] font-mono text-muted hidden sm:inline">{now}</span>
        <button onClick={signOut} className="text-[10px] font-bold tracking-wider uppercase text-muted hover:text-red px-2">
          Sign Out
        </button>
      </div>
    </header>
  );
}

function showBrowserPush(title: string, body: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "/favicon.ico" }); } catch {}
}

function showToast(title: string, body: string) {
  if (typeof window === "undefined") return;
  const el = document.createElement("div");
  el.className =
    "fixed top-6 right-6 z-50 max-w-sm bg-card border border-mint/30 rounded-xl p-4 shadow-glow";
  el.style.animation = "slideIn 0.3s ease-out";
  el.innerHTML =
    `<div class="text-sm font-bold text-ink mb-1">${escape(title)}</div>` +
    `<div class="text-xs text-ink2">${escape(body)}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}
