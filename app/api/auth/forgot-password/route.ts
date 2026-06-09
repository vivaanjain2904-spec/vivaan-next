import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { sendRawEmail } from "@/lib/ntfy";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://vaelor.dev";

export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ ok: true }); // don't leak

  const cleanEmail = String(email).trim().toLowerCase();
  await initDb().catch(() => {});

  const r = await sql`SELECT id, name FROM users WHERE lower(email) = ${cleanEmail} LIMIT 1`;
  const u = r.rows[0];
  if (!u) return NextResponse.json({ ok: true }); // don't leak existence

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  await sql`
    UPDATE users SET pw_reset_token = ${token}, pw_reset_expires = ${expires.toISOString()}
    WHERE id = ${u.id}
  `;

  const resetLink = `${APP_URL}/reset-password?token=${token}`;
  await sendRawEmail(
    cleanEmail,
    "Reset your Vaelor password",
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#0a0a0b;color:#fafafa;border-radius:12px">
      <div style="font-family:'Cinzel',Georgia,serif;font-weight:900;letter-spacing:0.26em;color:#34d399;font-size:22px;margin-bottom:24px">VAELOR</div>
      <h2 style="color:#fafafa;font-size:18px;margin:0 0 12px">Password reset</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 24px">Hi ${u.name}, click the button below to reset your password. This link expires in 15 minutes.</p>
      <a href="${resetLink}" style="display:inline-block;padding:12px 28px;background:#34d399;color:#0a0a0b;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.1em;border-radius:4px">Reset Password</a>
      <p style="color:#71717a;font-size:12px;margin:24px 0 0">Or copy this link: <a href="${resetLink}" style="color:#34d399;word-break:break-all">${resetLink}</a></p>
      <p style="color:#71717a;font-size:12px;margin:8px 0 0">If you didn't request this, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #262629;margin:24px 0" />
      <p style="color:#71717a;font-size:11px;margin:0">Sent by Vaelor · <a href="https://vaelor.dev" style="color:#34d399;text-decoration:none">vaelor.dev</a></p>
    </div>`,
  );

  return NextResponse.json({ ok: true });
}
