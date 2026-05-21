"use client";
import { useEffect, useState } from "react";
import { fp } from "@/lib/format";
import { Kpi } from "@/components/Kpi";

type UserRow = {
  id: number; name: string; cash: number; is_admin: boolean; auto_trade: boolean;
  created_at: string;
  has_ntfy: boolean; has_discord: boolean; has_alpaca: boolean;
  positions: number; trades: number; watchlist: number; notifications: number;
  invested: number;
};
type Totals = {
  user_count: number; position_count: number; trade_count: number;
  watchlist_count: number; notif_count: number;
  total_cash: number; total_invested: number;
};
type Trade = { ts: string; ticker: string; side: string; qty: number; price: number; name: string };

export default function AdminPage() {
  const [data, setData] = useState<{ users: UserRow[]; totals: Totals; recent_trades: Trade[] } | null>(null);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setErr("");
    const r = await fetch("/api/admin/users");
    if (r.status === 403) { setErr("Admin only — your account doesn't have access."); return; }
    if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
    setData(await r.json());
  }
  useEffect(() => { load(); }, []);

  async function toggleAdmin(u: UserRow) {
    if (!confirm(`${u.is_admin ? "Demote" : "Promote"} ${u.name}?`)) return;
    await fetch(`/api/admin/user/${u.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_admin: !u.is_admin }),
    });
    load();
  }
  async function resetUser(u: UserRow) {
    if (!confirm(`Reset ${u.name}'s paper account to $100,000? This wipes their positions & trades.`)) return;
    await fetch(`/api/admin/user/${u.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset_cash: 100000 }),
    });
    setMsg(`${u.name} reset.`); setTimeout(() => setMsg(""), 3000); load();
  }
  async function deleteUser(u: UserRow) {
    if (!confirm(`PERMANENTLY DELETE ${u.name}? All their data is gone. This cannot be undone.`)) return;
    const r = await fetch(`/api/admin/user/${u.id}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error ?? "Failed"); return; }
    setMsg(`${u.name} deleted.`); setTimeout(() => setMsg(""), 3000); load();
  }

  if (err) return <div className="panel text-red text-sm">{err}</div>;
  if (!data) return <div className="panel text-muted text-sm">Loading admin data…</div>;

  const users = data.users.filter(u =>
    !query || u.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Admin Dashboard</h1>
          <div className="text-[12px] text-muted mt-0.5">
            {data.totals.user_count} users · {data.totals.position_count} positions · {data.totals.trade_count} trades
          </div>
        </div>
        <button onClick={load} className="btn-ghost">🔄 Refresh</button>
      </div>

      {msg && <div className="panel mb-4 text-mint text-sm">{msg}</div>}

      <div className="flex flex-wrap gap-3 mb-6">
        <Kpi label="Users"        value={String(data.totals.user_count)}     sub="registered" />
        <Kpi label="Positions"    value={String(data.totals.position_count)} sub="live holdings" />
        <Kpi label="Trades"       value={String(data.totals.trade_count)}    sub="lifetime" />
        <Kpi label="Watchlist"    value={String(data.totals.watchlist_count)} sub="entries" />
        <Kpi label="Total Cash"   value={fp(Number(data.totals.total_cash))}   color="mint" />
        <Kpi label="Invested"     value={fp(Number(data.totals.total_invested))} color="mint" />
      </div>

      <div className="section-h">
        <span>Users</span>
        <input
          className="input max-w-[200px] py-1.5 text-[12px]"
          placeholder="Filter by name…"
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      <div className="panel p-0 overflow-x-auto mb-7">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
              <th className="text-left  px-4 py-3">User</th>
              <th className="text-right px-3 py-3">Cash</th>
              <th className="text-right px-3 py-3">Invested</th>
              <th className="text-right px-3 py-3">Pos</th>
              <th className="text-right px-3 py-3">Trades</th>
              <th className="text-right px-3 py-3">Watch</th>
              <th className="text-center px-3 py-3">Channels</th>
              <th className="text-center px-3 py-3">Role</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="font-mono">
            {users.map(u => (
              <tr key={u.id} className="border-b border-border1/50 last:border-b-0 hover:bg-card2/50">
                <td className="px-4 py-3 font-sans">
                  <div className="text-ink font-semibold">{u.name}</div>
                  <div className="text-muted text-[11px]">
                    #{u.id} · joined {new Date(u.created_at).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-mint">{fp(Number(u.cash))}</td>
                <td className="px-3 py-3 text-right text-ink2">{fp(Number(u.invested))}</td>
                <td className="px-3 py-3 text-right">{u.positions}</td>
                <td className="px-3 py-3 text-right">{u.trades}</td>
                <td className="px-3 py-3 text-right">{u.watchlist}</td>
                <td className="px-3 py-3 text-center text-[12px]">
                  {u.has_ntfy    && <span title="ntfy"    className="mr-1">📱</span>}
                  {u.has_discord && <span title="Discord" className="mr-1">💬</span>}
                  {u.has_alpaca  && <span title="Alpaca"  className="mr-1">🤖</span>}
                </td>
                <td className="px-3 py-3 text-center">
                  {u.is_admin
                    ? <span className="pill-mint">ADMIN</span>
                    : <span className="pill-muted">user</span>}
                </td>
                <td className="px-4 py-3 text-right text-[11px]">
                  <div className="flex justify-end gap-2 flex-wrap font-sans">
                    <button onClick={() => toggleAdmin(u)} className="text-amber hover:underline">
                      {u.is_admin ? "Demote" : "Promote"}
                    </button>
                    <button onClick={() => resetUser(u)} className="text-muted hover:text-ink">
                      Reset
                    </button>
                    <button onClick={() => deleteUser(u)} className="text-red hover:underline">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-h">Recent Activity</div>
      <div className="panel p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted font-semibold border-b border-border1">
              <th className="text-left  px-4 py-3">When</th>
              <th className="text-left  px-3 py-3">User</th>
              <th className="text-left  px-3 py-3">Side</th>
              <th className="text-left  px-3 py-3">Ticker</th>
              <th className="text-right px-3 py-3">Qty</th>
              <th className="text-right px-4 py-3">Price</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {data.recent_trades.map((t, i) => (
              <tr key={i} className="border-b border-border1/50 last:border-b-0">
                <td className="px-4 py-2.5 text-muted text-[11px]">
                  {new Date(t.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-3 py-2.5 text-ink font-sans">{t.name}</td>
                <td className={`px-3 py-2.5 font-bold ${t.side === "BUY" ? "text-mint" : "text-red"}`}>
                  {t.side}
                </td>
                <td className="px-3 py-2.5"><span className="tk-tag">{t.ticker}</span></td>
                <td className="px-3 py-2.5 text-right">{t.qty}</td>
                <td className="px-4 py-2.5 text-right">{fp(Number(t.price))}</td>
              </tr>
            ))}
            {data.recent_trades.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted py-6">No trades yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
