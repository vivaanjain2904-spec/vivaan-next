import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const r = await sql`INSERT INTO users (name, email, pw_hash, cash)
      VALUES (${name.trim()}, ${cleanEmail}, ${hash}, ${Number(starting_cash) || 100000})
      RETURNING id, name`;
    const u = r.rows[0];
    await setSessionCookie({ uid: u.id, name: u.name });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.message).includes("duplicate") || String(e?.code) === "23505")
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
