"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sparkline from "@/components/Sparkline";
import { TableSkeleton } from "@/components/Skeleton";
import { fp, fpp, clr, fmtVol } from "@/lib/format";

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
    { k: "gainers", label: "Top Gainers",  icon: "📈" },
    { k: "losers",  label: "Top Losers",   icon: "📉" },
    { k: "active",  label: "Most Active",  icon: "🔥" },
    { k: "all",     label: "All Stocks",   icon: "📋" },
    { k: "ml",      label: "ML Signals",   icon: "🤖" },
  ] as const;

  const baseRows: any[] =
    data ? (tab === "gainers" ? data.gainers :
            tab === "losers"  ? data.losers  :
            tab === "active"  ? data.active  :
            tab === "all"     ? data.all     : data.ml) : [];

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
                    className={tab === t.k ? "seg-btn-active" : "seg-btn"}>
              {t.icon} {t.label}
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
            <div className="text-3xl mb-3">🤖</div>
            <div className="text-ink font-semibold mb-1">No ML signals yet</div>
            <div className="text-muted text-sm max-w-md mx-auto mb-4">
              ML drop-probability scores come from your local Python screener.
            </div>
            <code className="text-mint text-[11px] block bg-card2 p-3 rounded-lg font-mono text-left max-w-md mx-auto">
              cd ~/ai-portfolio-agent<br />
              python screener.py<br />
              cd ../vivaan-next/scripts<br />
              python upload-screener.py
            </code>
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
                    <th className="text-right px-3 py-3">Volume</th>
                    <th className="text-right px-3 py-3 hidden md:table-cell">Bar</th>
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
                    ) : (
                      <>
                        <td className={`px-3 py-3 text-right font-semibold ${clr(pct ?? 0)}`}>{fpp(pct ?? 0)}</td>
                        <td className="px-3 py-3 text-right text-ink2">{fmtVol(r.vol)}</td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          <div className="ml-auto w-[100px] h-1.5 bg-card2 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${(pct ?? 0) >= 0 ? "bg-mint" : "bg-red"}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </td>
                      </>
                    )}
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
