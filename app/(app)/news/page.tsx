"use client";
import { useEffect, useState } from "react";

type Item = { title: string; publisher: string; link: string; ts: number; thumb?: string; _tk: string };

export default function NewsPage() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [sel, setSel] = useState<string>("All");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/portfolio").then(r => r.json()).then(j => {
      const tracked = Array.from(new Set<string>([
        ...j.positions.map((p: any) => p.ticker),
        ...j.watchlist.map((w: any) => w.ticker),
      ])).sort();
      // If user has nothing tracked yet, fall back to broad market news.
      setTickers(tracked.length ? tracked : ["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL", "AMZN", "META"]);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const ts = sel === "All" ? tickers : [sel];
    if (!ts.length) { setItems([]); setLoading(false); return; }
    Promise.all(ts.map(t =>
      fetch(`/api/news/${t}`).then(r => r.json()).then(j => (j.items || []).map((it: any) => ({ ...it, _tk: t })))
    )).then(arr => {
      const flat: Item[] = ([] as Item[]).concat(...arr).sort((a, b) => b.ts - a.ts);
      setItems(flat); setLoading(false);
    });
  }, [sel, tickers]);

  return (
    <>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="section-h flex-1" style={{ marginTop: 0, marginBottom: 0 }}>Market News</div>
        <select className="input max-w-[200px]" value={sel} onChange={e => setSel(e.target.value)}>
          <option value="All">All Tracked</option>
          {tickers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading && <div className="panel text-muted text-sm">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="panel text-muted text-sm">No news right now.</div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {items.slice(0, 30).map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noreferrer"
             className="panel-hover block group">
            <div className="flex items-center gap-2 mb-2">
              <span className="tk-tag">{n._tk}</span>
              <span className="text-[11px] text-mint font-semibold uppercase tracking-wider">{n.publisher}</span>
              <span className="text-[11px] text-muted font-mono ml-auto">
                {n.ts ? new Date(n.ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
              </span>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 text-sm font-medium text-ink leading-snug group-hover:text-mint transition-colors">
                {n.title}
              </div>
              {(n as any).thumb && (
                <img src={(n as any).thumb} alt=""
                     className="w-20 h-14 object-cover rounded-md flex-shrink-0 border border-border1" />
              )}
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
