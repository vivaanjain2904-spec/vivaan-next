"use client";
import { useEffect, useState } from "react";
import { fp, fpp, clr } from "@/lib/format";
import { Kpi } from "@/components/Kpi";
import Sparkline from "@/components/Sparkline";
import Allocation from "@/components/Allocation";

type PortfolioRes = {
  user: { name: string; cash: number; ml_threshold: number };
  positions: { ticker: string; qty: number; avg_cost: number; stop_loss: number | null; take_profit: number | null }[];
  watchlist: any[];
  quotes: Record<string, { price: number; pct: number; hi52: number; lo52: number; name: string }>;
  ml: Record<string, number>;
};

export default function OverviewPage() {
  const [d, setD] = useState<PortfolioRes | null>(null);
  const [err, setErr] = useState("");
  const [sigs, setSigs] = useState<Record<string, any>>({});

  useEffect(() => {
    fetch("/api/portfolio").then(r => r.json()).then(j => {
      if (j.error) { setErr(j.error); return; }
      setD(j);
      const tickers = j.positions.map((p: any) => p.ticker);
      if (tickers.length) {
        fetch("/api/signals", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers }),
        }).then(r => r.json()).then(s => setSigs(s.signals ?? {}));
      }
    }).catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="panel text-red text-sm">{err}</div>;
  if (!d)  return (
    <>
      <div className="flex flex-wrap gap-3 mb-7">
        {Array.from({length: 5}).map((_, i) => (
          <div key={i} className="panel flex-1 min-w-[160px]">
            <div className="h-3 bg-card2 rounded mb-3 w-1/2 animate-shimmer" />
            <div className="h-7 bg-card2 rounded animate-shimmer" />
            <div className="h-2 bg-card2 rounded mt-3 w-2/3 animate-shimmer" />
          </div>
        ))}
      </div>
    </>
  );

  const positions = d.positions;
  const cash = Number(d.user.cash);

  if (!positions.length) {
    return (
      <div className="panel text-center py-16">
        <div className="text-base text-ink mb-1 font-semibold">No holdings yet</div>
        <div className="text-muted text-sm mb-6">
          Head to <a href="/trade" className="text-mint hover:underline">Trade</a> to buy your first stock.
        </div>
        <div className="inline-block panel bg-card2 font-mono text-mint">{fp(cash)} available</div>
      </div>
    );
  }

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
                    <div className="text-ink font-semibold">{p.ticker}</div>
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
    </>
  );
}
