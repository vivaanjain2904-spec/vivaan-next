"use client";
import { useEffect, useState } from "react";
import StockSearch from "@/components/StockSearch";
import Chart from "@/components/Chart";
import { fp, fpp, clr } from "@/lib/format";

const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y"];

export default function ChartsPage() {
  const [tk, setTk] = useState("AAPL");
  const [range, setRange] = useState("1mo");
  const [quote, setQuote] = useState<any>(null);
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    if (!tk) return;
    fetch(`/api/quote/${tk}`).then(r => r.json()).then(j => setQuote(j.error ? null : j));
    fetch(`/api/chart/${tk}?range=${range}`).then(r => r.json()).then(j => setData(j.data ?? []));
  }, [tk, range]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex-1 min-w-[200px]"><StockSearch value={tk} onChange={setTk} /></div>
        <div className="flex gap-1 bg-card/60 border border-border1 rounded-full p-1">
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={[
                "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-full transition-all",
                range === r ? "bg-mint/15 text-mint" : "text-muted hover:text-ink",
              ].join(" ")}>{r}</button>
          ))}
        </div>
      </div>

      {quote && (
        <div className="flex items-baseline gap-4 mb-4 flex-wrap">
          <span className="tk-tag text-base">{tk}</span>
          <span className="text-3xl font-extrabold tracking-tight">{fp(quote.price)}</span>
          <span className={`font-mono font-bold ${clr(quote.pct)}`}>{fpp(quote.pct)} today</span>
          <span className="text-xs text-muted font-mono ml-auto">{quote.name}</span>
        </div>
      )}

      <div className="panel">
        {data.length > 0 ? <Chart data={data} /> :
          <div className="text-muted text-sm text-center py-12">Loading chart…</div>}
      </div>
    </>
  );
}
