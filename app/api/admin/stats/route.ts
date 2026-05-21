import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";

/**
 * Stats dashboard — only the default "Vivaan" admin account can see it.
 * Returns user count, recent signups, trades volume, top-watched tickers.
 */
export async function GET() {
  const s = await requireSession();
  if (s.name !== "Vivaan") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const [userCount, recentUsers, tradeCount, totalCash, totalWatchlist, topWatched] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM users`,
    sql`SELECT id, name, cash, created_at FROM users ORDER BY id DESC LIMIT 20`,
    sql`SELECT COUNT(*)::int AS n FROM trades`,
    sql`SELECT COALESCE(SUM(cash),0)::float AS total FROM users`,
    sql`SELECT COUNT(*)::int AS n FROM watchlist`,
    sql`SELECT ticker, COUNT(*)::int AS n FROM watchlist
        GROUP BY ticker ORDER BY n DESC LIMIT 10`,
  ]);

  return NextResponse.json({
    user_count:     (userCount.rows[0] as any).n,
    trade_count:    (tradeCount.rows[0] as any).n,
    total_cash:     (totalCash.rows[0] as any).total,
    watchlist_size: (totalWatchlist.rows[0] as any).n,
    recent_users:   recentUsers.rows,
    top_watched:    topWatched.rows,
  });
}
