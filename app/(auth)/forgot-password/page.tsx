"use client";
import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone]   = useState(false);
  const [busy, setBusy]   = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    setDone(true);
  }

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <div className="flex justify-between items-center px-10 py-5 border-b border-border1
                      text-[9px] tracking-[0.3em] uppercase text-muted/60">
        <span>Vaelor</span>
        <span>Password Recovery</span>
      </div>

      <div className="flex items-center justify-center px-6">
        <div className="w-full max-w-[360px] flex flex-col gap-16">
          <Logo size="lg" showTagline />

          {done ? (
            <div className="flex flex-col gap-6">
              <p className="text-white/60 text-[12px] leading-relaxed">
                If that email is registered, a reset link has been sent. Check your inbox.
              </p>
              <Link href="/login" className="text-vaelor text-[9px] tracking-[0.25em] uppercase hover:underline">
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col">
              <div className="flex flex-col mb-6">
                <div className="text-[8.5px] tracking-[0.35em] uppercase text-white/35 mb-2">
                  Email
                </div>
                <input
                  type="email"
                  className="auth-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <button
                disabled={busy}
                className="mt-2 border border-vaelor text-vaelor py-3 text-[10px] font-medium
                           tracking-[0.4em] uppercase transition-colors
                           hover:bg-vaelor hover:text-bg disabled:opacity-50"
                style={{ textIndent: "0.4em" }}
              >
                {busy ? "Sending…" : "Send Reset Link"}
              </button>

              <div className="mt-5 text-center">
                <Link href="/login" className="text-white/30 hover:text-vaelor text-[9px] tracking-[0.25em] uppercase transition-colors">
                  Back to login
                </Link>
              </div>
            </form>
          )}
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
