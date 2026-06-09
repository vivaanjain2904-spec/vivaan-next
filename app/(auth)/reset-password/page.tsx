"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [pw, setPw]   = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setErr("Passwords don't match"); return; }
    if (pw.length < 4) { setErr("Password must be at least 4 characters"); return; }
    setErr(""); setBusy(true);
    const r = await fetch("/api/auth/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: pw }),
    });
    setBusy(false);
    if (r.ok) {
      router.push("/login");
    } else {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "Reset failed");
    }
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-red text-[11px] tracking-wider uppercase">Invalid reset link.</p>
        <Link href="/forgot-password" className="text-vaelor text-[9px] tracking-[0.25em] uppercase hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col">
      <div className="flex flex-col mb-6">
        <div className="text-[8.5px] tracking-[0.35em] uppercase text-white/35 mb-2">
          New Passphrase
        </div>
        <input
          type="password"
          className="auth-input"
          value={pw}
          onChange={e => setPw(e.target.value)}
          autoFocus
          required
        />
      </div>
      <div className="flex flex-col mb-6">
        <div className="text-[8.5px] tracking-[0.35em] uppercase text-white/35 mb-2">
          Confirm Passphrase
        </div>
        <input
          type="password"
          className="auth-input"
          value={pw2}
          onChange={e => setPw2(e.target.value)}
          required
        />
      </div>

      {err && (
        <div className="text-red text-[11px] tracking-wider uppercase mt-1 mb-3">
          {err}
        </div>
      )}

      <button
        disabled={busy}
        className="mt-2 border border-vaelor text-vaelor py-3 text-[10px] font-medium
                   tracking-[0.4em] uppercase transition-colors
                   hover:bg-vaelor hover:text-bg disabled:opacity-50"
        style={{ textIndent: "0.4em" }}
      >
        {busy ? "Updating…" : "Reset Password"}
      </button>

      <div className="mt-5 text-center">
        <Link href="/login" className="text-white/30 hover:text-vaelor text-[9px] tracking-[0.25em] uppercase transition-colors">
          Back to login
        </Link>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <div className="flex justify-between items-center px-10 py-5 border-b border-border1
                      text-[9px] tracking-[0.3em] uppercase text-muted/60">
        <span>Vaelor</span>
        <span>Password Reset</span>
      </div>

      <div className="flex items-center justify-center px-6">
        <div className="w-full max-w-[360px] flex flex-col gap-16">
          <Logo size="lg" showTagline />
          <Suspense fallback={<div className="text-white/30 text-[11px]">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
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
