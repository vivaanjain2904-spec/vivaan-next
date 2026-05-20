"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/overview",  label: "Overview"  },
  { href: "/trade",     label: "Trade"     },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/charts",    label: "Charts"    },
  { href: "/news",      label: "News"      },
  { href: "/settings",  label: "Settings"  },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 mb-7 border-b border-border1 -mt-2">
      {PAGES.map(p => {
        const on = path?.startsWith(p.href);
        return (
          <Link key={p.href} href={p.href}
            className={[
              "px-4 py-3 text-[13px] font-semibold relative transition-colors",
              on ? "text-ink" : "text-muted hover:text-ink2",
            ].join(" ")}>
            {p.label}
            {on && <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-mint rounded-full" />}
          </Link>
        );
      })}
    </nav>
  );
}
