"use client";
import { useEffect, useState } from "react";
import { fp, fpp, clr } from "@/lib/format";
import { Kpi } from "@/components/Kpi";
import { useTickerNames } from "@/lib/useTickerNames";

type Performance = {
  startingCash: number; cash: number; totalValue: number; totalCost: number;
  currentEquity: number; totalPnL: number; totalReturn: number;
  realizedPnL: number; unrealizedPnL: number;
  spyReturn: number | null; alpha: number | null;
  winRate: number; avgWin: number; avgLoss: number;
  profitFactor: number; avgHoldDays: number;
  totalTrades: number; closedRoundTrips: number; openPositions: number;
  positions: any[]; bestTrades: any[]; worstTrades: any[];
  equityCurve: { t: number; equity: number }[];
};

export default function PerformancePage() {
  const tickerNames = useTickerNames();
  const [d, setD] = useState<Performance | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/performance")
      .then(r => r.json())
      .then(j => { if (j.error) setErr(j.error); else setD(j); })
      .catch(e => setErr(String(e)));
  }, []);

  if (err) return <div className="panel text-red text-sm">{err}</div>;
  if (!d || !Array.isArray(d.positions)) return (
    <div className="flex flex-wrap gap-3 mb-7">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="panel flex-1 min-w-[180px]">
          <div className="h-3 bg-card2 rounded mb-3 w-1/2 animate-shimmer" />
          <div className="h-8 bg-card2 rounded animate-shimmer" />
          <div className="h-2 bg-card2 rounded mt-3 w-2/3 animate-shimmer" />
        </div>
      ))}
    </div>
  );

  // Defensive number coercions — every numeric field gets a fallback so
  // a null/undefined from the API can never throw a .toFixed() exception.
  const num = (v: any, fb = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  const totalReturn   = num(d.totalReturn);
  const totalPnL      = num(d.totalPnL);
  const startingCash  = num(d.startingCash, 100000);
  const cash          = num(d.cash);
  const totalValue    = num(d.totalValue);
  const realizedPnL   = num(d.realizedPnL);
  const unrealizedPnL = num(d.unrealizedPnL);
  const spyReturn     = (typeof d.spyReturn === "number" && Number.isFinite(d.spyReturn)) ? d.spyReturn : null;
  const alpha         = (typeof d.alpha === "number" && Number.isFinite(d.alpha))         ? d.alpha     : null;
  const winRate       = num(d.winRate);
  const avgWin        = num(d.avgWin);
  const avgLoss       = num(d.avgLoss);
  const profitFactor  = num(d.profitFactor);
  const closedRoundTrips = num(d.closedRoundTrips);
  const openPositions = num(d.openPositions);
  const avgHoldDays   = num(d.avgHoldDays);
  const positions     = Array.isArray(d.positions)   ? d.positions   : [];
  const bestTrades    = Array.isArray(d.bestTrades)  ? d.bestTrades  : [];
  const worstTrades   = Array.isArray(d.worstTrades) ? d.worstTrades : [];

  const beatSpy = alpha != null && alpha > 0;

  return (
    <div className="animate-fade-up">
      {/* Headline KPIs */}
      <div className="flex flex-wrap gap-3 mb-7">
        <Kpi
          label="Total Return"
          value={fpp(totalReturn)}
          sub={`${totalPnL >= 0 ? "+" : ""}${fp(totalPnL)} on ${fp(startingCash)}`}
          color={totalReturn >= 0 ? "mint" : "red"}
        />
        <Kpi
          label="vs S&P 500"
          value={spyReturn != null ? `${beatSpy ? "+" : ""}${(alpha ?? 0).toFixed(2)}%` : "—"}
          sub={spyReturn != null ? `SPY ${fpp(spyReturn)} over same period` : "Not enough history"}
          color={beatSpy ? "mint" : alpha != null ? "red" : undefined}
        />
        <Kpi
          label="Win Rate"
          value={closedRoundTrips > 0 ? `${winRate.toFixed(0)}%` : "—"}
          sub={closedRoundTrips > 0 ? `${closedRoundTrips} closed trades` : "No closed trades yet"}
          color={winRate >= 50 ? "mint" : closedRoundTrips > 0 ? "red" : undefined}
        />
        <Kpi
          label="Profit Factor"
          value={closedRoundTrips > 0
            ? (profitFactor >= 99 ? "∞" : profitFactor.toFixed(2))
            : "—"}
          sub={closedRoundTrips > 0
            ? `${fp(avgWin)} avg win · ${fp(avgLoss)} avg loss`
            : "Sell something to measure"}
          color={profitFactor >= 1.5 ? "mint" : profitFactor >= 1 ? undefined : "red"}
        />
      </div>

      {/* P&L breakdown */}
      <div className="section-h-lg">Equity Breakdown</div>
      <div className="panel mb-7 grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 text-sm">
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider mb-1">Cash</div>
          <div className="font-mono text-ink text-lg">{fp(cash)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider mb-1">Invested Value</div>
          <div className="font-mono text-ink text-lg">{fp(totalValue)}</div>
          <div className="text-[11px] text-muted">{openPositions} open positions</div>
        </div>
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider mb-1">Realized P&L</div>
          <div className={`font-mono text-lg ${clr(realizedPnL)}`}>
            {realizedPnL >= 0 ? "+" : ""}{fp(realizedPnL)}
          </div>
          <div className="text-[11px] text-muted">From {closedRoundTrips} closed trades</div>
        </div>
        <div>
          <div className="text-[11px] text-muted uppercase tracking-wider mb-1">Unrealized P&L</div>
          <div className={`font-mono text-lg ${clr(unrealizedPnL)}`}>
            {unrealizedPnL >= 0 ? "+" : ""}{fp(unrealizedPnL)}
          </div>
          <div className="text-[11px] text-muted">Mark-to-market on open positions</div>
        </div>
      </div>

      {/* Position contribution */}
      {positions.length > 0 && (
        <>
          <div className="section-h">
            <span>Position Contribution</span>
            <span className="text-muted font-normal">sorted by P&L</span>
          </div>
          <div className="panel p-0 overflow-x-auto mb-7">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
                  <th className="text-left  px-5 py-3">Symbol</th>
                  <th className="text-right px-3 py-3">Qty</th>
                  <th className="text-right px-3 py-3">Cost</th>
                  <th className="text-right px-3 py-3">Price</th>
                  <th className="text-right px-3 py-3">Value</th>
                  <th className="text-right px-5 py-3">P&L</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {positions.map((p: any) => (
                  <tr key={p.ticker} className="border-b border-border1/50 last:border-b-0 hover:bg-card2/50">
                    <td className="px-5 py-3 font-sans">
                      <div className="text-ink font-semibold">{p.ticker}</div>
                      {tickerNames[p.ticker] && (
                        <div className="text-muted text-[11px] truncate max-w-[180px]">{tickerNames[p.ticker]}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-ink2">{num(p.qty)}</td>
                    <td className="px-3 py-3 text-right text-ink2">{fp(num(p.avg_cost))}</td>
                    <td className="px-3 py-3 text-right text-ink">{fp(num(p.price))}</td>
                    <td className="px-3 py-3 text-right text-ink">{fp(num(p.value))}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${clr(num(p.pnl))}`}>
                      {num(p.pnl) >= 0 ? "+" : ""}{fp(num(p.pnl))}
                      <span className="text-muted text-[11px] ml-2">{fpp(num(p.pct))}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Best / Worst closed trades */}
      {closedRoundTrips > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-7">
          <ClosedTradesPanel title="Top Winners" trades={bestTrades} color="mint" names={tickerNames} />
          <ClosedTradesPanel title="Top Losers"  trades={worstTrades} color="red"  names={tickerNames} />
        </div>
      )}

      {/* Honest stats footer */}
      <div className="panel mb-7 text-xs text-muted leading-relaxed border-l-2 border-l-border2">
        <div className="text-ink2 font-semibold mb-2">📊 How to read these numbers</div>
        <p className="mb-2">
          <b className="text-ink2">Total Return</b> is your equity vs. the {fp(startingCash)} starting cash.
          <b className="text-ink2"> vs S&P 500</b> shows your alpha — beating the market is the real bar; matching SPY means you didn't need a strategy.
        </p>
        <p className="mb-2">
          <b className="text-ink2">Win Rate</b> over 50% with <b className="text-ink2">Profit Factor</b> above 1.5 is genuinely good.
          A high win rate but profit factor under 1 means you're cutting winners too early. Most beginners' problem.
        </p>
        <p>
          <b className="text-ink2">Avg holding period:</b> {avgHoldDays > 0 ? `${avgHoldDays.toFixed(0)} days` : "—"}.
          Day-trading is usually a losing game on a 15-min cron; medium-term (10–60 days) is where ATR-based stops + ML signals tend to actually work.
        </p>
      </div>
    </div>
  );
}

function ClosedTradesPanel({ title, trades, color, names }:
  { title: string; trades: any[]; color: "mint" | "red"; names: Record<string, string> }) {
  if (!Array.isArray(trades) || !trades.length) return null;
  const safe = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return (
    <div>
      <div className="section-h">{title}</div>
      <div className="panel p-0 overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="font-mono">
            {trades.map((t, i) => {
              const pnl = safe(t?.pnl);
              const pct = safe(t?.pct);
              const buy = safe(t?.buyPrice);
              const sell = safe(t?.sellPrice);
              const qty = safe(t?.qty);
              const holdDays = safe(t?.holdDays);
              const tk = t?.ticker ?? "—";
              return (
                <tr key={i} className="border-b border-border1/40 last:border-b-0">
                  <td className="px-4 py-2.5 font-sans">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-ink">{tk}</span>
                      <span className="text-muted text-[11px]">{qty} sh</span>
                    </div>
                    {names[tk] && (
                      <div className="text-muted text-[10px] truncate max-w-[160px]">{names[tk]}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink2 text-xs">
                    {fp(buy)} → {fp(sell)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold text-${color}`}>
                    {pnl >= 0 ? "+" : ""}{fp(pnl)}
                    <div className="text-[10px] text-muted">{fpp(pct)} · {holdDays}d</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
