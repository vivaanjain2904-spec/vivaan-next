"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

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
    else {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "Login failed");
    }
  }

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <div className="flex justify-between items-center px-10 py-5 border-b border-border1
                      text-[9px] tracking-[0.3em] uppercase text-muted/60">
        <span>Vaelor</span>
        <span>Secure Client Portal · TLS 1.3</span>
      </div>

      <div className="flex items-center justify-center px-6">
        <div className="w-full max-w-[360px] flex flex-col gap-16">
          <Logo size="lg" showTagline />

          <form onSubmit={onSubmit} className="flex flex-col">
            <Field label="Username">
              <input
                className="auth-input"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
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
              {busy ? "Authenticating…" : "Authenticate"}
            </button>

            <div className="flex justify-between text-[9px] tracking-[0.25em] uppercase
                            text-white/30 mt-5">
              <Link href="/register" className="text-white/50 hover:text-vaelor transition-colors">
                Request access
              </Link>
              <Link href="/forgot-password" className="text-white/50 hover:text-vaelor transition-colors">
                Forgot password
              </Link>
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
