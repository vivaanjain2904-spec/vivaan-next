import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { sendRawEmail } from "@/lib/ntfy";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://vaelor.dev";

export async function POST(req: Request) {
  const { name, email, password, starting_cash } = await req.json();
  if (!name || !password || password.length < 4) {
    return NextResponse.json({ error: "Username + password (≥4 chars) required" }, { status: 400 });
  }
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  await initDb().catch(() => {}); // idempotent
  try {
    // Reject duplicate emails so the user count is honest (one account per email).
    const dupe = await sql`SELECT 1 FROM users WHERE lower(email) = ${cleanEmail} LIMIT 1`;
    if (dupe.rows.length) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    const hash = await hashPassword(password);
    const verifyToken = crypto.randomUUID();
    const r = await sql`INSERT INTO users (name, email, pw_hash, cash, email_verify_token, email_verified)
      VALUES (${name.trim()}, ${cleanEmail}, ${hash}, ${Number(starting_cash) || 100000}, ${verifyToken}, FALSE)
      RETURNING id, name`;
    const u = r.rows[0];

    // Send verification email — fire-and-forget
    const verifyLink = `${APP_URL}/api/auth/verify-email?token=${verifyToken}`;
    await sendRawEmail(
      cleanEmail,
      "Verify your Vaelor account",
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#0a0a0b;color:#fafafa;border-radius:12px">
        <div style="font-family:'Cinzel',Georgia,serif;font-weight:900;letter-spacing:0.26em;color:#34d399;font-size:22px;margin-bottom:24px">VAELOR</div>
        <h2 style="color:#fafafa;font-size:18px;margin:0 0 12px">Verify your email</h2>
        <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 24px">Hi ${u.name}, click the button below to verify your email and activate your account.</p>
        <a href="${verifyLink}" style="display:inline-block;padding:12px 28px;background:#34d399;color:#0a0a0b;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.1em;border-radius:4px">Verify Email</a>
        <p style="color:#71717a;font-size:12px;margin:24px 0 0">Or copy this link: <a href="${verifyLink}" style="color:#34d399;word-break:break-all">${verifyLink}</a></p>
        <hr style="border:none;border-top:1px solid #262629;margin:24px 0" />
        <p style="color:#71717a;font-size:11px;margin:0">Sent by Vaelor · <a href="https://vaelor.dev" style="color:#34d399;text-decoration:none">vaelor.dev</a></p>
      </div>`,
    );

    return NextResponse.json({ ok: true, needsVerification: true });
  } catch (e: any) {
    if (String(e?.message).includes("duplicate") || String(e?.code) === "23505")
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
