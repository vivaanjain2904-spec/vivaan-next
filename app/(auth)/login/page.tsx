"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pw, setPw]     = useState("");
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const r = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password: pw }),
    });
    setBusy(false);
    if (r.ok) router.push("/overview");
    else { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Login failed"); }
  }

  return (
    <div className="max-w-md mx-auto pt-12 px-6">
      <div className="text-center pb-10">
        <div className="mx-auto w-28 h-28 rounded-full border border-mint/30 flex items-center justify-center mb-6 animate-pulse-glow"
             style={{ background: "radial-gradient(circle, rgba(63,245,160,0.08), transparent 70%)" }}>
          <div className="w-2 h-2 bg-mint rounded-full shadow-glow" />
        </div>
        <div className="text-xl font-extrabold tracking-[.28em] uppercase"
             style={{ background: "linear-gradient(135deg,#3ff5a0,#22c46e)",
                      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                      filter: "drop-shadow(0 0 22px rgba(63,245,160,.5))" }}>
          Vivaan.io
        </div>
        <div className="text-[11px] text-muted tracking-[.18em] uppercase mt-2">
          AI · Portfolio · Agent
        </div>
      </div>

      <div className="panel-glow">
        <div className="section-h">Sign In</div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label">Username</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
                   placeholder="your username" autoFocus required />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" value={pw} onChange={e => setPw(e.target.value)}
                   placeholder="••••••••" required />
          </div>
          {err && <div className="text-red text-xs">{err}</div>}
          <button disabled={busy} className="btn-mint w-full mt-3">
            {busy ? "…" : "Sign In →"}
          </button>
        </form>
        <p className="text-[11px] text-muted text-center mt-4">
          New here? <Link href="/register" className="text-mint hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
