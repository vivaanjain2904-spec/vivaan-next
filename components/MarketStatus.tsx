"use client";
import { useEffect, useState } from "react";

/** Quick approximation: NYSE/NASDAQ hours, Mon-Fri 9:30am–4pm ET. */
function getMarketStatus(): { label: string; tone: "live" | "pre" | "post" | "closed" } {
  const now = new Date();
  // Convert to NY time
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();        // 0 = Sun, 6 = Sat
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const open = 9 * 60 + 30;       // 9:30
  const close = 16 * 60;          // 16:00
  const preOpen = 4 * 60;         // 4:00
  const afterClose = 20 * 60;     // 20:00

  if (day === 0 || day === 6) return { label: "Closed · Weekend", tone: "closed" };
  if (mins < preOpen) return { label: "Closed", tone: "closed" };
  if (mins < open) return { label: "Pre-Market", tone: "pre" };
  if (mins < close) return { label: "Market Open", tone: "live" };
  if (mins < afterClose) return { label: "After-Hours", tone: "post" };
  return { label: "Closed", tone: "closed" };
}

export default function MarketStatus() {
  const [s, setS] = useState(getMarketStatus());
  useEffect(() => {
    const i = setInterval(() => setS(getMarketStatus()), 60_000);
    return () => clearInterval(i);
  }, []);

  const color =
    s.tone === "live"   ? "text-mint"  :
    s.tone === "pre"    ? "text-amber" :
    s.tone === "post"   ? "text-amber" :
                          "text-muted";
  const dotAnim = s.tone === "live" ? "animate-pulse" : "";

  return (
    <span className={`pill bg-card2 border border-border1 ${color}`}>
      <span className={`text-[10px] ${dotAnim}`}>●</span>
      <span className="hidden sm:inline">{s.label}</span>
    </span>
  );
}
