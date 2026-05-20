import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { hashPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const { name, password, starting_cash } = await req.json();
  if (!name || !password || password.length < 4) {
    return NextResponse.json({ error: "Username + password (≥4 chars) required" }, { status: 400 });
  }
  await initDb().catch(() => {}); // idempotent
  try {
    const hash = await hashPassword(password);
    const r = await sql`INSERT INTO users (name, pw_hash, cash)
      VALUES (${name.trim()}, ${hash}, ${Number(starting_cash) || 100000})
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
