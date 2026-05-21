import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/**
 * GET /api/admin/users — full user roster + per-user stats + global totals.
 * Admin-only.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (e: any) {
    return e instanceof Response ? e : NextResponse.json({ error: String(e) }, { status: 500 });
  }

  // Per-user roster with derived position/trade counts
  const users = await sql`
    SELECT
      u.id, u.name, u.cash, u.is_admin, u.auto_trade, u.created_at,
      u.ntfy_topic IS NOT NULL AS has_ntfy,
      u.discord_webhook IS NOT NULL AS has_discord,
      u.alpaca_key IS NOT NULL AS has_alpaca,
      COALESCE((SELECT COUNT(*)::int FROM positions p WHERE p.user_id = u.id), 0) AS positions,
      COALESCE((SELECT COUNT(*)::int FROM trades   t WHERE t.user_id = u.id), 0) AS trades,
      COALESCE((SELECT COUNT(*)::int FROM watchlist w WHERE w.user_id = u.id), 0) AS watchlist,
      COALESCE((SELECT COUNT(*)::int FROM notifications n WHERE n.user_id = u.id), 0) AS notifications,
      COALESCE((SELECT SUM(p.qty * p.avg_cost) FROM positions p WHERE p.user_id = u.id), 0) AS invested
    FROM users u
    ORDER BY u.id`;

  // Global aggregates
  const totals = await sql`SELECT
    (SELECT COUNT(*)::int FROM users) AS user_count,
    (SELECT COUNT(*)::int FROM positions) AS position_count,
    (SELECT COUNT(*)::int FROM trades) AS trade_count,
    (SELECT COUNT(*)::int FROM watchlist) AS watchlist_count,
    (SELECT COUNT(*)::int FROM notifications) AS notif_count,
    (SELECT COALESCE(SUM(cash), 0) FROM users) AS total_cash,
    (SELECT COALESCE(SUM(qty * avg_cost), 0) FROM positions) AS total_invested`;

  // Recent activity (last 10 trades across all users)
  const recent = await sql`SELECT t.ts, t.ticker, t.side, t.qty, t.price, u.name
    FROM trades t JOIN users u ON u.id = t.user_id
    ORDER BY t.id DESC LIMIT 10`;

  return NextResponse.json({
    users: users.rows,
    totals: totals.rows[0] ?? {},
    recent_trades: recent.rows,
  });
}
