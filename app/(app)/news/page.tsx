"use client";
import { useEffect, useState } from "react";
import StockSearch from "@/components/StockSearch";

type Item = { title: string; publisher: string; link: string; ts: number; thumb?: string; _tk: string };
type Mode = "mine" | "trending" | "search";

export default function NewsPage() {
  const [mode, setMode] = useState<Mode>("mine");
  const [tracked, setTracked] = useState<string[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [searchTk, setSearchTk] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  // Load tracked + trending tickers once
  useEffect(() => {
    fetch("/api/portfolio").then(r => r.json()).then(j => {
      const all = Array.from(new Set<string>([
        ...j.positions.map((p: any) => p.ticker),
        ...j.watchlist.map((w: any) => w.ticker),
      ])).sort();
      setTracked(all.length ? all : ["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL", "AMZN", "META"]);
    });
    fetch("/api/screener").then(r => r.json()).then(j => {
      const ticks = Array.from(new Set<string>([
        ...(j.gainers ?? []).slice(0, 4).map((q: any) => q.ticker),
        ...(j.losers  ?? []).slice(0, 4).map((q: any) => q.ticker),
        ...(j.active  ?? []).slice(0, 4).map((q: any) => q.ticker),
      ]));
      setTrending(ticks);
    });
  }, []);

  // Fetch news whenever the active source changes
  useEffect(() => {
    const ticks =
      mode === "search"   ? (searchTk ? [searchTk] : []) :
      mode === "trending" ? trending :
                            tracked;
    if (!ticks.length) { setItems([]); return; }
    setLoading(true);
    Promise.all(ticks.map(t =>
      fetch(`/api/news/${t}`).then(r => r.json()).then(j =>
        (j.items || []).map((it: any) => ({ ...it, _tk: t }))
      )
    )).then(arr => {
      const flat: Item[] = ([] as Item[]).concat(...arr).sort((a, b) => b.ts - a.ts);
      setItems(flat); setLoading(false);
    });
  }, [mode, searchTk, tracked, trending]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-ink">Market News</h1>
          <div className="text-[12px] text-muted mt-0.5">
            {mode === "mine"     && <>{tracked.length} tracked stocks</>}
            {mode === "trending" && <>Top movers · {trending.length} stocks</>}
            {mode === "search"   && (searchTk ? <>News for {searchTk}</> : <>Pick any of 546 stocks</>)}
            &nbsp;·&nbsp; {items.length} headlines
          </div>
        </div>
        <div className="seg">
          <button onClick={() => setMode("mine")}     className={mode === "mine"     ? "seg-btn-active" : "seg-btn"}>👤 My Stocks</button>
          <button onClick={() => setMode("trending")} className={mode === "trending" ? "seg-btn-active" : "seg-btn"}>🔥 Trending</button>
          <button onClick={() => setMode("search")}   className={mode === "search"   ? "seg-btn-active" : "seg-btn"}>🔍 Search 546</button>
        </div>
      </div>

      {mode === "search" && (
        <div className="mb-5 max-w-md">
          <StockSearch value={searchTk} onChange={setSearchTk}
                       placeholder="Search any of 546 stocks for news…" />
        </div>
      )}

      {loading && (
        <div className="grid md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel">
              <div className="h-3 w-1/3 bg-card2 rounded animate-shimmer mb-3" />
              <div className="h-4 bg-card2 rounded animate-shimmer mb-2" />
              <div className="h-4 w-3/4 bg-card2 rounded animate-shimmer" />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="panel text-muted text-sm text-center py-10">
          {mode === "search" && !searchTk
            ? "Pick a stock from the dropdown to load its news."
            : "No news right now."}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {items.slice(0, 40).map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noreferrer"
             className="panel-hover block group animate-fade-up">
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
              {n.thumb && (
                <img src={n.thumb} alt=""
                     className="w-20 h-14 object-cover rounded-md flex-shrink-0 border border-border1" />
              )}
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
