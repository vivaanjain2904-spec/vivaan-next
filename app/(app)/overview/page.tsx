"use client";
import { useEffect, useState } from "react";
import { fp, fpp, clr } from "@/lib/format";
import { Kpi } from "@/components/Kpi";

type PortfolioRes = {
  user: { name: string; cash: number; ml_threshold: number };
  positions: { ticker: string; qty: number; avg_cost: number; stop_loss: number | null; take_profit: number | null }[];
  watchlist: any[];
  quotes: Record<string, { price: number; pct: number; hi52: number; lo52: number; name: string }>;
  ml: Record<string, number>;
};

export default function OverviewPage() {
  const [d, setD]     = useState<PortfolioRes | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/portfolio").then(r => r.json()).then(j => {
      if (j.error) setErr(j.error); else setD(j);
    }).catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="panel text-red text-sm">{err}</div>;
  if (!d)  return <div className="panel text-muted text-sm">Loading portfolio…</div>;

  const positions = d.positions;
  const cash = Number(d.user.cash);

  if (!positions.length) {
    return (
      <div className="panel-glow text-center py-12">
        <div className="text-base text-ink2 mb-2">No holdings yet</div>
        <div className="text-muted text-sm mb-6">
          Head to the <a href="/trade" className="text-mint hover:underline">Trade</a> page to buy your first stock.
        </div>
        <div className="text-mint font-mono">Cash available: {fp(cash)}</div>
      </div>
    );
  }

  // Compute KPIs
  let totalVal = 0, totalCost = 0, dayWeighted = 0;
  for (const p of positions) {
    const q = d.quotes[p.ticker]; if (!q) continue;
    totalVal  += q.price * p.qty;
    totalCost += p.avg_cost * p.qty;
    dayWeighted += (q.pct / 100) * q.price * p.qty;
  }
  const portfolioPnl = totalCost ? ((totalVal - totalCost) / totalCost) * 100 : 0;
  const dayPct = totalVal ? (dayWeighted / totalVal) * 100 : 0;
  const winners = positions.filter(p => {
    const q = d.quotes[p.ticker]; return q && q.price > p.avg_cost;
  }).length;

  // Alerts
  const alerts: { level: "buy" | "sell" | "info"; msg: string }[] = [];
  for (const p of positions) {
    const q = d.quotes[p.ticker]; if (!q) continue;
    const pnl = ((q.price - p.avg_cost) / p.avg_cost) * 100;
    if (p.stop_loss && q.price <= p.avg_cost * (1 - p.stop_loss))
      alerts.push({ level: "sell", msg: `🔴 ${p.ticker} hit stop-loss · ${fp(q.price)} (${fpp(pnl)})` });
    else if (p.take_profit && q.price >= p.avg_cost * (1 + p.take_profit))
      alerts.push({ level: "buy", msg: `🟢 ${p.ticker} hit take-profit · ${fp(q.price)} (${fpp(pnl)})` });
    else if (d.ml[p.ticker] >= d.user.ml_threshold)
      alerts.push({ level: "info", msg: `⚠️ ${p.ticker} ML risk: ${(d.ml[p.ticker] * 100).toFixed(0)}% chance of drop` });
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-6">
        <Kpi label="Total Account" value={fp(totalVal + cash)}
             sub={`${fp(totalVal)} invested`} color={portfolioPnl >= 0 ? "mint" : "red"} />
        <Kpi label="Portfolio P&L" value={fpp(portfolioPnl)}
             sub={`${winners}W · ${positions.length - winners}L`}
             color={portfolioPnl >= 0 ? "mint" : "red"} />
        <Kpi label="Day Change" value={fpp(dayPct)} color={dayPct >= 0 ? "mint" : "red"} sub="weighted" />
        <Kpi label="Cash" value={fp(cash)} sub="available" />
        <Kpi label="Positions" value={String(positions.length)} sub="active holdings" />
      </div>

      <div className="section-h">🚨 Alerts</div>
      {alerts.length === 0 ? (
        <div className="panel text-muted text-sm">✅ All positions within stop / target range</div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={[
              "rounded-xl py-3 px-4 text-sm border-l-4",
              a.level === "sell" ? "bg-red/10 border-red border border-red/20"
              : a.level === "buy" ? "bg-mint/10 border-mint border border-mint/20"
              : "bg-amber/10 border-amber border border-amber/20",
            ].join(" ")}>{a.msg}</div>
          ))}
        </div>
      )}

      <div className="section-h">Holdings</div>
      <div className="panel p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black/30">
            <tr className="text-[10px] uppercase tracking-[.16em] text-muted font-bold">
              <th className="text-left  px-4 py-3">Ticker</th>
              <th className="text-right px-4 py-3">Price</th>
              <th className="text-right px-4 py-3">Day</th>
              <th className="text-right px-4 py-3">Cost</th>
              <th className="text-right px-4 py-3">P&L</th>
              <th className="text-right px-4 py-3">Qty</th>
              <th className="text-right px-4 py-3">Value</th>
              <th className="text-right px-4 py-3">Stop</th>
              <th className="text-right px-4 py-3">Target</th>
              <th className="text-right px-4 py-3">ML Risk</th>
            </tr>
          </thead>
          <tbody className="font-mono">
          {positions.map(p => {
            const q = d.quotes[p.ticker];
            if (!q) return null;
            const pnl  = ((q.price - p.avg_cost) / p.avg_cost) * 100;
            const val  = q.price * p.qty;
            const stop = p.stop_loss   ? p.avg_cost * (1 - p.stop_loss)   : null;
            const tgt  = p.take_profit ? p.avg_cost * (1 + p.take_profit) : null;
            const mlP  = d.ml[p.ticker];
            return (
              <tr key={p.ticker} className="border-t border-border1/60 hover:bg-mint/5">
                <td className="px-4 py-3"><span className="tk-tag">{p.ticker}</span></td>
                <td className="px-4 py-3 text-right">{fp(q.price)}</td>
                <td className={`px-4 py-3 text-right ${clr(q.pct)}`}>{fpp(q.pct)}</td>
                <td className="px-4 py-3 text-right">{fp(p.avg_cost)}</td>
                <td className={`px-4 py-3 text-right font-bold ${clr(pnl)}`}>{fpp(pnl)}</td>
                <td className="px-4 py-3 text-right">{p.qty}</td>
                <td className="px-4 py-3 text-right">{fp(val)}</td>
                <td className="px-4 py-3 text-right text-red">{stop ? fp(stop) : "—"}</td>
                <td className="px-4 py-3 text-right text-mint">{tgt ? fp(tgt) : "—"}</td>
                <td className="px-4 py-3 text-right text-amber">
                  {mlP != null ? `${(mlP * 100).toFixed(0)}%` : "—"}
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
