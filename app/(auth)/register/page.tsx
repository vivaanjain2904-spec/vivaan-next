"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw,  setPw]    = useState("");
  const [pw2, setPw2]   = useState("");
  const [cash, setCash] = useState(100000);
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr("Enter a valid email"); return; }
    if (pw !== pw2) { setErr("Passwords don't match"); return; }
    setErr(""); setBusy(true);
    const r = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: pw, starting_cash: cash }),
    });
    setBusy(false);
    if (r.ok) router.push("/verify-email");
    else { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Sign-up failed"); }
  }

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <div className="flex justify-between items-center px-10 py-5 border-b border-border1
                      text-[9px] tracking-[0.3em] uppercase text-muted/60">
        <span>Vaelor</span>
        <span>Account Onboarding</span>
      </div>

      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[360px] flex flex-col gap-12">
          <Logo size="lg" showTagline />

          <form onSubmit={onSubmit} className="flex flex-col">
            <Field label="Username">
              <input
                className="auth-input"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                autoComplete="email"
                className="auth-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Passphrase">
              <input
                type="password"
                className="auth-input"
                value={pw}
                onChange={e => setPw(e.target.value)}
                required
              />
            </Field>
            <Field label="Confirm Passphrase">
              <input
                type="password"
                className="auth-input"
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                required
              />
            </Field>
            <Field label="Starting Paper Capital (USD)">
              <input
                type="number"
                className="auth-input font-mono"
                value={cash}
                onChange={e => setCash(Math.max(0, Number(e.target.value) || 0))}
                step={1000}
                min={0}
              />
              <div className="text-white/30 text-[9px] tracking-[0.2em] uppercase mt-2">
                Any amount · paper money only
              </div>
            </Field>

            {err && (
              <div className="text-red text-[11px] tracking-wider uppercase mt-1 mb-3">
                {err}
              </div>
            )}

            <button
              disabled={busy}
              className="mt-5 border border-vaelor text-vaelor py-3 text-[10px] font-medium
                         tracking-[0.4em] uppercase transition-colors
                         hover:bg-vaelor hover:text-bg disabled:opacity-50"
              style={{ textIndent: "0.4em" }}
            >
              {busy ? "Provisioning…" : "Create Account"}
            </button>

            <div className="flex justify-between text-[9px] tracking-[0.25em] uppercase
                            text-white/30 mt-5">
              <Link href="/login" className="text-white/50 hover:text-vaelor transition-colors">
                Already have access
              </Link>
              <span>Authorized use only</span>
            </div>
          </form>
        </div>
      </div>

      <div className="flex justify-between items-center px-10 py-5 border-t border-border1
                      text-[9px] tracking-[0.3em] uppercase text-muted/60">
        <span>© MMXXVI Vaelor Capital</span>
        <span>v1.0</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col mb-6">
      <div className="text-[8.5px] tracking-[0.35em] uppercase text-white/35 mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}
