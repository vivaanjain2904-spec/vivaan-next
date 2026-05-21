import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes } from "@/lib/yfinance";

/**
 * Seeds a starter portfolio of 10 popular stocks at current price,
 * each sized to ~$2,500 (rounded down to whole shares).
 * Idempotent-ish — skips a ticker if user already holds it.
 */
const STARTER = ["AAPL","NVDA","TSLA","MSFT","GOOGL","AMZN","META","COIN","AMD","NFLX"];
const TARGET_PER_POSITION = 2500;

export async function POST() {
  const s = await requireSession();
  const quotes = await getQuotes(STARTER);

  // What does the user already hold?
  const existing = await sql`SELECT ticker FROM positions WHERE user_id=${s.uid}`;
  const held = new Set(existing.rows.map(r => r.ticker));

  let bought: any[] = [], skipped: any[] = [], totalCost = 0;

  // Atomic-ish check of cash + sequential buys (kept small)
  const cur = await sql`SELECT cash FROM users WHERE id=${s.uid}`;
  let cash = Number(cur.rows[0]?.cash ?? 0);

  for (const tk of STARTER) {
    if (held.has(tk)) { skipped.push({ ticker: tk, reason: "already held" }); continue; }
    const q = quotes[tk];
    if (!q || !q.price) { skipped.push({ ticker: tk, reason: "no price" }); continue; }
    const qty = Math.max(1, Math.floor(TARGET_PER_POSITION / q.price));
    const cost = qty * q.price;
    if (cost > cash) { skipped.push({ ticker: tk, reason: "out of cash" }); continue; }

    await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
      VALUES (${s.uid}, ${tk}, ${qty}, ${q.price}, 0.05, 0.10)
      ON CONFLICT (user_id, ticker) DO NOTHING`;
    await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
      VALUES (${s.uid}, ${tk}, 'BUY', ${qty}, ${q.price})`;
    cash -= cost; totalCost += cost;
    bought.push({ ticker: tk, qty, price: q.price, cost });
  }

  await sql`UPDATE users SET cash=${cash} WHERE id=${s.uid}`;

  return NextResponse.json({
    ok: true, bought, skipped, total_cost: totalCost, cash_remaining: cash,
  });
}
