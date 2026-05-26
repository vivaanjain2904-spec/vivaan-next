"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sparkline from "@/components/Sparkline";
import { TableSkeleton } from "@/components/Skeleton";
import { fp, fpp, clr, fmtVol } from "@/lib/format";

/* Lucide-style stroke icons — used in the filter pills */
const ICON_PROPS = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  className: "w-3.5 h-3.5",
};
function IconGainers() { return (<svg {...ICON_PROPS}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>); }
function IconLosers()  { return (<svg {...ICON_PROPS}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>); }
function IconFlame()   { return (<svg {...ICON_PROPS}><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>); }
function IconGrid()    { return (<svg {...ICON_PROPS}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>); }
function IconBrain()   { return (<svg {...ICON_PROPS}><path d="M9 3a3 3 0 00-3 3 3 3 0 00-3 3v2a3 3 0 003 3v2a3 3 0 003 3 3 3 0 003-3M15 3a3 3 0 013 3 3 3 0 013 3v2a3 3 0 01-3 3v2a3 3 0 01-3 3 3 3 0 01-3-3"/></svg>); }

type Q = { ticker: string; price: number; pct: number; name: string; vol?: number };
type ML = { ticker: string; drop_probability: number; price?: number; rsi?: number; return_1m?: number };

export default function ScreenerPage() {
  const router = useRouter();
  const [data, setData] = useState<{
    gainers: Q[]; losers: Q[]; active: Q[]; all: Q[]; ml: ML[];
    scanned: number; universe: number; ts: string;
  } | null>(null);
  const [tab, setTab] = useState<"gainers" | "losers" | "active" | "all" | "ml">("gainers");
  const [search, setSearch] = useState("");
  const [computedSig, setComputedSig] = useState<Record<string, any> | null>(null);
  const [smartStops, setSmartStops]   = useState<Record<string, { stop_loss: number; take_profit: number }>>({});
  const [suggLoading, setSuggLoading] = useState(false);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const tickT = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    fetch("/api/screener")
      .then(r => r.json())
      .then(j => { setData(j); clearInterval(tickT); })
      .catch(() => clearInterval(tickT));
    return () => clearInterval(tickT);
  }, []);

  const tabs = [
    { k: "gainers", label: "Top Gainers",  Icon: IconGainers },
    { k: "losers",  label: "Top Losers",   Icon: IconLosers  },
    { k: "active",  label: "Most Active",  Icon: IconFlame   },
    { k: "all",     label: "All Stocks",   Icon: IconGrid    },
    { k: "ml",      label: "ML Signals",   Icon: IconBrain   },
  ] as const;

  // When the ML tab is opened, compute live signals for the top 30 active stocks
  // if there are no Python-uploaded signals.
  useEffect(() => {
    if (tab !== "ml" || !data || computedSig !== null || data.ml.length > 0) return;
    const ticks = data.active.slice(0, 30).map(q => q.ticker);
    if (!ticks.length) return;
    fetch("/api/signals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: ticks }),
    }).then(r => r.json()).then(j => setComputedSig(j.signals ?? {}));
  }, [tab, data, computedSig]);

  // For Top Gainers/Losers/Active tabs, lazily fetch signals + smart-stops
  // for the visible 25 rows so users see BUY/HOLD/SELL pills + target prices.
  useEffect(() => {
    if (!data || tab === "all" || tab === "ml") return;
    const visible = (tab === "gainers" ? data.gainers : tab === "losers" ? data.losers : data.active)
      .map(q => q.ticker);
    const need = visible.filter(t => !computedSig?.[t]);
    if (!need.length) return;
    setSuggLoading(true);
    fetch("/api/signals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: need }),
    }).then(r => r.json()).then(async j => {
      setComputedSig(prev => ({ ...(prev ?? {}), ...(j.signals ?? {}) }));
      // Fetch smart-stop levels in parallel (no auth required)
      const stops = await Promise.all(
        need.map(t => fetch(`/api/smart-stops/${t}`).then(r => r.json()).catch(() => null))
      );
      setSmartStops(prev => {
        const out = { ...prev };
        need.forEach((t, i) => { if (stops[i] && !stops[i].error) out[t] = stops[i]; });
        return out;
      });
      setSuggLoading(false);
    });
  }, [tab, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // For the ML tab, prefer Python overrides; otherwise fall back to computed signals.
  const mlRows: any[] =
    data ? (data.ml.length
      ? data.ml
      : Object.entries(computedSig ?? {}).map(([ticker, s]: any) => ({
          ticker,
          drop_probability: s.dropProb,
          price: data.active.find(q => q.ticker === ticker)?.price,
          rsi: s.rsi,
          return_1m: s.momentum1m != null ? s.momentum1m / 100 : null,
          source: s.source ?? "live",
        })).sort((a, b) => b.drop_probability - a.drop_probability)
    ) : [];

  const baseRows: any[] =
    data ? (tab === "gainers" ? data.gainers :
            tab === "losers"  ? data.losers  :
            tab === "active"  ? data.active  :
            tab === "all"     ? data.all     : mlRows) : [];

  const q = search.trim().toUpperCase();
  const rowsList = q
    ? baseRows.filter((r: any) =>
        String(r.ticker).toUpperCase().includes(q) ||
        String(r.name ?? "").toUpperCase().includes(q))
    : baseRows;

  function trade(tk: string) {
    sessionStorage.setItem("trade_ticker", tk);
    router.push("/trade");
  }
  async function watch(tk: string) {
    await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: tk, ml_alert: true }),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Market Screener</h1>
          <div className="text-[12px] text-muted mt-0.5">
            {data
              ? <>Scanned {data.scanned} of {data.universe} stocks &nbsp;·&nbsp; updated {new Date(data.ts).toLocaleTimeString()}</>
              : <>Scanning the full universe… <span className="text-mint font-mono">{secs}s</span></>}
          </div>
        </div>
        <div className="seg">
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k as any)}
                    className={`${tab === t.k ? "seg-btn-active" : "seg-btn"} inline-flex items-center gap-1.5`}>
              <t.Icon />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "all" && (
        <div className="mb-3">
          <input
            className="input max-w-md font-mono"
            placeholder={`Filter ${data?.all.length ?? 546} stocks (e.g. NVDA, Apple)`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      {data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat l="Best Performer" v={data.gainers[0]?.ticker ?? "—"}
                s={data.gainers[0] ? fpp(data.gainers[0].pct) : ""} color="mint" />
          <Stat l="Worst Performer" v={data.losers[0]?.ticker ?? "—"}
                s={data.losers[0] ? fpp(data.losers[0].pct) : ""} color="red" />
          <Stat l="Highest Volume" v={data.active[0]?.ticker ?? "—"}
                s={data.active[0] ? fmtVol(data.active[0].vol) : ""} />
          <Stat l="ML Signals" v={String(data.ml.length)} s={data.ml.length ? "in database" : "none yet"} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {Array.from({length: 4}).map((_, i) => (
            <div key={i} className="panel"><div className="h-14 bg-card2 rounded animate-shimmer" /></div>
          ))}
        </div>
      )}

      <div className="panel p-0 overflow-x-auto animate-fade-up">
        {!data ? (
          <TableSkeleton rows={10} />
        ) : tab === "ml" && rowsList.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3 animate-pulse">🤖</div>
            <div className="text-ink font-semibold mb-1">Computing signals…</div>
            <div className="text-muted text-sm max-w-md mx-auto mb-2">
              Real-time RSI + moving-average + momentum signal for the top 30 most-active stocks.
            </div>
            <div className="text-muted text-[11px] max-w-md mx-auto mt-3">
              Want your own trained ML model? Run <code className="text-mint">python screener.py</code> locally,
              then <code className="text-mint">python upload-screener.py</code> — uploaded scores override the live signal.
            </div>
          </div>
        ) : rowsList.length === 0 ? (
          <div className="p-12 text-center text-muted">No results.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
                <th className="text-left  px-5 py-3 w-8">#</th>
                <th className="text-left  px-3 py-3">Symbol</th>
                <th className="text-left  px-2 py-3">Trend</th>
                <th className="text-right px-3 py-3">Price</th>
                {tab === "ml" ? (
                  <>
                    <th className="text-right px-3 py-3">Drop Prob</th>
                    <th className="text-right px-3 py-3">RSI</th>
                    <th className="text-right px-3 py-3">1M Ret</th>
                  </>
                ) : (
                  <>
                    <th className="text-right px-3 py-3">Day %</th>
                    <th className="text-right px-3 py-3 hidden md:table-cell">Volume</th>
                    <th className="text-center px-3 py-3">
                      Signal {suggLoading && <span className="text-mint animate-pulse">•</span>}
                    </th>
                    <th className="text-right px-3 py-3 hidden lg:table-cell">Buy ≤</th>
                    <th className="text-right px-3 py-3 hidden lg:table-cell">Sell @</th>
                  </>
                )}
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rowsList.map((r: any, i: number) => {
                const pct = r.pct as number | undefined;
                const barWidth = pct != null ? Math.min(Math.abs(pct) * 5, 100) : 0;
                return (
                  <tr key={r.ticker} className="border-b border-border1/40 last:border-b-0 hover:bg-card2/50 transition-colors animate-fade-up">
                    <td className="px-5 py-3 text-muted text-[11px]">{i + 1}</td>
                    <td className="px-3 py-3 font-sans">
                      <div className="text-ink font-semibold">{r.ticker}</div>
                      {r.name && <div className="text-muted text-[11px] truncate max-w-[140px]">{r.name}</div>}
                    </td>
                    <td className="px-2 py-3"><Sparkline ticker={r.ticker} /></td>
                    <td className="px-3 py-3 text-right text-ink">{fp(r.price)}</td>
                    {tab === "ml" ? (
                      <>
                        <td className="px-3 py-3 text-right">
                          <span className={
                            r.drop_probability >= 0.65 ? "pill-red"  :
                            r.drop_probability <= 0.35 ? "pill-mint" : "pill-muted"
                          }>{(r.drop_probability * 100).toFixed(0)}%</span>
                        </td>
                        <td className="px-3 py-3 text-right text-ink2">
                          {r.rsi != null ? Number(r.rsi).toFixed(1) : "—"}
                        </td>
                        <td className={`px-3 py-3 text-right ${clr(Number(r.return_1m ?? 0) * 100)}`}>
                          {r.return_1m != null ? fpp(Number(r.return_1m) * 100) : "—"}
                        </td>
                      </>
                    ) : (() => {
                      const sig = computedSig?.[r.ticker];
                      const stops = smartStops[r.ticker];
                      const buyAt  = sig && stops && r.price && sig.recommendation === "BUY"
                        ? r.price * (1 - stops.stop_loss * 0.5)  // halfway between live price and stop
                        : null;
                      const sellAt = sig && stops && r.price && sig.recommendation !== "SELL"
                        ? r.price * (1 + stops.take_profit)
                        : null;
                      return (
                        <>
                          <td className={`px-3 py-3 text-right font-semibold ${clr(pct ?? 0)}`}>{fpp(pct ?? 0)}</td>
                          <td className="px-3 py-3 text-right text-ink2 hidden md:table-cell">{fmtVol(r.vol)}</td>
                          <td className="px-3 py-3 text-center">
                            {sig ? (
                              <span className={
                                sig.recommendation === "BUY"  ? "pill-mint" :
                                sig.recommendation === "SELL" ? "pill-red"  :
                                                                "pill-muted"
                              }>{sig.recommendation}</span>
                            ) : <span className="text-muted text-[11px]">—</span>}
                          </td>
                          <td className="px-3 py-3 text-right text-mint hidden lg:table-cell">
                            {buyAt ? fp(buyAt) : "—"}
                          </td>
                          <td className="px-3 py-3 text-right text-amber hidden lg:table-cell">
                            {sellAt ? fp(sellAt) : "—"}
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => trade(r.ticker)}
                                className="text-[11px] px-2 py-1 rounded bg-mint/10 text-mint hover:bg-mint/20 transition-colors font-semibold">
                          Trade
                        </button>
                        <button onClick={() => watch(r.ticker)}
                                className="text-[11px] px-2 py-1 rounded bg-amber/10 text-amber hover:bg-amber/20 transition-colors font-semibold">
                          Watch
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Stat({ l, v, s, color }: { l: string; v: string; s?: string; color?: "mint" | "red" }) {
  const c = color === "mint" ? "text-mint" : color === "red" ? "text-red" : "text-ink";
  return (
    <div className="panel">
      <div className="text-[11px] text-muted font-semibold mb-1.5">{l}</div>
      <div className={`text-lg font-bold ${c}`}>{v}</div>
      {s && <div className="text-[11px] text-muted font-mono mt-0.5">{s}</div>}
    </div>
  );
}
