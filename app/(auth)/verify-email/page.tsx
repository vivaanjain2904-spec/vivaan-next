"use client";
import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent]   = useState(false);
  const [busy, setBusy]   = useState(false);

  async function resend() {
    if (!email || busy) return;
    setBusy(true);
    await fetch("/api/auth/resend-verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <div className="flex justify-between items-center px-10 py-5 border-b border-border1
                      text-[9px] tracking-[0.3em] uppercase text-muted/60">
        <span>Vaelor</span>
        <span>Account Verification</span>
      </div>

      <div className="flex items-center justify-center px-6">
        <div className="w-full max-w-[360px] flex flex-col gap-10">
          <Logo size="lg" showTagline />

          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-[13px] tracking-[0.2em] uppercase text-vaelor mb-3">
                Check your inbox
              </h2>
              <p className="text-white/50 text-[12px] leading-relaxed">
                We sent a verification link to your email address.
                Click the link to activate your account.
              </p>
            </div>

            <div className="border-t border-border1 pt-6">
              <p className="text-white/30 text-[10px] tracking-[0.2em] uppercase mb-4">
                Didn&apos;t receive it? Resend below.
              </p>
              <div className="flex flex-col mb-4">
                <div className="text-[8.5px] tracking-[0.35em] uppercase text-white/35 mb-2">
                  Email
                </div>
                <input
                  type="email"
                  className="auth-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                />
              </div>
              {sent && (
                <p className="text-vaelor text-[10px] tracking-wider uppercase mb-3">
                  Verification email resent.
                </p>
              )}
              <button
                onClick={resend}
                disabled={busy || !email}
                className="w-full border border-vaelor text-vaelor py-3 text-[10px] font-medium
                           tracking-[0.4em] uppercase transition-colors
                           hover:bg-vaelor hover:text-bg disabled:opacity-50"
                style={{ textIndent: "0.4em" }}
              >
                {busy ? "Sending…" : "Resend Verification Email"}
              </button>
            </div>

            <div className="text-center">
              <Link href="/login" className="text-white/30 hover:text-vaelor text-[9px] tracking-[0.25em] uppercase transition-colors">
                Back to login
              </Link>
            </div>
          </div>
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
