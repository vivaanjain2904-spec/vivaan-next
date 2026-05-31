import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";

export const maxDuration = 20;
export const revalidate = 0;

/**
 * GET /api/public/performance — PUBLIC, no auth.
 * Returns ONLY the aggregate strategy track record vs SPY (both indexed to 100).
 * Never exposes any individual account / user data.
 */
export async function GET() {
  try {
    await initDb().catch(() => {});
    const r = await sql`SELECT as_of, strategy_nav, spy_nav, regime FROM strategy_nav ORDER BY as_of ASC`;
    const rows = r.rows.map((x: any) => ({
      date: x.as_of, strategy: Number(x.strategy_nav), spy: Number(x.spy_nav), regime: x.regime,
    }));
    if (!rows.length) {
      return NextResponse.json({ ok: true, started: null, points: [], summary: null });
    }
    const last = rows[rows.length - 1];
    const stratRet = last.strategy - 100;
    const spyRet = last.spy - 100;
    // max drawdown of strategy series
    let peak = -Infinity, maxDd = 0;
    for (const p of rows) { peak = Math.max(peak, p.strategy); maxDd = Math.min(maxDd, p.strategy / peak - 1); }
    return NextResponse.json({
      ok: true,
      started: rows[0].date,
      days: rows.length,
      points: rows,
      summary: {
        strategyReturnPct: +stratRet.toFixed(2),
        spyReturnPct: +spyRet.toFixed(2),
        alphaPct: +(stratRet - spyRet).toFixed(2),
        maxDrawdownPct: +(maxDd * 100).toFixed(2),
        regime: last.regime,
        asOf: last.date,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
