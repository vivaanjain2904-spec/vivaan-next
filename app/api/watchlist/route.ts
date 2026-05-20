import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export async function GET() {
  const s = await requireSession();
  const r = await sql`SELECT ticker, alert_above, alert_below, ml_alert
    FROM watchlist WHERE user_id=${s.uid} ORDER BY ticker`;
  return NextResponse.json({ items: r.rows });
}

/** POST { ticker, alert_above?, alert_below?, ml_alert? } */
export async function POST(req: Request) {
  const s = await requireSession();
  const { ticker, alert_above, alert_below, ml_alert } = await req.json();
  const tk = String(ticker || "").trim().toUpperCase();
  if (!tk) return NextResponse.json({ error: "Pick a ticker" }, { status: 400 });
  await sql`INSERT INTO watchlist (user_id, ticker, alert_above, alert_below, ml_alert)
    VALUES (${s.uid}, ${tk},
      ${alert_above ? Number(alert_above) : null},
      ${alert_below ? Number(alert_below) : null},
      ${!!ml_alert})
    ON CONFLICT (user_id, ticker) DO UPDATE SET
      alert_above = EXCLUDED.alert_above,
      alert_below = EXCLUDED.alert_below,
      ml_alert    = EXCLUDED.ml_alert`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await requireSession();
  const tk = new URL(req.url).searchParams.get("ticker");
  if (!tk) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  await sql`DELETE FROM watchlist WHERE user_id=${s.uid} AND ticker=${tk.toUpperCase()}`;
  await sql`DELETE FROM alert_state WHERE user_id=${s.uid} AND ticker=${tk.toUpperCase()}`;
  return NextResponse.json({ ok: true });
}
