"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PAGES = [
  { href: "/overview",    label: "Overview"    },
  { href: "/trade",       label: "Trade"       },
  { href: "/screener",    label: "Screener"    },
  { href: "/watchlist",   label: "Watchlist"   },
  { href: "/charts",      label: "Charts"      },
  { href: "/backtest",    label: "Backtest"    },
  { href: "/performance", label: "Performance" },
  { href: "/news",        label: "News"        },
  { href: "/settings",    label: "Settings"    },
];

const BOTTOM_MAIN = [
  { href: "/overview",  label: "Home"      },
  { href: "/trade",     label: "Trade"     },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/charts",    label: "Charts"    },
];

const MORE_PAGES = [
  { href: "/performance", label: "Performance", emoji: "📊" },
  { href: "/screener",    label: "Screener",    emoji: "🔍" },
  { href: "/backtest",    label: "Backtest",    emoji: "⚡" },
  { href: "/news",        label: "News",        emoji: "📰" },
  { href: "/settings",    label: "Settings",    emoji: "⚙️" },
];

function NavIcon({ href }: { href: string }) {
  const cls = "w-[22px] h-[22px]";
  const s = { strokeWidth: "1.75", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (href === "/overview") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={cls} {...s}>
      <path d="M3 9.5L12 4l9 5.5V20H3V9.5z" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
  if (href === "/trade") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={cls} {...s}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="17 7 21 7 21 11" />
    </svg>
  );
  if (href === "/watchlist") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={cls} {...s}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  );
  if (href === "/charts") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={cls} {...s}>
      <polyline points="3 3 3 21 21 21" />
      <polyline points="7 15 11 9 15 13 19 6" />
    </svg>
  );
  return null;
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
         strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(j => setIsAdmin(!!j.user?.is_admin));
  }, []);

  useEffect(() => { setMoreOpen(false); }, [path]);

  const pages = isAdmin ? [...PAGES, { href: "/admin", label: "Admin" }] : PAGES;
  const morePages = isAdmin
    ? [...MORE_PAGES, { href: "/admin", label: "Admin", emoji: "🛡️" }]
    : MORE_PAGES;
  const isMoreActive = morePages.some(p => path?.startsWith(p.href));

  return (
    <>
      {/* ── Desktop: horizontal tab nav ── */}
      <nav className="hidden md:flex items-center gap-1 mb-7 border-b border-border1 -mt-2 overflow-x-auto">
        {pages.map(p => {
          const on = path?.startsWith(p.href);
          return (
            <Link key={p.href} href={p.href}
              className={[
                "px-4 py-3 text-[13px] font-semibold relative transition-colors whitespace-nowrap",
                on
                  ? (p.href === "/admin" ? "text-amber" : "text-ink")
                  : (p.href === "/admin" ? "text-amber/70 hover:text-amber" : "text-muted hover:text-ink2"),
              ].join(" ")}>
              {p.label}
              {on && (
                <span className={[
                  "absolute bottom-0 left-3 right-3 h-0.5 rounded-full",
                  p.href === "/admin" ? "bg-amber" : "bg-mint",
                ].join(" ")} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Mobile: spacer so content isn't hidden behind the fixed bar ── */}
      <div className="md:hidden h-2" />

      {/* ── Mobile: fixed bottom nav ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40">
        {/* More sheet */}
        {moreOpen && (
          <>
            <div
              className="fixed inset-0 bg-bg/70 backdrop-blur-sm z-30"
              onClick={() => setMoreOpen(false)}
            />
            <div className="absolute bottom-full left-0 right-0 z-40 bg-card border-t border-border1 rounded-t-2xl p-5 pb-4">
              <div className="w-10 h-1 bg-border2 rounded-full mx-auto mb-5" />
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-3 px-1">More</p>
              <div className="grid grid-cols-4 gap-2">
                {morePages.map(p => {
                  const on = path?.startsWith(p.href);
                  return (
                    <Link key={p.href} href={p.href}
                      onClick={() => setMoreOpen(false)}
                      className={[
                        "flex flex-col items-center gap-2 py-4 px-2 rounded-xl text-[11px] font-semibold transition-colors",
                        on ? "bg-mint/10 text-mint" : "text-ink2 hover:text-ink hover:bg-card2",
                      ].join(" ")}>
                      <span className="text-[20px] leading-none">{p.emoji}</span>
                      {p.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Tab bar */}
        <div className="border-t border-border1 bg-bg/95 backdrop-blur-md"
             style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex items-stretch">
            {BOTTOM_MAIN.map(p => {
              const on = path?.startsWith(p.href);
              return (
                <Link key={p.href} href={p.href}
                  className={[
                    "flex-1 flex flex-col items-center gap-1 pt-3 pb-4 text-[10px] font-semibold transition-colors",
                    on ? "text-mint" : "text-muted",
                  ].join(" ")}>
                  <NavIcon href={p.href} />
                  {p.label}
                </Link>
              );
            })}
            <button
              onClick={() => setMoreOpen(v => !v)}
              className={[
                "flex-1 flex flex-col items-center gap-1 pt-3 pb-4 text-[10px] font-semibold transition-colors",
                isMoreActive || moreOpen ? "text-mint" : "text-muted",
              ].join(" ")}>
              <MoreIcon />
              More
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
