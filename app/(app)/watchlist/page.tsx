"use client";
import { useEffect, useState } from "react";
import StockSearch from "@/components/StockSearch";
import { fp } from "@/lib/format";
import { useTickerNames } from "@/lib/useTickerNames";

export default function WatchlistPage() {
  const tickerNames = useTickerNames();
  const [items, setItems] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [ml, setMl] = useState<Record<string, number>>({});
  const [tk, setTk] = useState(""); const [ab, setAb] = useState(0);
  const [bl, setBl] = useState(0); const [mlA, setMlA] = useState(true);
  const [msg, setMsg] = useState("");

  async function load() {
    const j = await fetch("/api/portfolio").then(r => r.json());
    setItems(j.watchlist); setQuotes(j.quotes); setMl(j.ml);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!tk) return;
    const r = await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: tk, alert_above: ab > 0 ? ab : null,
                             alert_below: bl > 0 ? bl : null, ml_alert: mlA }),
    });
    if (r.ok) { setTk(""); setAb(0); setBl(0); load(); setMsg(""); }
    else setMsg("Failed to add");
  }
  async function remove(t: string) {
    await fetch(`/api/watchlist?ticker=${t}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <div className="section-h">Your Watchlist</div>
      {items.length === 0 ? (
        <div className="panel text-muted text-sm">Nothing on your watchlist yet. Add one below.</div>
      ) : (
        <div className="panel p-0 overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr className="text-[10px] uppercase tracking-[.16em] text-muted font-bold">
                <th className="text-left  px-4 py-3">Ticker</th>
                <th className="text-right px-4 py-3">Price</th>
                <th className="text-right px-4 py-3">Alert &gt;</th>
                <th className="text-right px-4 py-3">Alert &lt;</th>
                <th className="text-right px-4 py-3">ML</th>
                <th className="text-right px-4 py-3">ML Risk</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="font-mono">
              {items.map(w => {
                const q = quotes[w.ticker];
                return (
                  <tr key={w.ticker} className="border-t border-border1/60 hover:bg-mint/5">
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="tk-tag w-fit">{w.ticker}</span>
                        {tickerNames[w.ticker] && (
                          <span className="font-sans text-[10px] text-muted truncate max-w-[200px]">{tickerNames[w.ticker]}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{q ? fp(q.price) : "—"}</td>
                    <td className="px-4 py-3 text-right text-mint">{w.alert_above ? fp(Number(w.alert_above)) : "—"}</td>
                    <td className="px-4 py-3 text-right text-red">{w.alert_below ? fp(Number(w.alert_below)) : "—"}</td>
                    <td className="px-4 py-3 text-right">{w.ml_alert ? "✓" : "—"}</td>
                    <td className="px-4 py-3 text-right text-amber">
                      {ml[w.ticker] != null ? `${(ml[w.ticker] * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => remove(w.ticker)}
                              className="text-red text-xs hover:underline">Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-h">Add Stock</div>
      <div className="panel">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Stock</label>
            <StockSearch value={tk} onChange={setTk} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Alert above $</label>
              <input type="number" className="input" step="0.01" value={ab}
                     onChange={e => setAb(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Alert below $</label>
              <input type="number" className="input" step="0.01" value={bl}
                     onChange={e => setBl(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
          <input type="checkbox" checked={mlA} onChange={e => setMlA(e.target.checked)}
                 className="accent-mint" />
          <span>Send ML sell-signal alerts</span>
        </label>
        <button onClick={add} disabled={!tk} className="btn-mint mt-4 disabled:opacity-40">
          + Add to Watchlist
        </button>
        {msg && <div className="text-red text-xs mt-2">{msg}</div>}
      </div>
    </>
  );
}
