"use client";
import { useState } from "react";
import StockSearch from "@/components/StockSearch";
import { fp, fpp, clr } from "@/lib/format";
import { Kpi } from "@/components/Kpi";

type Result = {
  ticker: string; initial: number; final: number;
  return_pct: number; bh_return_pct: number; alpha_pct: number;
  max_drawdown_pct: number; bh_max_drawdown_pct?: number;
  win_rate_pct: number; trade_count: number;
  sharpe?: number; sortino?: number; calmar?: number;
  slippage_bps?: number;
  trades: { date: number; side: string; qty: number; price: number; pnl: number; reason?: string }[];
  equity: { t: number; v: number }[];
  bh_equity: { t: number; v: number }[];
};

const RANGES = [
  { k: "1y", l: "1Y" }, { k: "2y", l: "2Y" }, { k: "5y", l: "5Y" },
];

export default function BacktestPage() {
  const [tk, setTk]     = useState("AAPL");
  const [cash, setCash] = useState(10000);
  const [thr, setThr]   = useState(0.65);
  const [range, setRange] = useState("2y");
  const [smart, setSmart] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  async function run() {
    if (!tk) return;
    setBusy(true); setErr(""); setResult(null);
    const r = await fetch(
      `/api/backtest/${tk}?cash=${cash}&range=${range}&threshold=${thr}&smart=${smart ? 1 : 0}`,
    );
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Backtest failed"); return; }
    setResult(await r.json());
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Backtest</h1>
          <div className="text-[12px] text-muted mt-0.5">
            Replay the ML + smart-stops strategy on historical data. Compare vs. buy-and-hold.
          </div>
        </div>
      </div>

      <div className="panel mb-5">
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="label">Ticker</label>
            <StockSearch value={tk} onChange={setTk} />
          </div>
          <div>
            <label className="label">Starting capital ($)</label>
            <input type="number" className="input font-mono" value={cash}
                   onChange={e => setCash(Number(e.target.value))} step={1000} min={500} />
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="label">Period</label>
            <div className="seg w-full">
              {RANGES.map(r => (
                <button key={r.k} onClick={() => setRange(r.k)}
                        className={`flex-1 ${range === r.k ? "seg-btn-active" : "seg-btn"}`}>
                  {r.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">ML sell threshold: {(thr * 100).toFixed(0)}%</label>
            <input type="range" min={0.5} max={0.9} step={0.05} value={thr}
                   onChange={e => setThr(Number(e.target.value))}
                   className="w-full accent-mint" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)}
                     className="accent-mint" />
              <span className="text-ink">Smart stops (ATR-based)</span>
            </label>
          </div>
        </div>
        <button onClick={run} disabled={busy || !tk}
                className="btn-mint w-full mt-5 disabled:opacity-40">
          {busy ? "Running…" : "▶ Run Backtest"}
        </button>
        {err && <div className="text-red text-xs mt-3">{err}</div>}
      </div>

      {result && (
        <>
          <div className="flex flex-wrap gap-3 mb-3">
            <Kpi label="Strategy Return"  value={fpp(result.return_pct)}
                 color={result.return_pct >= 0 ? "mint" : "red"} />
            <Kpi label="Buy & Hold"       value={fpp(result.bh_return_pct)}
                 color={result.bh_return_pct >= 0 ? "mint" : "red"} />
            <Kpi label="Alpha"            value={fpp(result.alpha_pct)}
                 sub="vs B&H"
                 color={result.alpha_pct >= 0 ? "mint" : "red"} />
            <Kpi label="Win Rate"         value={`${result.win_rate_pct.toFixed(0)}%`}
                 sub={`${result.trade_count} trades`} />
            <Kpi label="Max Drawdown"     value={`-${result.max_drawdown_pct.toFixed(1)}%`}
                 sub={result.bh_max_drawdown_pct != null ? `B&H -${result.bh_max_drawdown_pct.toFixed(1)}%` : undefined}
                 color="red" />
            <Kpi label="Final"            value={fp(result.final)} sub={`from ${fp(result.initial)}`} />
          </div>

          {/* Risk-adjusted ratios — institutional grade metrics */}
          <div className="flex flex-wrap gap-3 mb-6">
            <Kpi label="Sharpe Ratio"    value={(result.sharpe ?? 0).toFixed(2)}
                 sub="ann. return / vol · 1.0+ is good"
                 color={(result.sharpe ?? 0) >= 1 ? "mint" : (result.sharpe ?? 0) >= 0.5 ? undefined : "red"} />
            <Kpi label="Sortino Ratio"   value={(result.sortino ?? 0).toFixed(2)}
                 sub="ignores upside vol"
                 color={(result.sortino ?? 0) >= 1.5 ? "mint" : (result.sortino ?? 0) >= 0.7 ? undefined : "red"} />
            <Kpi label="Calmar Ratio"    value={(result.calmar ?? 0).toFixed(2)}
                 sub="CAGR / max DD"
                 color={(result.calmar ?? 0) >= 0.5 ? "mint" : (result.calmar ?? 0) >= 0.2 ? undefined : "red"} />
            <Kpi label="Slippage Modeled" value={`${result.slippage_bps ?? 0} bps`}
                 sub="per fill (round-trip cost)" />
          </div>

          <div className="section-h">Equity Curve · Strategy vs. Buy & Hold</div>
          <div className="panel mb-7">
            <EquityChart strategy={result.equity} bh={result.bh_equity} />
          </div>

          <div className="section-h">Trade Log</div>
          <div className="panel p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
                  <th className="text-left  px-4 py-3">Date</th>
                  <th className="text-left  px-3 py-3">Side</th>
                  <th className="text-right px-3 py-3">Qty</th>
                  <th className="text-right px-3 py-3">Price</th>
                  <th className="text-right px-3 py-3">P&L</th>
                  <th className="text-left  px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.trades.map((t, i) => (
                  <tr key={i} className="border-b border-border1/50 last:border-b-0 hover:bg-card2/50">
                    <td className="px-4 py-2.5 text-muted text-[11px]">
                      {new Date(t.date * 1000).toLocaleDateString()}
                    </td>
                    <td className={`px-3 py-2.5 font-bold ${t.side === "BUY" ? "text-mint" : "text-red"}`}>
                      {t.side}
                    </td>
                    <td className="px-3 py-2.5 text-right">{t.qty}</td>
                    <td className="px-3 py-2.5 text-right">{fp(t.price)}</td>
                    <td className={`px-3 py-2.5 text-right ${clr(t.pnl)}`}>
                      {t.pnl ? fp(t.pnl) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-muted">{t.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function EquityChart({ strategy, bh }: { strategy: { t: number; v: number }[]; bh: { t: number; v: number }[] }) {
  if (!strategy.length) return null;
  const W = 800, H = 240;
  const all = [...strategy.map(p => p.v), ...bh.map(p => p.v)];
  const min = Math.min(...all), max = Math.max(...all), rng = max - min || 1;
  const x = (i: number, n: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - ((v - min) / rng) * H;
  const path = (pts: { t: number; v: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i, pts.length).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const final = strategy[strategy.length - 1].v;
  const start = strategy[0].v;
  const up = final >= start;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <path d={path(bh)} stroke="#71717a" strokeWidth="1.5" fill="none" strokeDasharray="4,4" />
        <path d={path(strategy)} stroke={up ? "#34d399" : "#f87171"} strokeWidth="2" fill="none" />
      </svg>
      <div className="flex gap-4 text-[11px] font-mono text-muted mt-2">
        <span><span className={up ? "text-mint" : "text-red"}>━</span> Strategy</span>
        <span><span className="text-muted">┄</span> Buy & Hold</span>
      </div>
    </div>
  );
}
