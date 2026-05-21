"use client";
import { useEffect, useState } from "react";
import StockSearch from "@/components/StockSearch";
import Chart from "@/components/Chart";
import { fp, fpp, clr } from "@/lib/format";

type Quote = { ticker: string; price: number; pct: number; hi52: number; lo52: number; name: string };

export default function TradePage() {
  const [tab, setTab] = useState<"buy" | "sell" | "history">("buy");
  const [ticker, setTicker] = useState("");
  const [quote, setQuote]   = useState<Quote | null>(null);
  const [cash, setCash]     = useState(0);
  const [positions, setPositions] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [trades, setTrades] = useState<any[]>([]);
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // Initial load
  async function loadAll() {
    const r = await fetch("/api/portfolio").then(r => r.json());
    setCash(Number(r.user.cash));
    setPositions(r.positions);
    setQuotes(r.quotes);
  }
  useEffect(() => {
    loadAll();
    // Coming from Screener with a preselected ticker?
    if (typeof window !== "undefined") {
      const t = sessionStorage.getItem("trade_ticker");
      if (t) { setTicker(t); sessionStorage.removeItem("trade_ticker"); }
    }
  }, []);
  useEffect(() => {
    if (tab !== "history") return;
    fetch("/api/trade").then(r => r.json()).then(j => setTrades(j.trades ?? []));
  }, [tab]);

  // Live quote on ticker change
  useEffect(() => {
    if (!ticker) { setQuote(null); return; }
    fetch(`/api/quote/${ticker}`).then(r => r.json()).then(j => {
      if (j.error) setQuote(null); else setQuote(j);
    });
  }, [ticker]);

  return (
    <>
      <div className="seg mb-6">
        {(["buy","sell","history"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
                  className={tab === t ? "seg-btn-active" : "seg-btn"}>
            {t === "buy" ? "Browse & Buy" : t === "sell" ? "Sell / Manage" : "History"}
          </button>
        ))}
      </div>

      {msg && (
        <div className={[
          "mb-4 rounded-xl py-3 px-4 text-sm border-l-4",
          msg.ok ? "bg-mint/10 border-mint border border-mint/20 text-mint"
                 : "bg-red/10  border-red  border border-red/20  text-red",
        ].join(" ")}>{msg.text}</div>
      )}

      {tab === "buy" && (
        <>
          <label className="label">Search ticker</label>
          <StockSearch value={ticker} onChange={setTicker} />

          {quote && (
            <div className="mt-5">
              <QuoteCard q={quote} positions={positions} cash={cash} onTrade={async () => {
                await loadAll();
                fetch(`/api/quote/${ticker}`).then(r => r.json()).then(setQuote);
              }} onMsg={setMsg} />
            </div>
          )}
        </>
      )}

      {tab === "sell" && (
        <>
          <div className="section-h">Your Positions</div>
          {positions.length === 0 ? (
            <div className="panel text-muted text-sm">
              No holdings yet — go to <button className="text-mint underline" onClick={() => setTab("buy")}>Browse & Buy</button>.
            </div>
          ) : positions.map(p => {
            const q = quotes[p.ticker];
            if (!q) return null;
            const pnl = ((q.price - p.avg_cost) / p.avg_cost) * 100;
            return (
              <PositionRow key={p.ticker} p={p} q={q} pnl={pnl}
                onTrade={async () => { await loadAll(); }} onMsg={setMsg} />
            );
          })}
        </>
      )}

      {tab === "history" && (
        <>
          <div className="section-h">Trade History</div>
          <div className="panel p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/30">
                <tr className="text-[10px] uppercase tracking-[.16em] text-muted font-bold">
                  <th className="text-left  px-4 py-3">Time</th>
                  <th className="text-left  px-4 py-3">Side</th>
                  <th className="text-left  px-4 py-3">Ticker</th>
                  <th className="text-right px-4 py-3">Qty</th>
                  <th className="text-right px-4 py-3">Price</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {trades.map((t, i) => (
                  <tr key={i} className="border-t border-border1/60">
                    <td className="px-4 py-2.5 text-muted text-xs">
                      {new Date(t.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className={`px-4 py-2.5 font-bold ${t.side === "BUY" ? "text-mint" : "text-red"}`}>
                      {t.side === "BUY" ? "🟢 BUY" : "🔴 SELL"}
                    </td>
                    <td className="px-4 py-2.5"><span className="tk-tag">{t.ticker}</span></td>
                    <td className="px-4 py-2.5 text-right">{t.qty}</td>
                    <td className="px-4 py-2.5 text-right">{fp(Number(t.price))}</td>
                  </tr>
                ))}
                {trades.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No trades yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function QuoteCard({ q, positions, cash, onTrade, onMsg }: {
  q: Quote; positions: any[]; cash: number;
  onTrade: () => void; onMsg: (m: { ok: boolean; text: string }) => void;
}) {
  const [qty, setQty]   = useState(1);
  const [sl,  setSl]    = useState(5);
  const [tp,  setTp]    = useState(10);
  const [ab,  setAb]    = useState(0);
  const [bl,  setBl]    = useState(0);
  const [mlA, setMlA]   = useState(false);
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState<any[]>([]);
  const cost = qty * q.price;
  const inPort = positions.find(p => p.ticker === q.ticker);

  const [smart, setSmart] = useState<{ stop_loss: number; take_profit: number } | null>(null);
  const [smartOn, setSmartOn] = useState(false);

  useEffect(() => {
    fetch(`/api/chart/${q.ticker}?range=1mo`).then(r => r.json()).then(j => setChart(j.data ?? []));
    fetch(`/api/auth/me`).then(r => r.json()).then(j => setSmartOn(!!j.user?.smart_stops));
    fetch(`/api/smart-stops/${q.ticker}`).then(r => r.json()).then(j => {
      if (!j.error) setSmart(j);
    });
  }, [q.ticker]);

  async function buy() {
    setBusy(true);
    const r = await fetch("/api/trade", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: "BUY", ticker: q.ticker, qty, stop_loss: sl/100, take_profit: tp/100 }),
    });
    const j = await r.json(); setBusy(false);
    onMsg({ ok: r.ok, text: j.msg ?? j.error ?? "Done" });
    if (r.ok) onTrade();
  }
  async function watch() {
    const r = await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: q.ticker,
        alert_above: ab > 0 ? ab : null, alert_below: bl > 0 ? bl : null, ml_alert: mlA }),
    });
    const j = await r.json();
    onMsg({ ok: r.ok, text: r.ok ? `${q.ticker} added to watchlist` : (j.error ?? "Failed") });
  }

  return (
    <>
      <div className="panel mb-5">
        <div className="flex items-baseline gap-4 flex-wrap">
          <div>
            <div className="text-xs text-muted mb-1">{q.name}</div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tracking-tight text-ink">{fp(q.price)}</span>
              <span className={`font-mono text-sm font-semibold ${clr(q.pct)}`}>{fpp(q.pct)}</span>
            </div>
          </div>
          <div className="ml-auto text-[11px] text-muted font-mono">
            52W &nbsp;{fp(q.lo52)} – {fp(q.hi52)}
            {inPort && <span className="ml-3 pill-mint">✓ In Portfolio</span>}
          </div>
        </div>
      </div>

      {chart.length > 0 && (
        <div className="panel mb-5">
          <Chart data={chart} height={240} mode="area" />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel">
          <div className="section-h" style={{ marginTop: 0 }}>Paper Buy</div>
          <label className="label">Shares</label>
          <input type="number" className="input font-mono" min={1} step={1} value={qty}
                 onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}
                 placeholder="any amount" />
          {smartOn && smart ? (
            <div className="mt-3 p-3 bg-mint/8 border border-mint/25 rounded-lg text-[12px]">
              <div className="text-mint font-semibold mb-1.5">🧠 Smart stops on — bot is picking:</div>
              <div className="font-mono text-ink2">
                Stop-loss: <span className="text-red">−{(smart.stop_loss * 100).toFixed(1)}%</span>
                {"  ·  "}
                Take-profit: <span className="text-mint">+{(smart.take_profit * 100).toFixed(1)}%</span>
              </div>
              <div className="text-muted text-[10px] mt-1">
                Based on this stock's 14-day ATR (volatility). Sliders below are ignored.
              </div>
            </div>
          ) : null}
          <div className={`grid grid-cols-2 gap-3 mt-3 ${smartOn && smart ? "opacity-40 pointer-events-none" : ""}`}>
            <div>
              <label className="label">Stop Loss: {sl}%</label>
              <input type="range" min={1} max={30} value={sl}
                     onChange={e => setSl(Number(e.target.value))}
                     className="w-full accent-mint" />
            </div>
            <div>
              <label className="label">Take Profit: {tp}%</label>
              <input type="range" min={1} max={100} value={tp}
                     onChange={e => setTp(Number(e.target.value))}
                     className="w-full accent-mint" />
            </div>
          </div>
          <div className="text-xs text-muted mt-3 font-mono">
            Est. cost: <span className="text-ink font-bold">{fp(cost)}</span>
            &nbsp;·&nbsp; Cash: <span className="text-mint font-bold">{fp(cash)}</span>
          </div>
          <button disabled={busy || cost > cash} onClick={buy}
                  className="btn-mint w-full mt-4 disabled:opacity-40">
            {busy ? "…" : `✅ Buy ${qty} ${q.ticker}`}
          </button>
        </div>

        <div className="panel">
          <div className="section-h" style={{ marginTop: 0 }}>Add to Watchlist</div>
          <label className="label">Alert above ($)</label>
          <input type="number" className="input" step="0.01" value={ab}
                 onChange={e => setAb(Number(e.target.value))} />
          <label className="label mt-3">Alert below ($)</label>
          <input type="number" className="input" step="0.01" value={bl}
                 onChange={e => setBl(Number(e.target.value))} />
          <label className="flex items-center gap-2 mt-4 text-sm text-ink2 cursor-pointer">
            <input type="checkbox" checked={mlA} onChange={e => setMlA(e.target.checked)}
                   className="accent-mint" /> ML sell-signal alert
          </label>
          <button onClick={watch} className="btn-ghost w-full mt-4">👁 Watch {q.ticker}</button>
        </div>
      </div>
    </>
  );
}

function PositionRow({ p, q, pnl, onTrade, onMsg }: {
  p: any; q: Quote; pnl: number;
  onTrade: () => void; onMsg: (m: { ok: boolean; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sellQty, setSellQty] = useState(Number(p.qty));
  const [sl, setSl] = useState(Math.round((p.stop_loss || 0.05) * 100));
  const [tp, setTp] = useState(Math.round((p.take_profit || 0.10) * 100));
  const [busy, setBusy] = useState(false);

  async function sell() {
    setBusy(true);
    const r = await fetch("/api/trade", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: "SELL", ticker: p.ticker, qty: sellQty }),
    });
    const j = await r.json(); setBusy(false);
    onMsg({ ok: r.ok, text: j.msg ?? j.error ?? "Done" });
    if (r.ok) { setOpen(false); onTrade(); }
  }
  async function saveTargets() {
    const r = await fetch("/api/trade", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: p.ticker, stop_loss: sl/100, take_profit: tp/100 }),
    });
    onMsg({ ok: r.ok, text: r.ok ? "Targets updated" : "Failed" });
    if (r.ok) onTrade();
  }

  return (
    <div className="panel mb-3">
      <button onClick={() => setOpen(!open)}
              className="w-full flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <span className="tk-tag text-base">{p.ticker}</span>
          <span className="font-mono">{fp(q.price)}</span>
          <span className={`font-mono font-bold ${clr(pnl)}`}>{fpp(pnl)}</span>
        </div>
        <div className="text-xs text-muted font-mono">{p.qty} sh · {fp(q.price * Number(p.qty))}</div>
      </button>
      {open && (
        <div className="grid md:grid-cols-2 gap-4 mt-5 pt-5 border-t border-border1">
          <div>
            <div className="text-xs text-muted uppercase tracking-wider mb-2 font-bold">Sell</div>
            <label className="label">Shares to sell</label>
            <input type="number" className="input" min={1} max={Number(p.qty)}
                   value={sellQty} onChange={e => setSellQty(Math.max(1, Math.min(Number(p.qty), Number(e.target.value))))} />
            <div className="text-xs text-muted mt-2 font-mono">
              Proceeds: <span className="text-ink font-bold">{fp(sellQty * q.price)}</span>
            </div>
            <button disabled={busy} onClick={sell}
                    className="btn-red w-full mt-4">📤 Sell</button>
          </div>
          <div>
            <div className="text-xs text-muted uppercase tracking-wider mb-2 font-bold">Targets</div>
            <label className="label">Stop Loss: {sl}%</label>
            <input type="range" min={1} max={30} value={sl} onChange={e => setSl(Number(e.target.value))}
                   className="w-full accent-mint mb-3" />
            <label className="label">Take Profit: {tp}%</label>
            <input type="range" min={1} max={100} value={tp} onChange={e => setTp(Number(e.target.value))}
                   className="w-full accent-mint" />
            <button onClick={saveTargets} className="btn-ghost w-full mt-4">💾 Update Targets</button>
          </div>
        </div>
      )}
    </div>
  );
}
