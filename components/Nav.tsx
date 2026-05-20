"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES: { href: string; label: string; icon: string }[] = [
  { href: "/overview",  label: "Overview",  icon: "🏠" },
  { href: "/trade",     label: "Trade",     icon: "💹" },
  { href: "/watchlist", label: "Watchlist", icon: "👁" },
  { href: "/charts",    label: "Charts",    icon: "📈" },
  { href: "/news",      label: "News",      icon: "📰" },
  { href: "/settings",  label: "Settings",  icon: "⚙️" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
      {PAGES.map(p => {
        const on = path?.startsWith(p.href);
        return (
          <Link key={p.href} href={p.href}
            className={[
              "text-[11px] font-bold tracking-[.14em] uppercase rounded-full py-2.5",
              "text-center transition-all border backdrop-blur-sm",
              on
                ? "bg-mint/10 text-mint border-mint shadow-glow"
                : "bg-card/60 text-muted border-border1 hover:text-mint hover:border-mint hover:bg-mint/5",
            ].join(" ")}>
            {p.icon} {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
