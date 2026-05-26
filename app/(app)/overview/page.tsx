"use client";
import { useEffect, useState } from "react";
import { fp, fpp, clr } from "@/lib/format";
import { Kpi } from "@/components/Kpi";
import Sparkline from "@/components/Sparkline";
import Allocation from "@/components/Allocation";

type PortfolioRes = {
  user: { name: string; cash: number; ml_threshold: number };
  positions: { ticker: string; qty: number; avg_cost: number; stop_loss: number | null; take_profit: number | null; review_at?: string | null }[];
  watchlist: any[];
  quotes: Record<string, { price: number; pct: number; hi52: number; lo52: number; name: string }>;
  ml: Record<string, number>;
};

type NavCard = { href: string; iconKey: "trade" | "perf" | "watch" | "charts" | "screen" | "back"; title: string; desc: string };

const FEATURE_CARDS: NavCard[] = [
  { href: "/trade",       iconKey: "trade",  title: "Trade",       desc: "Buy and sell stocks with real-time quotes" },
  { href: "/performance", iconKey: "perf",   title: "Performance", desc: "Win rate, P&L, alpha vs S&P 500" },
  { href: "/watchlist",   iconKey: "watch",  title: "Watchlist",   desc: "Track stocks you want to keep an eye on" },
  { href: "/charts",      iconKey: "charts", title: "Charts",      desc: "Analyse price movements interactively" },
  { href: "/screener",    iconKey: "screen", title: "Screener",    desc: "Filter stocks by price, volume, and metrics" },
  { href: "/backtest",    iconKey: "back",   title: "Backtest",    desc: "Test your strategy against historical data" },
];

const NAV_ICON_PROPS = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  className: "w-5 h-5",
};

function NavCardIcon({ k }: { k: NavCard["iconKey"] }) {
  switch (k) {
    case "trade":
      return (<svg {...NAV_ICON_PROPS}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>);
    case "perf":
      return (<svg {...NAV_ICON_PROPS}><path d="M3 3v18h18" /><rect x="7" y="13" width="3" height="5" /><rect x="12" y="9" width="3" height="9" /><rect x="17" y="6" width="3" height="12" /></svg>);
    case "watch":
      return (<svg {...NAV_ICON_PROPS}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" /></svg>);
    case "charts":
      return (<svg {...NAV_ICON_PROPS}><path d="M3 3v18h18" /><path d="M7 15l4-6 4 4 4-7" /></svg>);
    case "screen":
      return (<svg {...NAV_ICON_PROPS}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
    case "back":
      return (<svg {...NAV_ICON_PROPS}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>);
  }
}

export default function OverviewPage() {
  const [d, setD] = useState<PortfolioRes | null>(null);
  const [err, setErr] = useState("");
  const [sigs, setSigs] = useState<Record<string, any>>({});
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertRes, setAlertRes] = useState<{ msg: string; breaches?: any[] } | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoRes, setAutoRes] = useState<any>(null);

  async function loadPortfolio() {
    const j = await fetch("/api/portfolio").then(r => r.json());
    if (j.error) { setErr(j.error); return; }
    setD(j);
    const tickers = j.positions.map((p: any) => p.ticker);
    if (tickers.length) {
      fetch("/api/signals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      }).then(r => r.json()).then(s => setSigs(s.signals ?? {}));
    }
  }

  useEffect(() => { loadPortfolio().catch(e => setErr(String(e))); }, []);

  async function runAlerts() {
    setAlertBusy(true); setAlertRes(null);
    const j = await fetch("/api/run-alerts-self", { method: "POST" }).then(r => r.json()).catch(() => null);
    setAlertRes(j ?? { msg: "Request failed — check your connection." });
    setAlertBusy(false);
  }

  async function runAutoCycle() {
    setAutoBusy(true); setAutoRes(null);
    const j = await fetch("/api/auto-trade/run", { method: "POST" }).then(r => r.json()).catch(() => null);
    setAutoRes(j ?? { msg: "Request failed." });
    setAutoBusy(false);
    await loadPortfolio();
  }

  async function seedDemo() {
    setSeedBusy(true); setSeedMsg("");
    try {
      const r = await fetch("/api/seed-demo", { method: "POST" });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        setSeedMsg(`Seed failed (${r.status}). ${txt.slice(0, 160)}`);
        return;
      }
      const j = await r.json();
      const boughtN  = j.bought?.length  ?? 0;
      const skippedN = j.skipped?.length ?? 0;
      if (boughtN > 0) {
        setSeedMsg(
          `✓ Seeded ${boughtN} stocks · spent ${fp(Number(j.total_cost))} · ${fp(Number(j.cash_remaining))} cash left.` +
          (skippedN > 0 ? ` Skipped ${skippedN} (already held or out of cash).` : "")
        );
      } else if (skippedN > 0) {
        const reasons = (j.skipped as any[]).map(s => `${s.ticker} (${s.reason})`).join(", ");
        setSeedMsg(`Nothing seeded — all 10 starter stocks are either already in your portfolio or you're out of cash. Detail: ${reasons}`);
      } else {
        setSeedMsg("Seed completed but no stocks were added.");
      }
      await loadPortfolio();
    } catch (e: any) {
      setSeedMsg(`Error: ${String(e?.message ?? e)}`);
    } finally {
      setSeedBusy(false);
    }
  }

  if (err) return <div className="panel text-red text-sm">{err}</div>;
  if (!d) return (
    <div className="flex flex-wrap gap-3 mb-7">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="panel flex-1 min-w-[160px]">
          <div className="h-3 bg-card2 rounded mb-3 w-1/2 animate-shimmer" />
          <div className="h-7 bg-card2 rounded animate-shimmer" />
          <div className="h-2 bg-card2 rounded mt-3 w-2/3 animate-shimmer" />
        </div>
      ))}
    </div>
  );

  const positions = d.positions;
  const cash = Number(d.user.cash);

  /* ── Alert check result banner ── */
  const AlertBanner = alertRes ? (
    <div className={[
      "panel mb-6 text-sm flex items-start gap-3",
      (alertRes.breaches?.length ?? 0) > 0 ? "border-l-2 border-l-amber" : "border-l-2 border-l-mint",
    ].join(" ")}>
      <span className="text-lg">{(alertRes.breaches?.length ?? 0) > 0 ? "⚠️" : "✅"}</span>
      <div>
        <div className="font-semibold text-ink">{alertRes.msg}</div>
        {(alertRes.breaches?.length ?? 0) > 0 && (
          <div className="text-xs text-muted mt-1">
            {alertRes.breaches!.map((b: any) => `${b.ticker} (${b.kind})`).join(", ")}
          </div>
        )}
      </div>
    </div>
  ) : null;

  /* ── Quick Tools bar (shows for all users) ── */
  const QuickTools = (
    <div className="flex flex-wrap gap-2 mb-7">
      <button onClick={runAlerts} disabled={alertBusy}
              className="btn-ghost text-[12px] disabled:opacity-50 inline-flex items-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
             strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M21 12a9 9 0 11-9-9c2.5 0 4.7 1 6.4 2.6L21 3" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        {alertBusy ? "Checking…" : "Run Alert Check"}
      </button>
      <button onClick={seedDemo} disabled={seedBusy}
              className="btn-ghost text-[12px] disabled:opacity-50 inline-flex items-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
             strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <path d="M12 22V12" />
          <path d="M5 12c0-4 3-7 7-7s7 3 7 7" />
          <path d="M9 16l3 3 3-3" />
        </svg>
        {seedBusy ? "Seeding…" : "Seed Demo Portfolio"}
      </button>
      <a href="/settings" className="btn-ghost text-[12px] inline-flex items-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
             strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
        Settings
      </a>
      <button onClick={runAutoCycle} disabled={autoBusy}
              className="btn-mint text-[12px] disabled:opacity-50 inline-flex items-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
             strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
        </svg>
        {autoBusy ? "Scanning universe…" : "Run Auto-Trade Cycle"}
      </button>
    </div>
  );

  /* ── Autonomous cycle result panel ── */
  const AutoBanner = autoRes ? (
    <div className={[
      "panel mb-6 text-sm border-l-2",
      autoRes.bought > 0 ? "border-l-mint" :
      autoRes.skipped ? "border-l-amber" : "border-l-border2",
    ].join(" ")}>
      <div className="text-ink font-semibold mb-1">
        {autoRes.bought > 0 ? `🤖 Autonomous trader bought ${autoRes.bought} new position(s)` :
         autoRes.skipped ? `⏸ Autonomous trader paused: ${autoRes.skipped.replace(/_/g, " ")}` :
         "🤖 Autonomous cycle complete"}
      </div>
      <div className="text-xs text-muted">{autoRes.msg}</div>
      {autoRes.orders?.length > 0 && (
        <div className="mt-2 font-mono text-[11px] text-mint space-y-0.5">
          {autoRes.orders.filter((o: any) => o.ok).map((o: any) => (
            <div key={o.ticker}>
              ✓ {o.qty} × {o.ticker} @ ${o.price?.toFixed(2)} · drop-prob {(o.dropProb * 100).toFixed(0)}% · {o.mode}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  /* ── Feature cards (shows for all users) ── */
  const FeatureCards = (
    <div className="mt-8">
      <div className="section-h-lg">Quick Navigation</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {FEATURE_CARDS.map((a, i) => (
          <a key={a.href} href={a.href}
             className={`panel-hover flex flex-col gap-3 cursor-pointer group animate-rise delay-${(i + 1) as 1|2|3|4|5|6}`}>
            <div className="w-10 h-10 rounded-lg bg-mint/10 border border-mint/20 flex items-center justify-center text-mint group-hover:bg-mint/15 group-hover:border-mint/40 group-hover:scale-105 transition-all duration-200">
              <NavCardIcon k={a.iconKey} />
            </div>
            <div className="text-sm font-semibold text-ink group-hover:text-mint transition-colors">{a.title}</div>
            <div className="text-xs text-muted leading-relaxed">{a.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );

  /* ── Empty state ── */
  if (!positions.length) {
    return (
      <div className="animate-fade-up space-y-6">
        {seedMsg && (
          <div className="panel border-l-2 border-l-mint text-sm text-mint">{seedMsg}</div>
        )}
        {AlertBanner}
        {AutoBanner}

        {/* Welcome hero */}
        <div className="panel dot-grid text-center py-12">
          <div className="text-2xl font-bold text-ink mb-2">Welcome to Vaelor</div>
          <div className="text-muted text-sm mb-1">Your account is ready. You have</div>
          <div className="font-mono text-3xl text-mint font-semibold mt-2 mb-6">{fp(cash)}</div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href="/trade" className="btn-mint inline-flex items-center gap-2 text-sm px-6 py-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              Start Trading
            </a>
            <button onClick={seedDemo} disabled={seedBusy}
                    className="btn-ghost inline-flex items-center gap-2 text-sm px-6 py-3 disabled:opacity-50">
              🌱 {seedBusy ? "Seeding…" : "Seed Demo Portfolio"}
            </button>
          </div>
          <p className="text-xs text-muted mt-4">
            Seed Demo loads 10 popular stocks (~$2,500 each) so you can explore all features right away.
          </p>
        </div>

        {FeatureCards}
      </div>
    );
  }

  /* ── Full overview (user has positions) ── */
  let totalVal = 0, totalCost = 0, dayWeighted = 0;
  for (const p of positions) {
    const q = d.quotes[p.ticker]; if (!q) continue;
    totalVal  += q.price * p.qty;
    totalCost += p.avg_cost * p.qty;
    dayWeighted += (q.pct / 100) * q.price * p.qty;
  }
  const portfolioPnl = totalCost ? ((totalVal - totalCost) / totalCost) * 100 : 0;
  const dayPct = totalVal ? (dayWeighted / totalVal) * 100 : 0;
  const winners = positions.filter(p => d.quotes[p.ticker]?.price > p.avg_cost).length;

  const alerts: { level: "buy" | "sell" | "info"; msg: string }[] = [];
  for (const p of positions) {
    const q = d.quotes[p.ticker]; if (!q) continue;
    const pnl = ((q.price - p.avg_cost) / p.avg_cost) * 100;
    if (p.stop_loss && q.price <= p.avg_cost * (1 - p.stop_loss))
      alerts.push({ level: "sell", msg: `${p.ticker} hit stop-loss · ${fp(q.price)} (${fpp(pnl)})` });
    else if (p.take_profit && q.price >= p.avg_cost * (1 + p.take_profit))
      alerts.push({ level: "buy",  msg: `${p.ticker} hit take-profit · ${fp(q.price)} (${fpp(pnl)})` });
    else if (d.ml[p.ticker] >= d.user.ml_threshold)
      alerts.push({ level: "info", msg: `${p.ticker} ML risk: ${(d.ml[p.ticker] * 100).toFixed(0)}% drop probability` });
  }

  return (
    <>
      {seedMsg && (
        <div className="panel mb-4 border-l-2 border-l-mint text-sm text-mint">{seedMsg}</div>
      )}
      {AlertBanner}
      {QuickTools}

      <div className="flex flex-wrap gap-3 mb-7">
        <Kpi label="Total Value" value={fp(totalVal + cash)}
             sub={`${fp(totalVal)} invested`} color={portfolioPnl >= 0 ? "mint" : "red"} />
        <Kpi label="Portfolio P&L" value={fpp(portfolioPnl)}
             sub={`${winners}W · ${positions.length - winners}L`} color={portfolioPnl >= 0 ? "mint" : "red"} />
        <Kpi label="Day" value={fpp(dayPct)} color={dayPct >= 0 ? "mint" : "red"} sub="weighted" />
        <Kpi label="Cash" value={fp(cash)} sub="available" />
        <Kpi label="Positions" value={String(positions.length)} sub="active" />
      </div>

      {alerts.length > 0 && (
        <>
          <div className="section-h">Alerts</div>
          <div className="space-y-2 mb-7">
            {alerts.map((a, i) => (
              <div key={i} className={[
                "panel py-3 px-4 text-sm flex items-center gap-3",
                a.level === "sell" ? "border-l-2 border-l-red" :
                a.level === "buy"  ? "border-l-2 border-l-mint" :
                                     "border-l-2 border-l-amber",
              ].join(" ")}>
                <span className={[
                  "text-[15px]",
                  a.level === "sell" ? "text-red" : a.level === "buy" ? "text-mint" : "text-amber",
                ].join(" ")}>●</span>
                <span className="text-ink">{a.msg}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {positions.length > 1 && (
        <>
          <div className="section-h">Portfolio Allocation</div>
          <div className="panel mb-7 dot-grid">
            <Allocation slices={positions
              .map(p => ({ ticker: p.ticker, value: (d.quotes[p.ticker]?.price ?? 0) * p.qty }))
              .filter(s => s.value > 0)} />
          </div>
        </>
      )}

      <div className="section-h">
        <span>Holdings</span>
        <span className="text-muted font-normal">{positions.length} stocks</span>
      </div>
      <div className="panel p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
              <th className="text-left  px-5 py-3">Symbol</th>
              <th className="text-left  px-2 py-3">7D</th>
              <th className="text-right px-3 py-3">Price</th>
              <th className="text-right px-3 py-3">Day</th>
              <th className="text-right px-3 py-3">Cost</th>
              <th className="text-right px-3 py-3">P&L</th>
              <th className="text-right px-3 py-3">Qty</th>
              <th className="text-right px-3 py-3">Value</th>
              <th className="text-right px-3 py-3">Stop</th>
              <th className="text-right px-3 py-3">Target</th>
              <th className="text-right px-5 py-3">ML</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {positions.map(p => {
              const q = d.quotes[p.ticker]; if (!q) return null;
              const pnl = ((q.price - p.avg_cost) / p.avg_cost) * 100;
              const val = q.price * p.qty;
              const stop = p.stop_loss   ? p.avg_cost * (1 - p.stop_loss)   : null;
              const tgt  = p.take_profit ? p.avg_cost * (1 + p.take_profit) : null;
              const sig = sigs[p.ticker];
              const mlP = sig?.dropProb ?? d.ml[p.ticker];
              return (
                <tr key={p.ticker} className="border-b border-border1/50 last:border-b-0 hover:bg-card2/50 transition-colors">
                  <td className="px-5 py-3 font-sans">
                    <div className="text-ink font-semibold flex items-center gap-2">
                      {p.ticker}
                      {p.review_at && new Date(p.review_at).getTime() < Date.now() && (
                        <a href="/trade" title="Review window expired — re-tune stops"
                           className="pill text-[10px] bg-amber/10 text-amber border border-amber/20 hover:bg-amber/20">
                          🔄 Review
                        </a>
                      )}
                    </div>
                    <div className="text-muted text-[11px] truncate max-w-[140px]">{q.name}</div>
                  </td>
                  <td className="px-2 py-3"><Sparkline ticker={p.ticker} /></td>
                  <td className="px-3 py-3 text-right text-ink">{fp(q.price)}</td>
                  <td className={`px-3 py-3 text-right ${clr(q.pct)}`}>{fpp(q.pct)}</td>
                  <td className="px-3 py-3 text-right text-ink2">{fp(p.avg_cost)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${clr(pnl)}`}>{fpp(pnl)}</td>
                  <td className="px-3 py-3 text-right text-ink2">{p.qty}</td>
                  <td className="px-3 py-3 text-right text-ink">{fp(val)}</td>
                  <td className="px-3 py-3 text-right text-red/80">{stop ? fp(stop) : "—"}</td>
                  <td className="px-3 py-3 text-right text-mint/80">{tgt ? fp(tgt) : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    {mlP != null ? (
                      <span className={
                        mlP >= 0.65 ? "pill-red"  :
                        mlP <= 0.35 ? "pill-mint" : "pill-muted"
                      }>{(mlP * 100).toFixed(0)}%</span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {FeatureCards}
    </>
  );
}
