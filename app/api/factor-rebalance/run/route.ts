import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes } from "@/lib/yfinance";
import { alpacaBuy, alpacaSell } from "@/lib/alpaca";
import { alertUser } from "@/lib/ntfy";

export const maxDuration = 60;
const MIN_TRADE = 50;        // ignore rebalance trades smaller than $50 (absolute)
const REBALANCE_BAND = 0.015; // and ignore drift smaller than 1.5% of portfolio (no-trade band)

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
  let equity = cash + posVal;
  if (equity <= 0) return { user: user.name, error: "no equity" };

  const held: Record<string, { qty: number; avg: number }> = {};
  for (const p of positions) held[p.ticker] = { qty: Number(p.qty), avg: Number(p.avg_cost) };

  const trades: any[] = [];

  const live = !!(user.alpaca_key && user.alpaca_secret);
  const creds = { key: user.alpaca_key, secret: user.alpaca_secret, mode: (user.alpaca_mode === "live" ? "live" : "paper") as "live" | "paper" };

  // ── Portfolio circuit breaker — high-water mark; if equity falls more than
  // circuit_breaker_pct below it, liquidate everything to cash and pause
  // rebalancing for a cooldown. Mirrors the TA auto-trade breaker.
  const breakerPct = Math.max(0, Number(user.circuit_breaker_pct) || 0);
  const prevPeak = Number(user.peak_equity) || 0;
  const peak = Math.max(prevPeak, equity);
  if (peak > prevPeak) await sql`UPDATE users SET peak_equity=${peak} WHERE id=${user.id}`;
  const breakerUntil = user.circuit_breaker_until ? new Date(user.circuit_breaker_until) : null;
  const inCooldown = breakerUntil != null && breakerUntil.getTime() > Date.now();
  const drawdown = peak > 0 ? (equity - peak) / peak : 0;

  if (breakerPct > 0 && drawdown <= -breakerPct && !inCooldown) {
    for (const p of positions) {
      try {
        const px = quotes[p.ticker]?.price;
        if (!px) continue;
        let qty = Number(p.qty);
        let fillPx = px;
        if (live) {
          const r = await alpacaSell(creds, p.ticker, qty).catch(() => null);
          if (!r || !r.ok || !r.filledQty) {
            trades.push({ ticker: p.ticker, side: "SELL", qty: 0, price: px, reason: "circuit-breaker", skipped: r?.error ?? "no fill" });
            continue;
          }
          qty = r.filledQty;
          fillPx = r.filledAvgPrice ?? px;
        }
        const remaining = Number(p.qty) - qty;
        if (remaining > 0.0001) await sql`UPDATE positions SET qty=${remaining} WHERE user_id=${user.id} AND ticker=${p.ticker}`;
        else await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${p.ticker}`;
        await sql`UPDATE users SET cash=cash+${qty * fillPx} WHERE id=${user.id}`;
        await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${p.ticker},'SELL',${qty},${fillPx})`;
        cash += qty * fillPx;
        trades.push({ ticker: p.ticker, side: "SELL", qty, price: fillPx, reason: "circuit-breaker" });
      } catch (e: any) { trades.push({ ticker: p.ticker, side: "SELL", qty: 0, price: 0, reason: "circuit-breaker", skipped: `error: ${String(e?.message ?? e).slice(0,80)}` }); }
    }
    const cooldownDays = 7;
    const until = new Date(Date.now() + cooldownDays * 86400_000).toISOString();
    await sql`UPDATE users SET circuit_breaker_until=${until} WHERE id=${user.id}`;
    const title = `🛑 Factor circuit breaker tripped (${(drawdown * 100).toFixed(1)}% drawdown)`;
    const body = `Liquidated portfolio to cash. Rebalancing paused ${cooldownDays}d.`;
    try {
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body) VALUES (${user.id}, NULL, 'circuit_breaker', ${title}, ${body})`;
      await alertUser(user as any, title, body);
    } catch {}
    return { user: user.name, circuitBreaker: true, drawdownPct: drawdown * 100, trades, target_as_of: target.as_of, regime: target.regime, exposure: target.exposure };
  }
  if (inCooldown) {
    return { user: user.name, skipped: "circuit_breaker_cooldown", until: breakerUntil!.toISOString(), target_as_of: target.as_of };
  }

  // 1) SELL anything not in the target
  for (const p of positions) {
   try {
    if (tgtTickers.includes(p.ticker)) continue;
    const px = quotes[p.ticker]?.price;
    if (!px) continue;
    let qty = Number(p.qty);
    let fillPx = px;
    if (live) {
      // Real broker order: record only what actually filled, at the real price.
      const r = await alpacaSell(creds, p.ticker, qty).catch(() => null);
      if (!r || !r.ok || !r.filledQty) {
        trades.push({ ticker: p.ticker, side: "SELL", qty: 0, price: px, reason: "not-in-target", skipped: r?.error ?? "no fill" });
        continue;   // nothing filled → leave DB untouched (no drift)
      }
      qty = r.filledQty;
      fillPx = r.filledAvgPrice ?? px;
    }
    // Update DB by the (possibly partial) filled qty
    const remaining = Number(p.qty) - qty;
    if (remaining > 0.0001) await sql`UPDATE positions SET qty=${remaining} WHERE user_id=${user.id} AND ticker=${p.ticker}`;
    else { await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${p.ticker}`; delete held[p.ticker]; }
    await sql`UPDATE users SET cash=cash+${qty * fillPx} WHERE id=${user.id}`;
    await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${p.ticker},'SELL',${qty},${fillPx})`;
    cash += qty * fillPx;
    if (remaining > 0.0001 && held[p.ticker]) held[p.ticker].qty = remaining;
    trades.push({ ticker: p.ticker, side: "SELL", qty, price: fillPx, reason: "not-in-target" });
   } catch (e: any) { trades.push({ ticker: p.ticker, side: "SELL", qty: 0, price: 0, reason: "not-in-target", skipped: `error: ${String(e?.message ?? e).slice(0,80)}` }); }
  }

  // Recompute equity after sells so buy sizing uses up-to-date capital
  let updatedPosVal = 0;
  for (const tk in held) {
    const px = quotes[tk]?.price;
    if (px) updatedPosVal += held[tk].qty * px;
  }
  equity = cash + updatedPosVal;

  // 2) Rebalance each target name to weight × equity
  for (const tk of tgtTickers) {
   try {
    const px = quotes[tk]?.price;
    if (!px || px <= 0) continue;
    const targetDollars = Number(targets[tk]) * equity;
    const cur = held[tk] || { qty: 0, avg: 0 };
    const deltaDollars = targetDollars - cur.qty * px;
    // No-trade band: skip unless drift exceeds BOTH the absolute floor and 1.5%
    // of the portfolio. Cuts needless turnover/costs on tiny rebalances.
    if (Math.abs(deltaDollars) < MIN_TRADE || Math.abs(deltaDollars) < REBALANCE_BAND * equity) continue;
    const deltaShares = Math.floor(Math.abs(deltaDollars) / px);
    if (deltaShares < 1) continue;

    if (deltaDollars > 0) {                       // BUY
      let qty = deltaShares;
      if (deltaShares * px > cash) continue;
      let fillPx = px;
      if (live) {
        const r = await alpacaBuy(creds, tk, deltaShares).catch(() => null);
        if (!r || !r.ok || !r.filledQty) {
          trades.push({ ticker: tk, side: "BUY", qty: 0, price: px, reason: "rebalance", skipped: r?.error ?? "no fill" });
          continue;
        }
        qty = r.filledQty;
        fillPx = r.filledAvgPrice ?? px;
      }
      const cost = qty * fillPx;
      const newQty = cur.qty + qty;
      const newAvg = cur.qty > 0 ? (cur.qty * cur.avg + cost) / newQty : fillPx;
      await sql`INSERT INTO positions (user_id,ticker,qty,avg_cost) VALUES (${user.id},${tk},${qty},${fillPx})
        ON CONFLICT (user_id,ticker) DO UPDATE SET qty=${newQty}, avg_cost=${newAvg}`;
      await sql`UPDATE users SET cash=cash-${cost} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${tk},'BUY',${qty},${fillPx})`;
      cash -= cost;
      held[tk] = { qty: newQty, avg: newAvg };
      trades.push({ ticker: tk, side: "BUY", qty, price: fillPx, reason: "rebalance" });
    } else {                                      // SELL down to target
      let sellQty = Math.min(deltaShares, cur.qty);
      if (sellQty < 1) continue;
      let fillPx = px;
      if (live) {
        const r = await alpacaSell(creds, tk, sellQty).catch(() => null);
        if (!r || !r.ok || !r.filledQty) {
          trades.push({ ticker: tk, side: "SELL", qty: 0, price: px, reason: "trim-to-target", skipped: r?.error ?? "no fill" });
          continue;
        }
        sellQty = r.filledQty;
        fillPx = r.filledAvgPrice ?? px;
      }
      const proceeds = sellQty * fillPx;
      const newQty = cur.qty - sellQty;
      if (newQty <= 0.0001) await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${tk}`;
      else await sql`UPDATE positions SET qty=${newQty} WHERE user_id=${user.id} AND ticker=${tk}`;
      await sql`UPDATE users SET cash=cash+${proceeds} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id,ticker,side,qty,price) VALUES (${user.id},${tk},'SELL',${sellQty},${fillPx})`;
      cash += proceeds;
      held[tk] = { qty: newQty, avg: cur.avg };
      trades.push({ ticker: tk, side: "SELL", qty: sellQty, price: fillPx, reason: "trim-to-target" });
    }
   } catch (e: any) { trades.push({ ticker: tk, side: "BUY", qty: 0, price: 0, reason: "rebalance", skipped: `error: ${String(e?.message ?? e).slice(0,80)}` }); }
  }

  const buys = trades.filter(t => t.side === "BUY" && t.qty > 0).length;
  const sells = trades.filter(t => t.side === "SELL" && t.qty > 0).length;
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
      // Scope the automated factor rebalance to the designated factor account
      // ONLY — so other accounts (e.g. an A/B account running the old TA button)
      // are never overwritten by the factor job.
      const factorAccount = process.env.FACTOR_ACCOUNT_NAME || "Vivaan";
      // Any account opted into the factor strategy (plus the legacy default account).
      const users = await sql`SELECT * FROM users WHERE strategy = 'factor' OR name = ${factorAccount}`;
      const results = [];
      // Isolate each account: one user's failure must not abort the others' rebalance.
      for (const u of users.rows) {
        try { results.push(await rebalanceUser(u, target)); }
        catch (e: any) { results.push({ user: u.name, error: String(e?.message ?? e) }); }
      }
      return NextResponse.json({ ok: true, mode: "automated", account: factorAccount, users: results.length, results });
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
