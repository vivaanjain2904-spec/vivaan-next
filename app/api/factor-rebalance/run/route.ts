import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes } from "@/lib/yfinance";
import { alpacaBuy, alpacaSell } from "@/lib/alpaca";
import { alertUser } from "@/lib/ntfy";

export const maxDuration = 60;
const MIN_TRADE = 50;   // ignore rebalance trades smaller than $50

/**
 * POST /api/factor-rebalance/run
 * Rebalances the portfolio toward the latest factor_targets row.
 *   - Sells holdings not in the target
 *   - Sizes every target name to (weight × total equity)
 * Weights already include the regime exposure, so the uninvested fraction
 * naturally stays in cash (de-risking in downtrends).
 *
 * Auth: Bearer CRON_SECRET → run for all autonomous users (the "no human hands"
 * path). Otherwise a logged-in session → run for that user (manual button).
 */
async function latestTarget() {
  const r = await sql`SELECT as_of, regime, exposure, targets FROM factor_targets ORDER BY id DESC LIMIT 1`;
  return r.rows[0] || null;
}

async function rebalanceUser(user: any, target: any) {
  const targets: Record<string, number> =
    typeof target.targets === "string" ? JSON.parse(target.targets) : target.targets;
  const tgtTickers = Object.keys(targets);

  const posR = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty>0`;
  const positions = posR.rows;
  const allTickers = Array.from(new Set([...tgtTickers, ...positions.map((p: any) => p.ticker)]));
  const quotes = await getQuotes(allTickers);

  let cash = Number(user.cash);
  let posVal = 0;
  for (const p of positions) {
    const px = quotes[p.ticker]?.price;
    if (px) posVal += Number(p.qty) * px;
  }
  const equity = cash + posVal;
  if (equity <= 0) return { user: user.name, error: "no equity" };

  const held: Record<string, { qty: number; avg: number }> = {};
  for (const p of positions) held[p.ticker] = { qty: Number(p.qty), avg: Number(p.avg_cost) };

  const trades: any[] = [];

  // 1) SELL anything not in the target
  for (const p of positions) {
    if (tgtTickers.includes(p.ticker)) continue;
    const px = quotes[p.ticker]?.price;
    if (!px) continue;
    const qty = Number(p.qty);
    if (user.alpaca_key && user.alpaca_secret) {
      try { await alpacaSell({ key: user.alpaca_key, secret: user.alpaca_secret }, p.ticker, qty); } catch {}
    }
    await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${p.ticker}`;
    await sql`UPDATE users SET cash=cash+${qty * px} WHERE id=${user.id}`;
    await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${p.ticker},'SELL',${qty},${px})`;
    cash += qty * px;
    delete held[p.ticker];
    trades.push({ ticker: p.ticker, side: "SELL", qty, price: px, reason: "not-in-target" });
  }

  // 2) Rebalance each target name to weight × equity
  for (const tk of tgtTickers) {
    const px = quotes[tk]?.price;
    if (!px || px <= 0) continue;
    const targetDollars = Number(targets[tk]) * equity;
    const cur = held[tk] || { qty: 0, avg: 0 };
    const deltaDollars = targetDollars - cur.qty * px;
    if (Math.abs(deltaDollars) < MIN_TRADE) continue;
    const deltaShares = Math.floor(Math.abs(deltaDollars) / px);
    if (deltaShares < 1) continue;

    if (deltaDollars > 0) {                       // BUY
      const cost = deltaShares * px;
      if (cost > cash) continue;
      if (user.alpaca_key && user.alpaca_secret) {
        try { await alpacaBuy({ key: user.alpaca_key, secret: user.alpaca_secret }, tk, deltaShares); } catch {}
      }
      const newQty = cur.qty + deltaShares;
      const newAvg = cur.qty > 0 ? (cur.qty * cur.avg + cost) / newQty : px;
      await sql`INSERT INTO positions (user_id,ticker,qty,avg_cost) VALUES (${user.id},${tk},${deltaShares},${px})
        ON CONFLICT (user_id,ticker) DO UPDATE SET qty=${newQty}, avg_cost=${newAvg}`;
      await sql`UPDATE users SET cash=cash-${cost} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${tk},'BUY',${deltaShares},${px})`;
      cash -= cost;
      held[tk] = { qty: newQty, avg: newAvg };
      trades.push({ ticker: tk, side: "BUY", qty: deltaShares, price: px, reason: "rebalance" });
    } else {                                      // SELL down to target
      const sellQty = Math.min(deltaShares, cur.qty);
      if (sellQty < 1) continue;
      const proceeds = sellQty * px;
      if (user.alpaca_key && user.alpaca_secret) {
        try { await alpacaSell({ key: user.alpaca_key, secret: user.alpaca_secret }, tk, sellQty); } catch {}
      }
      const newQty = cur.qty - sellQty;
      if (newQty <= 0) await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${tk}`;
      else await sql`UPDATE positions SET qty=${newQty} WHERE user_id=${user.id} AND ticker=${tk}`;
      await sql`UPDATE users SET cash=cash+${proceeds} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${tk},'SELL',${sellQty},${px})`;
      cash += proceeds;
      held[tk] = { qty: newQty, avg: cur.avg };
      trades.push({ ticker: tk, side: "SELL", qty: sellQty, price: px, reason: "trim-to-target" });
    }
  }

  const buys = trades.filter(t => t.side === "BUY").length;
  const sells = trades.filter(t => t.side === "SELL").length;
  if (trades.length) {
    const title = `🎯 Factor rebalance: ${buys} buys, ${sells} sells`;
    const body = `Rebalanced toward ${tgtTickers.length}-name target (${target.regime}, ` +
      `${(Number(target.exposure) * 100).toFixed(0)}% invested) as of ${target.as_of}.`;
    try {
      await sql`INSERT INTO notifications (user_id,ticker,kind,title,body) VALUES (${user.id},NULL,'factor_rebalance',${title},${body})`;
      await alertUser(user as any, title, body);
    } catch {}
  }
  return { user: user.name, buys, sells, trades, target_as_of: target.as_of, regime: target.regime, exposure: target.exposure };
}

export async function POST(req: Request) {
  try {
    await initDb().catch(() => {});
    const target = await latestTarget();
    if (!target) {
      return NextResponse.json({ ok: false, error: "No factor target uploaded yet. Run the research push first." }, { status: 400 });
    }

    const auth = req.headers.get("authorization") || "";
    const cronSecret = process.env.CRON_SECRET;
    const adminSecret = process.env.ADMIN_UPLOAD_SECRET;

    // Automated path: cron OR admin-upload secret → all autonomous users.
    // (Accepting ADMIN_UPLOAD_SECRET lets the local research job push the target
    //  AND trigger the rebalance with a single secret — fully hands-free.)
    if ((cronSecret && auth === `Bearer ${cronSecret}`) ||
        (adminSecret && auth === `Bearer ${adminSecret}`)) {
      const users = await sql`SELECT * FROM users WHERE autonomous_mode = TRUE`;
      const results = [];
      for (const u of users.rows) results.push(await rebalanceUser(u, target));
      return NextResponse.json({ ok: true, mode: "automated", users: results.length, results });
    }

    // Manual path: logged-in user
    const s = await requireSession();
    const ur = await sql`SELECT * FROM users WHERE id=${s.uid}`;
    const user = ur.rows[0];
    if (!user) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
    const r = await rebalanceUser(user, target);
    return NextResponse.json({
      ok: true, mode: "manual", ...r,
      msg: `Rebalanced toward factor target (${target.regime}, ${(Number(target.exposure) * 100).toFixed(0)}% invested): ${r.buys} buys, ${r.sells} sells.`,
    });
  } catch (e: any) {
    if (e instanceof Response) {
      return NextResponse.json({ ok: false, error: "Not signed in — log out and back in, then retry." }, { status: 401 });
    }
    console.error("[factor-rebalance] error", e);
    return NextResponse.json({ ok: false, error: `Rebalance failed: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
