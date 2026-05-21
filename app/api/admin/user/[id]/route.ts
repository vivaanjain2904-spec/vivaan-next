import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/** PATCH { is_admin?: bool, reset_cash?: number } — promote/demote OR reset their account. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try { await requireAdmin(); }
  catch (e: any) { return e instanceof Response ? e : NextResponse.json({ error: String(e) }, { status: 500 }); }

  const uid = parseInt(params.id, 10);
  if (!uid) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.is_admin === "boolean") {
    await sql`UPDATE users SET is_admin=${body.is_admin} WHERE id=${uid}`;
  }
  if (typeof body.reset_cash === "number") {
    await sql`DELETE FROM positions    WHERE user_id=${uid}`;
    await sql`DELETE FROM trades       WHERE user_id=${uid}`;
    await sql`DELETE FROM alert_state  WHERE user_id=${uid}`;
    await sql`UPDATE users SET cash=${Number(body.reset_cash) || 100000} WHERE id=${uid}`;
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — permanently wipe a user (and cascade their data). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try { await requireAdmin(); }
  catch (e: any) { return e instanceof Response ? e : NextResponse.json({ error: String(e) }, { status: 500 }); }

  const uid = parseInt(params.id, 10);
  if (!uid) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // Refuse to delete the last remaining admin
  const r = await sql`SELECT COUNT(*)::int AS n FROM users WHERE is_admin = TRUE`;
  const isVictimAdmin = await sql`SELECT is_admin FROM users WHERE id=${uid}`;
  if (isVictimAdmin.rows[0]?.is_admin && (r.rows[0]?.n ?? 0) <= 1) {
    return NextResponse.json({ error: "Can't delete the last admin." }, { status: 400 });
  }

  await sql`DELETE FROM users WHERE id=${uid}`;   // cascades positions/trades/watchlist/notifs
  return NextResponse.json({ ok: true });
}
