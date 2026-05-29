"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fp } from "@/lib/format";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [ntfy, setNtfy] = useState("");
  const [disc, setDisc] = useState("");
  const [email, setEmail] = useState("");
  const [mlOn, setMlOn] = useState(true);
  const [mlThr, setMlThr] = useState(0.65);
  const [apKey, setApKey] = useState("");
  const [apSec, setApSec] = useState("");
  const [autoT, setAutoT] = useState(false);
  const [smartStops, setSmartStops] = useState(false);
  const [autoBuySize, setAutoBuySize] = useState(500);
  // Autonomous mode + safety rails
  const [autoMode, setAutoMode] = useState(false);
  const [scanUniverse, setScanUniverse] = useState(false);
  const [maxPositions, setMaxPositions] = useState(15);
  const [maxPosPct, setMaxPosPct] = useState(0.08);
  const [cashReservePct, setCashReservePct] = useState(0.15);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [recent, setRecent] = useState<any[]>([]);
  const [seedRes, setSeedRes] = useState<any>(null);
  const [pingRes, setPingRes] = useState<any>(null);
  const [runRes, setRunRes]   = useState<any>(null);
  const [notifyRes, setNotifyRes] = useState<any>(null);

  async function load() {
    const j = await fetch("/api/auth/me").then(r => r.json());
    if (!j.user) return;
    setUser(j.user);
    setNtfy(j.user.ntfy_topic ?? "");
    setDisc(j.user.discord_webhook ?? "");
    setEmail(j.user.email ?? "");
    setMlOn(!!j.user.ml_alerts);
    setMlThr(Number(j.user.ml_threshold ?? 0.65));
    setApKey(j.user.alpaca_key ?? "");
    setApSec(j.user.alpaca_secret ? "•••••••••••" : "");
    setAutoT(!!j.user.auto_trade);
    setSmartStops(!!j.user.smart_stops);
    setAutoBuySize(Number(j.user.auto_buy_size) || 500);
    setAutoMode(!!j.user.autonomous_mode);
    setScanUniverse(!!j.user.auto_scan_universe);
    setMaxPositions(Number(j.user.max_positions) || 15);
    setMaxPosPct(Number(j.user.max_pos_pct) || 0.08);
    setCashReservePct(Number(j.user.cash_reserve_pct) || 0.15);
    const nj = await fetch("/api/notifications").then(r => r.json());
    setRecent(nj.recent ?? []);
  }
  useEffect(() => { load(); }, []);

  async function saveSettings() {
    const body: any = {
      ntfy_topic: ntfy, discord_webhook: disc, email,
      ml_alerts: mlOn, ml_threshold: mlThr,
      alpaca_key: apKey, auto_trade: autoT,
      smart_stops: smartStops,
      auto_buy_size: autoBuySize,
      autonomous_mode: autoMode,
      auto_scan_universe: scanUniverse,
      max_positions: maxPositions,
      max_pos_pct: maxPosPct,
      cash_reserve_pct: cashReservePct,
    };
    // Only send secret if user typed a new one (not the masked value)
    if (apSec && !apSec.startsWith("•")) body.alpaca_secret = apSec;
    const r = await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMsg(r.ok ? "Saved!" : "Save failed"); setTimeout(() => setMsg(""), 3000);
    load();
  }
  async function testNotify() {
    setNotifyRes({ loading: true });
    const r = await fetch("/api/test-notify", { method: "POST" });
    const j = await r.json();
    setNotifyRes(j);
  }
  async function pingAlpaca() {
    setPingRes({ loading: true });
    const r = await fetch("/api/alpaca-ping", { method: "POST" });
    const j = await r.json();
    setPingRes(j);
  }
  async function runAlertCheck() {
    setRunRes({ loading: true });
    const r = await fetch("/api/run-alerts-self", { method: "POST" });
    const j = await r.json();
    setRunRes(j);
  }
  async function seedDemo() {
    setSeedRes({ loading: true });
    const r = await fetch("/api/seed-demo", { method: "POST" });
    const j = await r.json();
    setSeedRes(j);
    load();
  }
  async function changePw() {
    if (pw !== pw2) { setMsg("Passwords don't match"); return; }
    const r = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setMsg(r.ok ? "Password updated" : "Failed"); setPw(""); setPw2("");
  }
  async function resetAccount() {
    const input = prompt("Wipe all positions/trades and reset cash to what amount? (any number)", "100000");
    if (input === null) return;
    const amount = Math.max(0, Number(input) || 0);
    await fetch(`/api/settings?cash=${amount}`, { method: "DELETE" });
    setMsg(`Account reset to ${fp(amount)}`); load();
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  if (!user) return <div className="panel text-muted text-sm">Loading…</div>;

  return (
    <>
      {msg && <div className="panel mb-4 text-mint text-sm">{msg}</div>}

      {/* Notifications */}
      <div className="section-h">Notifications</div>
      <div className="panel mb-6">
        <div className="text-sm text-ink2 mb-4 leading-relaxed">
          Pick one or more channels. <b className="text-mint">Alerts fire for stop-loss, take-profit, ML signals,
          and auto-trade receipts.</b> Save → Test from inside this panel to confirm each one is wired up.
        </div>

        <label className="label">📱 ntfy.sh topic (push to phone)</label>
        <input className="input font-mono" value={ntfy} onChange={e => setNtfy(e.target.value)}
               placeholder={`e.g. vivaan-stocks-${Math.random().toString(36).slice(2, 7)}`} />
        <div className="text-muted text-[11px] mt-1.5">
          Install the <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="text-mint underline">ntfy</a> app, subscribe to this topic, and you'll get instant phone push.
        </div>

        <label className="label mt-4">💬 Discord webhook</label>
        <input className="input font-mono text-xs" value={disc} onChange={e => setDisc(e.target.value)}
               placeholder="https://discord.com/api/webhooks/…" />

        <label className="label mt-4">📧 Email</label>
        <input type="email" className="input font-mono text-xs" value={email}
               onChange={e => setEmail(e.target.value)}
               placeholder="you@example.com" autoComplete="email" />
        <div className="text-muted text-[11px] mt-1.5 leading-relaxed">
          Sent via Resend from <span className="font-mono">onboarding@resend.dev</span> by default.
          Verify <span className="font-mono">vaelor.dev</span> in your Resend dashboard to send from a custom address.
        </div>

        {/* Inline test + result (so user doesn't have to scroll to the bottom) */}
        <div className="mt-5 pt-5 border-t border-border1 flex flex-wrap gap-2 items-center">
          <button onClick={testNotify} className="btn-mint text-[12px]">📨 Send Test Notification</button>
          <span className="text-muted text-[11px]">Tries every channel above and reports per-channel status.</span>
        </div>
        {notifyRes && <NotifyResultInline res={notifyRes} />}

        <label className="flex items-center gap-2 mt-5 text-sm cursor-pointer">
          <input type="checkbox" checked={mlOn} onChange={e => setMlOn(e.target.checked)}
                 className="accent-mint" />
          <span>Enable ML sell-signal alerts</span>
        </label>
        <label className="label mt-3">ML threshold: {(mlThr * 100).toFixed(0)}%</label>
        <input type="range" min={0.5} max={0.95} step={0.05} value={mlThr}
               onChange={e => setMlThr(Number(e.target.value))} className="w-full accent-mint" />
      </div>

      {/* Auto-Trader */}
      <div className="section-h">Auto-Trader · Alpaca Paper</div>
      <div className="panel mb-6">
        <div className="text-sm text-ink2 mb-4 leading-relaxed">
          When a stop / target / ML signal trips on a holding, the cron will
          automatically place a paper sell via Alpaca and notify your phone with the receipt.
          <br /><br />
          <b className="text-mint">Get free paper-trading keys:</b> sign up at
          {" "}<a href="https://alpaca.markets/" target="_blank" rel="noreferrer" className="text-mint underline">alpaca.markets</a>,
          go to <b>Paper Trading → API Keys</b>, generate, paste below.
          Always paper — never live (forced for safety).
        </div>
        <label className="label">Alpaca API key</label>
        <input className="input font-mono text-xs" value={apKey} onChange={e => setApKey(e.target.value)}
               placeholder="PKxxxxxxxxxxxxxxx" autoComplete="off" />
        <label className="label mt-3">Alpaca API secret</label>
        <input type="password" className="input font-mono text-xs" value={apSec}
               onChange={e => setApSec(e.target.value)}
               placeholder="(hidden if already saved)" autoComplete="off" />
        <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
          <input type="checkbox" checked={autoT} onChange={e => setAutoT(e.target.checked)}
                 className="accent-mint" />
          <span className="text-ink">Enable auto-trade (sells on stop/target/ML, buys on bullish ML)</span>
        </label>
        <label className="flex items-start gap-2 mt-3 text-sm cursor-pointer">
          <input type="checkbox" checked={smartStops} onChange={e => setSmartStops(e.target.checked)}
                 className="accent-mint mt-0.5" />
          <span>
            <span className="text-ink font-semibold">Smart stops</span> — let the bot pick stop-loss & take-profit per stock based on its volatility (ATR), instead of fixed percentages.
            <span className="block text-muted text-[11px] mt-0.5 leading-relaxed">
              When buying, sliders are overridden. High-volatility names get wider stops; calm names get tight ones. ML signal still notifies you.
            </span>
          </span>
        </label>

        <div className="mt-4">
          <label className="label">Auto-buy size per trade ($)</label>
          <input
            type="number"
            min={1}
            step={100}
            value={autoBuySize}
            onChange={e => setAutoBuySize(Math.max(1, Number(e.target.value) || 0))}
            className="input font-mono max-w-xs"
            placeholder="500"
          />
          <div className="text-muted text-[11px] mt-1">
            When auto-trader fires a BUY, it spends up to this amount (any number you want — $50, $500, $50,000). Bot rounds down to whole shares.
          </div>
        </div>

        {/* Inline Auto-Trader tests (so user doesn't have to scroll) */}
        <div className="mt-5 pt-5 border-t border-border1 flex flex-wrap gap-2 items-center">
          {(user.alpaca_key && user.alpaca_secret) && (
            <button onClick={pingAlpaca} className="btn-ghost text-[12px]">🔌 Test Alpaca</button>
          )}
          <button onClick={testNotify} className="btn-ghost text-[12px]">📨 Test Notification</button>
          <span className="text-muted text-[11px]">Verifies Alpaca connection and that alerts reach your inbox.</span>
        </div>
        {pingRes && (
          <div className={`mt-3 text-xs p-3 rounded-lg font-mono ${pingRes.ok ? "bg-mint/10 text-mint" : "bg-red/10 text-red"}`}>
            {pingRes.loading ? "Pinging…"
              : pingRes.ok ? `✓ Connected — paper cash $${Number(pingRes.account?.cash ?? 0).toFixed(2)}, equity $${Number(pingRes.account?.equity ?? 0).toFixed(2)}`
              : `✗ ${pingRes.error}`}
          </div>
        )}
        {notifyRes && <NotifyResultInline res={notifyRes} />}
      </div>

      {/* ── Fully Autonomous Mode ── */}
      <div className="section-h">Fully Autonomous Mode</div>
      <div className="panel mb-6">
        <div className="rounded-lg p-3 bg-amber/10 border border-amber/30 text-[12px] text-amber mb-4">
          <b>Heads up:</b> Autonomous mode lets Vaelor scan the 540+ stock universe and
          buy positions on its own, with no manual approval. The signal is heuristic
          (RSI + MA + momentum + MACD + Bollinger + volume) — <b>not a trained ML model yet</b>.
          Always backtest your settings before relying on this in real markets. Safety rails below
          prevent ruin, not losses.
        </div>

        <label className="flex items-start gap-2 mt-1 text-sm cursor-pointer">
          <input type="checkbox" checked={autoMode} onChange={e => setAutoMode(e.target.checked)}
                 className="accent-mint mt-0.5" />
          <span>
            <span className="text-ink font-semibold">🤖 Enable Autonomous Mode</span>
            <span className="block text-muted text-[11px] mt-0.5">
              Master switch. When off, "Run Auto-Trade Cycle" does nothing.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 mt-3 text-sm cursor-pointer">
          <input type="checkbox" checked={scanUniverse} onChange={e => setScanUniverse(e.target.checked)}
                 className="accent-mint mt-0.5" />
          <span>
            <span className="text-ink font-semibold">Scan the full 540-stock universe</span>
            <span className="block text-muted text-[11px] mt-0.5">
              Each cycle, ranks the most liquid 80 stocks by signal strength and buys top picks.
              Off = autonomous mode still works but only on your watchlist.
            </span>
          </span>
        </label>

        <div className="grid sm:grid-cols-3 gap-4 mt-5">
          <div>
            <label className="label">Max open positions: {maxPositions}</label>
            <input type="range" min={5} max={60} value={maxPositions}
                   onChange={e => setMaxPositions(Number(e.target.value))}
                   className="w-full accent-mint" />
            <div className="text-muted text-[10px]">Caps total stock count. More = more diversification.</div>
          </div>
          <div>
            <label className="label">Max % per position: {(maxPosPct * 100).toFixed(0)}%</label>
            <input type="range" min={3} max={15} value={maxPosPct * 100}
                   onChange={e => setMaxPosPct(Number(e.target.value) / 100)}
                   className="w-full accent-mint" />
            <div className="text-muted text-[10px]">Prevents one stock from going to the moon — and you with it.</div>
          </div>
          <div>
            <label className="label">Cash reserve: {(cashReservePct * 100).toFixed(0)}%</label>
            <input type="range" min={5} max={30} value={cashReservePct * 100}
                   onChange={e => setCashReservePct(Number(e.target.value) / 100)}
                   className="w-full accent-mint" />
            <div className="text-muted text-[10px]">Always keeps this % in cash, never deployed.</div>
          </div>
        </div>

        <div className="text-muted text-[11px] mt-4 leading-relaxed">
          Per cycle (max 3 new buys): signal threshold = top 15% drop-prob conviction,
          earnings within 3 days skipped, SPY bear-regime pauses ALL new buys,
          ATR-based smart stops auto-set on every entry.
        </div>
      </div>

      {/* Save bar */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={saveSettings} className="btn-mint flex-1 min-w-[200px]">💾 Save All Settings</button>
        <button onClick={runAlertCheck} className="btn-ghost">🤖 Run Alert Check</button>
      </div>

      {runRes && !runRes.loading && (
        <div className="panel mb-7 text-xs font-mono space-y-1">
          <div className="text-mint">
            ✓ Checked {runRes.checked ?? 0} tickers · {runRes.msg}
          </div>
          {runRes.breaches?.length > 0 && (
            <div className="text-amber">
              Breaches: {runRes.breaches.map((b: any) => `${b.ticker}/${b.kind}`).join(", ")}
            </div>
          )}
          {runRes.orders?.length > 0 && (
            <div className="text-mint">
              🤖 Orders: {runRes.orders.map((o: any) => {
                if (!o.ok) return `${o.ticker} ✗ ${o.error}`;
                if (o.orderId) return `${o.ticker} ✓ Alpaca order ${o.orderId.slice(0, 12)}`;
                return `${o.ticker} ✓ ${o.mode || "paper"}`;
              }).join(", ")}
            </div>
          )}
        </div>
      )}
      {runRes?.loading && <div className="panel mb-7 text-xs text-muted">Running alert check…</div>}

      {/* Demo Portfolio */}
      <div className="section-h">Demo Portfolio</div>
      <div className="panel mb-6">
        <div className="text-sm text-ink2 mb-4">
          New account looking empty? Seed yourself a starter portfolio:
          <b className="text-mint"> 10 popular stocks, ~$2,500 each.</b>
        </div>
        <button onClick={seedDemo} className="btn-ghost">🌱 Seed Demo Portfolio</button>
        {seedRes && !seedRes.loading && (
          <div className="mt-3 text-xs p-3 rounded-lg bg-card2 font-mono space-y-1">
            <div className="text-mint">
              ✓ Bought {seedRes.bought?.length ?? 0} stocks · spent {fp(seedRes.total_cost)}
            </div>
            {seedRes.bought?.slice(0, 4).map((b: any) => (
              <div key={b.ticker} className="text-ink2">
                {b.qty} × {b.ticker} @ ${b.price.toFixed(2)}
              </div>
            ))}
            {seedRes.skipped?.length > 0 && (
              <div className="text-muted">Skipped: {seedRes.skipped.map((s: any) => `${s.ticker} (${s.reason})`).join(", ")}</div>
            )}
          </div>
        )}
      </div>

      {/* Notification History */}
      <div className="section-h">Notification History</div>
      <div className="panel mb-6">
        {recent.length === 0 ? (
          <div className="text-muted text-sm">No alerts yet.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((n, i) => {
              const cls =
                n.kind?.includes("stop")   ? "border-red bg-red/10"   :
                n.kind?.includes("target") ? "border-mint bg-mint/10" :
                                             "border-amber bg-amber/10";
              return (
                <div key={i} className={`rounded-lg p-3 border-l-4 ${cls} text-sm`}>
                  <div className="font-bold">{n.title}</div>
                  <div className="text-xs text-ink2 mt-1">{n.body}</div>
                  <div className="text-[10px] text-muted mt-1 font-mono">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Account */}
      <div className="section-h">Account</div>
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="panel">
          <div className="text-xs uppercase tracking-wider text-muted font-bold mb-3">Info</div>
          <div className="text-sm space-y-2 font-mono">
            <div>Username: <span className="text-ink font-bold">{user.name}</span></div>
            <div>Cash: <span className="text-mint font-bold">{fp(Number(user.cash))}</span></div>
          </div>
        </div>
        <div className="panel">
          <div className="text-xs uppercase tracking-wider text-muted font-bold mb-3">Change Password</div>
          <input type="password" className="input mb-2" placeholder="New password"
                 value={pw} onChange={e => setPw(e.target.value)} />
          <input type="password" className="input mb-2" placeholder="Confirm"
                 value={pw2} onChange={e => setPw2(e.target.value)} />
          <button onClick={changePw} disabled={!pw || pw !== pw2}
                  className="btn-ghost w-full disabled:opacity-40">Update Password</button>
        </div>
      </div>

      <div className="panel">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <button onClick={resetAccount} className="btn-red">🔄 Reset Paper Account</button>
          <div className="flex flex-wrap gap-2">
            <a href="/welcome" className="btn-ghost">🏠 View landing page</a>
            <button onClick={signOut} className="btn-ghost">🚪 Sign Out</button>
          </div>
        </div>
        <div className="text-muted text-[11px] mt-3">
          Sign Out now sends you to the public landing page (vaelor.dev) instead of the login screen,
          so you can see what new users see. Tap the landing button to preview it without signing out.
        </div>
      </div>
    </>
  );
}

function NotifyResultInline({ res }: { res: any }) {
  if (res.loading) {
    return <div className="mt-3 text-xs text-muted font-mono">Sending test notifications…</div>;
  }
  if (res.error) {
    return <div className="mt-3 text-xs text-red font-mono p-3 rounded-lg bg-red/10">✗ {res.error}</div>;
  }
  return (
    <div className={`mt-3 text-xs font-mono p-3 rounded-lg space-y-1.5 ${res.ok ? "bg-mint/10" : "bg-amber/10"}`}>
      <div className={res.ok ? "text-mint" : "text-amber"}>
        {res.ok ? "✓ All channels delivered." : "⚠ Some channels failed — details below."}
      </div>
      {(res.results ?? []).map((r: any) => (
        <div key={r.channel} className={r.ok ? "text-mint" : "text-red"}>
          {r.ok ? "✓" : "✗"} <b className="uppercase">{r.channel}</b>
          {r.error && <span className="text-muted ml-2">— {r.error}</span>}
        </div>
      ))}
      {res.configured?.email && !res.hasResendKey && (
        <div className="text-amber mt-2 pt-2 border-t border-border1/40">
          ⚠ Email is configured but <span className="font-bold">RESEND_API_KEY</span> is missing from Vercel env vars.
          Add it in Project Settings → Environment Variables → Redeploy.
        </div>
      )}
    </div>
  );
}
