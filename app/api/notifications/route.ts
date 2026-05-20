import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";

/** GET undelivered (for in-app toast) — auto-marks delivered. */
export async function GET() {
  const s = await requireSession();
  const r = await sql`SELECT id, ticker, kind, title, body, created_at
    FROM notifications WHERE user_id=${s.uid} AND delivered=FALSE ORDER BY id LIMIT 20`;
  if (r.rows.length) {
    const ids = r.rows.map(x => x.id);
    await sql`UPDATE notifications SET delivered=TRUE WHERE id = ANY(${ids as any})`;
  }
  // also return recent history
  const h = await sql`SELECT ticker, kind, title, body, created_at
    FROM notifications WHERE user_id=${s.uid} ORDER BY id DESC LIMIT 30`;
  return NextResponse.json({ undelivered: r.rows, recent: h.rows });
}
