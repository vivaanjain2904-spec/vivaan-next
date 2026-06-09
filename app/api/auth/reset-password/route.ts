import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const { token, password } = await req.json();
  if (!token || !password || password.length < 4) {
    return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
  }
  await initDb().catch(() => {});
  const r = await sql`
    SELECT id, name FROM users
    WHERE pw_reset_token = ${token} AND pw_reset_expires > NOW()
    LIMIT 1
  `;
  const u = r.rows[0];
  if (!u) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }
  const hash = await hashPassword(password);
  await sql`
    UPDATE users SET pw_hash = ${hash}, pw_reset_token = NULL, pw_reset_expires = NULL
    WHERE id = ${u.id}
  `;
  return NextResponse.json({ ok: true });
}
