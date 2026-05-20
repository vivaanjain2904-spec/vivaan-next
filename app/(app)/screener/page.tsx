"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sparkline from "@/components/Sparkline";
import { fp, fpp, clr, fmtVol } from "@/lib/format";

type Q = { ticker: string; price: number; pct: number; name: string; vol?: number };
type ML = { ticker: string; drop_probability: number; price?: number; rsi?: number; return_1m?: number };

export default function ScreenerPage() {
  const router = useRouter();
  const [data, setData] = useState<{ gainers: Q[]; losers: Q[]; active: Q[]; ml: ML[]; ts: string } | null>(null);
  const [tab, setTab] = useState<"gainers" | "losers" | "active" | "ml">("gainers");

  useEffect(() => {
    fetch("/api/screener").then(r => r.json()).then(setData);
  }, []);

  if (!data) return <div className="panel text-muted text-sm">Scanning market…</div>;

  const tabs = [
    { k: "gainers", label: "Top Gainers" },
    { k: "losers",  label: "Top Losers"  },
    { k: "active",  label: "Most Active" },
    { k: "ml",      label: "ML Signals"  },
  ] as const;

  const rowsList: any[] =
    tab === "gainers" ? data.gainers :
    tab === "losers"  ? data.losers  :
    tab === "active"  ? data.active  :
    data.ml;

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
        <div className="seg">
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
                    className={tab === t.k ? "seg-btn-active" : "seg-btn"}>{t.label}</button>
          ))}
        </div>
        <div className="text-[11px] text-muted font-mono">
          Updated {new Date(data.ts).toLocaleTimeString()}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat l="Top Gainer" v={data.gainers[0]?.ticker ?? "—"}
              s={data.gainers[0] ? fpp(data.gainers[0].pct) : ""} color="mint" />
        <Stat l="Top Loser"  v={data.losers[0]?.ticker ?? "—"}
              s={data.losers[0] ? fpp(data.losers[0].pct) : ""} color="red" />
        <Stat l="Most Active" v={data.active[0]?.ticker ?? "—"}
              s={data.active[0] ? fmtVol(data.active[0].vol) : ""} />
        <Stat l="ML Signals" v={String(data.ml.length)} s="in DB" />
      </div>

      <div className="panel p-0 overflow-x-auto">
        {tab === "ml" && rowsList.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-ink font-semibold mb-2">No ML signals yet</div>
            <div className="text-muted text-sm max-w-md mx-auto">
              Run your local Python screener and upload to Postgres:<br />
              <code className="text-mint text-xs block mt-2">
                cd ~/ai-portfolio-agent &amp;&amp; python screener.py<br />
                cd ../vivaan-next/scripts &amp;&amp; python upload-screener.py
              </code>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
                <th className="text-left  px-5 py-3">Symbol</th>
                <th className="text-left  px-2 py-3">Trend</th>
                <th className="text-right px-3 py-3">Price</th>
                {tab === "ml"
                  ? (<>
                      <th className="text-right px-3 py-3">Drop Prob</th>
                      <th className="text-right px-3 py-3">RSI</th>
                      <th className="text-right px-3 py-3">1M Ret</th>
                    </>)
                  : (<>
                      <th className="text-right px-3 py-3">Day %</th>
                      <th className="text-right px-3 py-3">Volume</th>
                    </>)
                }
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rowsList.map((r: any) => (
                <tr key={r.ticker} className="border-b border-border1/50 last:border-b-0 hover:bg-card2/50">
                  <td className="px-5 py-3 font-sans">
                    <div className="text-ink font-semibold">{r.ticker}</div>
                    {r.name && <div className="text-muted text-[11px] truncate max-w-[160px]">{r.name}</div>}
                  </td>
                  <td className="px-2 py-3"><Sparkline ticker={r.ticker} /></td>
                  <td className="px-3 py-3 text-right text-ink">{fp(r.price)}</td>
                  {tab === "ml" ? (
                    <>
                      <td className="px-3 py-3 text-right">
                        <span className={
                          r.drop_probability >= 0.65 ? "pill-red"  :
                          r.drop_probability <= 0.35 ? "pill-mint" :
                                                       "pill-muted"
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
                      <td className={`px-3 py-3 text-right font-semibold ${clr(r.pct)}`}>{fpp(r.pct)}</td>
                      <td className="px-3 py-3 text-right text-ink2">{fmtVol(r.vol)}</td>
                    </>
                  )}
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => trade(r.ticker)}
                              className="text-[11px] text-mint hover:underline">Trade</button>
                      <button onClick={() => watch(r.ticker)}
                              className="text-[11px] text-amber hover:underline">Watch</button>
                    </div>
                  </td>
                </tr>
              ))}
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
