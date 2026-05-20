"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pw,  setPw]    = useState("");
  const [pw2, setPw2]   = useState("");
  const [cash, setCash] = useState(100000);
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setErr("Passwords don't match"); return; }
    setErr(""); setBusy(true);
    const r = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password: pw, starting_cash: cash }),
    });
    setBusy(false);
    if (r.ok) router.push("/overview");
    else { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Sign-up failed"); }
  }

  return (
    <div className="max-w-md mx-auto pt-12 px-6">
      <div className="text-center pb-8">
        <div className="text-xl font-extrabold tracking-[.28em] uppercase"
             style={{ background: "linear-gradient(135deg,#3ff5a0,#22c46e)",
                      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Vivaan.io
        </div>
      </div>
      <div className="panel-glow">
        <div className="section-h">Create Account</div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div><label className="label">Username</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
                   placeholder="alex" required /></div>
          <div><label className="label">Password</label>
            <input type="password" className="input" value={pw}
                   onChange={e => setPw(e.target.value)} placeholder="min 4 chars" required /></div>
          <div><label className="label">Confirm Password</label>
            <input type="password" className="input" value={pw2}
                   onChange={e => setPw2(e.target.value)} placeholder="again" required /></div>
          <div><label className="label">Starting Paper Cash ($)</label>
            <input type="number" className="input" value={cash}
                   onChange={e => setCash(Number(e.target.value))} step={10000} min={1000} /></div>
          {err && <div className="text-red text-xs">{err}</div>}
          <button disabled={busy} className="btn-mint w-full mt-3">
            {busy ? "…" : "Create Account →"}
          </button>
        </form>
        <p className="text-[11px] text-muted text-center mt-4">
          Have an account? <Link href="/login" className="text-mint hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
