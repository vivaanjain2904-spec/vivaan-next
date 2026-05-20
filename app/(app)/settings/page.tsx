"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fp } from "@/lib/format";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser]   = useState<any>(null);
  const [ntfy, setNtfy]   = useState("");
  const [disc, setDisc]   = useState("");
  const [mlOn, setMlOn]   = useState(true);
  const [mlThr, setMlThr] = useState(0.65);
  const [pw, setPw]       = useState("");
  const [pw2, setPw2]     = useState("");
  const [msg, setMsg]     = useState("");
  const [recent, setRecent] = useState<any[]>([]);

  async function load() {
    const j = await fetch("/api/auth/me").then(r => r.json());
    if (!j.user) return;
    setUser(j.user);
    setNtfy(j.user.ntfy_topic ?? "");
    setDisc(j.user.discord_webhook ?? "");
    setMlOn(!!j.user.ml_alerts);
    setMlThr(Number(j.user.ml_threshold ?? 0.65));
    const nj = await fetch("/api/notifications").then(r => r.json());
    setRecent(nj.recent ?? []);
  }
  useEffect(() => { load(); }, []);

  async function saveSettings() {
    const r = await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ntfy_topic: ntfy, discord_webhook: disc,
                             ml_alerts: mlOn, ml_threshold: mlThr }),
    });
    setMsg(r.ok ? "Saved!" : "Save failed"); setTimeout(() => setMsg(""), 3000);
    load();
  }
  async function testNotify() {
    const r = await fetch("/api/test-notify", { method: "POST" });
    setMsg(r.ok ? "Sent! Check your phone." : "Failed"); setTimeout(() => setMsg(""), 3000);
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
    if (!confirm("Wipe all positions/trades and reset cash to $100,000?")) return;
    await fetch("/api/settings?cash=100000", { method: "DELETE" });
    setMsg("Account reset"); load();
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!user) return <div className="panel text-muted text-sm">Loading…</div>;

  return (
    <>
      {msg && <div className="panel mb-4 text-mint text-sm">{msg}</div>}

      <div className="section-h">Push Notifications</div>
      <div className="panel mb-6">
        <div className="text-sm text-ink2 mb-4 leading-relaxed">
          <b className="text-mint">Get alerts on your phone in 3 steps:</b><br />
          1. Install the <b>ntfy</b> app from <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="text-mint underline">ntfy.sh</a> (iOS / Android)<br />
          2. Pick a unique topic name below (e.g. <code className="text-mint">vivaan-stocks-{Math.random().toString(36).slice(2, 8)}</code>)<br />
          3. In the ntfy app, subscribe to that topic → hit Test below
        </div>
        <label className="label">ntfy.sh topic</label>
        <input className="input font-mono" value={ntfy} onChange={e => setNtfy(e.target.value)}
               placeholder="vivaan-stocks-abc123" />

        <label className="label mt-3">Discord webhook (optional)</label>
        <input className="input font-mono text-xs" value={disc} onChange={e => setDisc(e.target.value)}
               placeholder="https://discord.com/api/webhooks/…" />

        <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
          <input type="checkbox" checked={mlOn} onChange={e => setMlOn(e.target.checked)}
                 className="accent-mint" />
          <span>Enable ML sell-signal alerts</span>
        </label>
        <label className="label mt-3">ML threshold: {(mlThr * 100).toFixed(0)}%</label>
        <input type="range" min={0.5} max={0.95} step={0.05} value={mlThr}
               onChange={e => setMlThr(Number(e.target.value))} className="w-full accent-mint" />

        <div className="flex gap-2 mt-5">
          <button onClick={saveSettings} className="btn-mint flex-1">💾 Save Settings</button>
          {user.ntfy_topic && (
            <button onClick={testNotify} className="btn-ghost">📱 Send Test</button>
          )}
        </div>
      </div>

      <div className="section-h">Notification History</div>
      <div className="panel mb-6">
        {recent.length === 0 ? (
          <div className="text-muted text-sm">No alerts yet.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((n, i) => {
              const cls =
                n.kind?.includes("stop") ? "border-red bg-red/10"
                : n.kind?.includes("target") ? "border-mint bg-mint/10"
                : "border-amber bg-amber/10";
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
          <button onClick={signOut} className="btn-ghost">🚪 Sign Out</button>
        </div>
      </div>
    </>
  );
}
