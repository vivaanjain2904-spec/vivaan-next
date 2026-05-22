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

const FEATURE_CARDS = [
  { href: "/trade",     emoji: "📈", title: "Trade",       desc: "Buy and sell stocks with real-time quotes" },
  { href: "/watchlist", emoji: "👁",  title: "Watchlist",  desc: "Track stocks you want to keep an eye on" },
  { href: "/charts",    emoji: "📊", title: "Charts",      desc: "Analyse price movements interactively" },
  { href: "/screener",  emoji: "🔍", title: "Screener",    desc: "Filter stocks by price, volume, and metrics" },
  { href: "/news",      emoji: "📰", title: "Market News", desc: "Stay on top of the latest headlines" },
  { href: "/backtest",  emoji: "⚡", title: "Backtest",    desc: "Test your strategy against historical data" },
] as const;

export default function OverviewPage() {
  const [d, setD] = useState<PortfolioRes | null>(null);
  const [err, setErr] = useState("");
  const [sigs, setSigs] = useState<Record<string, any>>({});
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertRes, setAlertRes] = useState<{ msg: string; breaches?: any[] } | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState("");

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

  async function seedDemo() {
    setSeedBusy(true); setSeedMsg("");
    const j = await fetch("/api/seed-demo", { method: "POST" }).then(r => r.json()).catch(() => null);
    if (j?.bought) setSeedMsg(`Seeded ${j.bought.length} stocks!`);
    else setSeedMsg(j?.error ?? "Something went wrong.");
    setSeedBusy(false);
    await loadPortfolio();
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
      <button
        onClick={runAlerts}
        disabled={alertBusy}
        className="btn-ghost text-[12px] disabled:opacity-50">
        {alertBusy ? "Checking…" : "🤖 Run Alert Check"}
      </button>
      <button
        onClick={seedDemo}
        disabled={seedBusy}
        className="btn-ghost text-[12px] disabled:opacity-50">
        {seedBusy ? "Seeding…" : "🌱 Seed Demo Portfolio"}
      </button>
      <a href="/settings" className="btn-ghost text-[12px]">⚙️ Settings</a>
    </div>
  );

  /* ── Feature cards (shows for all users) ── */
  const FeatureCards = (
    <div className="mt-8">
      <div className="section-h-lg">Quick Navigation</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {FEATURE_CARDS.map(a => (
          <a key={a.href} href={a.href}
             className="panel-hover flex flex-col gap-2 cursor-pointer group">
            <span className="text-2xl">{a.emoji}</span>
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
