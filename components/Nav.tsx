"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PAGES = [
  { href: "/overview",  label: "Overview"  },
  { href: "/trade",     label: "Trade"     },
  { href: "/screener",  label: "Screener"  },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/charts",    label: "Charts"    },
  { href: "/news",      label: "News"      },
  { href: "/settings",  label: "Settings"  },
];

export default function Nav() {
  const path = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(j => setIsAdmin(!!j.user?.is_admin));
  }, []);

  const pages = isAdmin
    ? [...PAGES, { href: "/admin", label: "Admin" }]
    : PAGES;

  return (
    <nav className="flex items-center gap-1 mb-7 border-b border-border1 -mt-2 overflow-x-auto">
      {pages.map(p => {
        const on = path?.startsWith(p.href);
        return (
          <Link key={p.href} href={p.href}
            className={[
              "px-4 py-3 text-[13px] font-semibold relative transition-colors whitespace-nowrap",
              on
                ? (p.href === "/admin" ? "text-amber" : "text-ink")
                : (p.href === "/admin"
                    ? "text-amber/70 hover:text-amber"
                    : "text-muted hover:text-ink2"),
            ].join(" ")}>
            {p.label}
            {on && <span className={[
              "absolute bottom-0 left-3 right-3 h-0.5 rounded-full",
              p.href === "/admin" ? "bg-amber" : "bg-mint",
            ].join(" ")} />}
          </Link>
        );
      })}
    </nav>
  );
}
