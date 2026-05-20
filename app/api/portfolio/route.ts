import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes } from "@/lib/yfinance";

export async function GET() {
  const s = await requireSession();
  const [posR, userR, wlR, mlR] = await Promise.all([
    sql`SELECT ticker, qty, avg_cost, stop_loss, take_profit
        FROM positions WHERE user_id=${s.uid} AND qty>0 ORDER BY ticker`,
    sql`SELECT cash, ml_alerts, ml_threshold FROM users WHERE id=${s.uid}`,
    sql`SELECT ticker, alert_above, alert_below, ml_alert
        FROM watchlist WHERE user_id=${s.uid} ORDER BY ticker`,
    sql`SELECT ticker, drop_probability FROM ml_signals`,
  ]);
  const positions = posR.rows;
  const watchlist = wlR.rows;
  const cash = Number(userR.rows[0]?.cash ?? 0);
  const mlMap: Record<string, number> = {};
  for (const r of mlR.rows) mlMap[r.ticker] = Number(r.drop_probability);

  const tickers = Array.from(new Set([
    ...positions.map(p => p.ticker),
    ...watchlist.map(w => w.ticker),
  ]));
  const quotes = await getQuotes(tickers);

  return NextResponse.json({
    user: { name: s.name, cash, ml_alerts: userR.rows[0]?.ml_alerts ?? true,
            ml_threshold: Number(userR.rows[0]?.ml_threshold ?? 0.65) },
    positions, watchlist, quotes, ml: mlMap,
  });
}
