import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { verifyPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const { name, password } = await req.json();
  if (!name || !password) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  await initDb().catch(() => {});  // self-init on first call ever
  const r = await sql`SELECT id, name, pw_hash FROM users WHERE name=${name.trim()}`;
  const u = r.rows[0];
  if (!u || !(await verifyPassword(password, u.pw_hash))) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }
  await setSessionCookie({ uid: u.id, name: u.name });
  return NextResponse.json({ ok: true, name: u.name });
}
