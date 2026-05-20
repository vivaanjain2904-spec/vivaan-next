"use client";
import { useEffect, useState } from "react";
import StockSearch from "@/components/StockSearch";
import Chart from "@/components/Chart";
import { fp, fpp, fmtVol, fmtCap, clr } from "@/lib/format";

const RANGES: { k: string; label: string }[] = [
  { k: "1d",  label: "1D"  }, { k: "5d", label: "1W" },
  { k: "1mo", label: "1M"  }, { k: "3mo", label: "3M" },
  { k: "6mo", label: "6M"  }, { k: "1y",  label: "1Y" },
  { k: "2y",  label: "2Y"  }, { k: "5y",  label: "5Y" },
];

export default function ChartsPage() {
  const [tk, setTk] = useState("AAPL");
  const [range, setRange] = useState("1mo");
  const [quote, setQuote] = useState<any>(null);
  const [data, setData] = useState<any[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tk) return;
    fetch(`/api/quote/${tk}`).then(r => r.json()).then(j => setQuote(j.error ? null : j));
    fetch(`/api/news/${tk}`).then(r => r.json()).then(j => setNews(j.items ?? []));
  }, [tk]);

  useEffect(() => {
    if (!tk) return;
    setLoading(true); setData([]);
    fetch(`/api/chart/${tk}?range=${range}`)
      .then(r => r.json())
      .then(j => { setData(j.data ?? []); setLoading(false); });
  }, [tk, range]);

  return (
    <>
      <div className="grid md:grid-cols-[1fr_auto] gap-3 items-center mb-5">
        <StockSearch value={tk} onChange={setTk} />
        <div className="seg flex-shrink-0">
          {RANGES.map(r => (
            <button key={r.k} onClick={() => setRange(r.k)}
                    className={range === r.k ? "seg-btn-active" : "seg-btn"}>{r.label}</button>
          ))}
        </div>
      </div>

      {quote && (
        <div className="panel mb-4">
          <div className="flex items-baseline gap-4 flex-wrap">
            <div>
              <div className="text-xs text-muted">{quote.name}</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-3xl font-bold text-ink tracking-tight">{fp(quote.price)}</span>
                <span className={`text-sm font-mono font-semibold ${clr(quote.pct)}`}>{fpp(quote.pct)}</span>
              </div>
            </div>
            <div className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-[12px] font-mono">
              <Stat l="52W H"   v={fp(quote.hi52)} />
              <Stat l="52W L"   v={fp(quote.lo52)} />
              <Stat l="Mkt Cap" v={fmtCap(quote.mcap)} />
              <Stat l="Vol"     v={fmtVol(quote.vol)} />
              <Stat l="P/E"     v={quote.pe ? quote.pe.toFixed(2) : "—"} />
              <Stat l="EPS"     v={quote.eps ? `$${quote.eps.toFixed(2)}` : "—"} />
              <Stat l="Beta"    v={quote.beta ? quote.beta.toFixed(2) : "—"} />
              <Stat l="Avg Vol" v={fmtVol(quote.avgVol)} />
            </div>
          </div>
        </div>
      )}

      <div className="panel mb-7">
        {loading
          ? <div className="text-muted text-sm text-center py-16">Loading chart…</div>
          : data.length
            ? <Chart data={data} height={400} mode="area" />
            : <div className="text-muted text-sm text-center py-16">No chart data for {tk}.</div>}
      </div>

      {news.length > 0 && (
        <>
          <div className="section-h">Related News</div>
          <div className="grid md:grid-cols-2 gap-3">
            {news.slice(0, 6).map((n, i) => (
              <a key={i} href={n.link} target="_blank" rel="noreferrer"
                 className="panel-hover block">
                <div className="text-[11px] text-mint font-semibold uppercase tracking-wider mb-1.5">
                  {n.publisher}
                </div>
                <div className="text-sm text-ink font-medium leading-snug mb-2">{n.title}</div>
                <div className="text-[11px] text-muted font-mono">
                  {n.ts ? new Date(n.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted uppercase tracking-wider">{l}</div>
      <div className="text-ink text-[12px]">{v}</div>
    </div>
  );
}
