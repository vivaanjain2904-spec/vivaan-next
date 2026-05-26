import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { getQuotes, getChart, daysUntilEarnings } from "@/lib/yfinance";
import { computeSignal, computeMarketRegime, computeTrailingStop, sizingMultiplier } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaSell, alpacaBuy } from "@/lib/alpaca";

export const maxDuration = 60;

/**
 * Vercel Cron — every 5 min (see vercel.json).
 * For each user, evaluates:
 *   - stop-loss / take-profit on holdings
 *   - watchlist alert_above / alert_below
 *   - ML signal (Python override OR live RSI/MA/momentum) >= threshold
 * For each new alert: send to ntfy + Discord. If auto_trade is on and Alpaca
 * keys exist, execute a paper sell for the breached stop/target/ML position.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await initDb().catch(() => {});

  const usersR = await sql`SELECT id, name, ntfy_topic, discord_webhook, email,
    ml_alerts, ml_threshold, alpaca_key, alpaca_secret, auto_trade, auto_buy_size FROM users`;
  if (!usersR.rows.length) return NextResponse.json({ ok: true, msg: "no users" });

  // Collect every ticker across all users
  const allTickers = new Set<string>();
  const userData: any[] = [];
  for (const u of usersR.rows) {
    const [pos, wl] = await Promise.all([
      sql`SELECT ticker, qty, avg_cost, stop_loss, take_profit
          FROM positions WHERE user_id=${u.id} AND qty>0`,
      sql`SELECT ticker, alert_above, alert_below, ml_alert
          FROM watchlist WHERE user_id=${u.id}`,
    ]);
    pos.rows.forEach(p => allTickers.add(p.ticker));
    wl.rows.forEach(w => allTickers.add(w.ticker));
    userData.push({ user: u, positions: pos.rows, watch: wl.rows });
  }
  const tickerArr = Array.from(allTickers);

  // Live quotes
  const quotes = await getQuotes(tickerArr);

  // ML signals — Python uploads first, fall back to live compute per ticker
  const pyR = await sql`SELECT ticker, drop_probability FROM ml_signals
    WHERE ticker = ANY(${tickerArr as any})`;
  const ml: Record<string, number> = {};
  for (const r of pyR.rows) ml[r.ticker] = Number(r.drop_probability);

  // Compute live for tickers without a Python score.
  // Cap at 15 — Vercel Hobby caps functions at 10s, and chart fetches are ~1s each.
  // For larger user bases either upload Python scores or upgrade to Pro for maxDuration=60.
  const need = tickerArr.filter(t => ml[t] == null).slice(0, 15);
  if (need.length) {
    const charts = await Promise.all(need.map(t => getChart(t, "3mo").catch(() => [])));
    charts.forEach((c, j) => {
      const sig = computeSignal(c);
      if (sig) ml[need[j]] = sig.dropProb;
    });
  }

  async function transition(uid: number, ticker: string, kind: string, nowActive: boolean) {
    const cur = await sql`SELECT active FROM alert_state
      WHERE user_id=${uid} AND ticker=${ticker} AND kind=${kind}`;
    const was = cur.rows[0]?.active ?? false;
    if (cur.rows[0])
      await sql`UPDATE alert_state SET active=${nowActive}
        WHERE user_id=${uid} AND ticker=${ticker} AND kind=${kind}`;
    else
      await sql`INSERT INTO alert_state (user_id, ticker, kind, active)
        VALUES (${uid}, ${ticker}, ${kind}, ${nowActive})`;
    return nowActive && !was;
  }

  async function tryAutoSell(user: any, ticker: string, qty: number, price: number, reason: string) {
    if (!user.auto_trade) return null;

    let alpacaOrderId: string | undefined, alpacaErr: string | undefined;
    if (user.alpaca_key && user.alpaca_secret) {
      const r = await alpacaSell(
        { key: user.alpaca_key, secret: user.alpaca_secret }, ticker, qty);
      if (r.ok) alpacaOrderId = r.orderId; else alpacaErr = r.error;
    }

    // Always mirror the sell in our local DB
    try {
      await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${ticker}`;
      await sql`UPDATE users SET cash = cash + ${qty * price} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
        VALUES (${user.id}, ${ticker}, 'SELL', ${qty}, ${price})`;
    } catch {}

    if (alpacaOrderId) return `🤖 Auto-sold ${qty} ${ticker} via Alpaca (${reason}). Order ${alpacaOrderId}`;
    if (alpacaErr)     return `🤖 Paper auto-sold ${qty} ${ticker} (${reason}). Alpaca failed: ${alpacaErr}`;
    return `🤖 Paper auto-sold ${qty} ${ticker} (${reason})`;
  }

  // Market regime — fetch SPY once for all users in this run
  let regime: "bull" | "bear" | "neutral" = "neutral";
  try {
    const spy = await getChart("SPY", "6mo").catch(() => []);
    regime = computeMarketRegime(spy);
  } catch {}

  let total = 0;
  for (const { user, positions, watch } of userData) {
    const sent: Array<{ title: string; body: string }> = [];

    // ── Trailing stops: ratchet stop_loss up as positions run ──
    for (const p of positions) {
      const q = quotes[p.ticker]; if (!q) continue;
      const avg = Number(p.avg_cost); if (!avg) continue;
      const pnlFrac = (q.price - avg) / avg;
      const curSL = p.stop_loss != null ? Number(p.stop_loss) : 0.05;
      const newSL = computeTrailingStop(curSL, pnlFrac);
      if (newSL < curSL - 1e-9) {
        await sql`UPDATE positions SET stop_loss=${newSL}
          WHERE user_id=${user.id} AND ticker=${p.ticker}`;
        const lockLabel = newSL <= 0 ? `+${(-newSL * 100).toFixed(0)}%` : "break-even";
        const title = `🔒 ${p.ticker} trailing stop tightened`;
        const body  = `${p.ticker} up ${(pnlFrac * 100).toFixed(1)}% — moved stop to lock in ${lockLabel}.`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'trail', ${title}, ${body})`;
        sent.push({ title, body }); total++;
        // Update local p.stop_loss so the stop-hit check below uses the new value
        p.stop_loss = newSL;
      }
    }

    // Holdings: stop / target / ML
    for (const p of positions) {
      const q = quotes[p.ticker]; if (!q) continue;
      const px = q.price, avg = Number(p.avg_cost);
      const pnl = avg ? ((px - avg) / avg) * 100 : 0;
      const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
      const tp = p.take_profit != null ? Number(p.take_profit) : null;
      const stopHit = sl != null && avg && px <= avg * (1 - sl);
      const tgtHit  = tp != null && avg && px >= avg * (1 + tp);
      const prob = ml[p.ticker];
      const mlHit = user.ml_alerts && prob != null && prob >= Number(user.ml_threshold);

      if (await transition(user.id, p.ticker, "stop", !!stopHit)) {
        const title = `🔴 ${p.ticker} hit stop-loss`;
        const body  = `${p.ticker} $${px.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs $${avg.toFixed(2)})`;
        const auto  = await tryAutoSell(user, p.ticker, Number(p.qty), px, "stop-loss");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'stop', ${title}, ${auto ? body + " · " + auto : body})`;
        sent.push({ title, body: auto ? body + " · " + auto : body }); total++;
      }
      if (await transition(user.id, p.ticker, "target", !!tgtHit)) {
        const title = `🟢 ${p.ticker} hit take-profit`;
        const body  = `${p.ticker} $${px.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs $${avg.toFixed(2)})`;
        const auto  = await tryAutoSell(user, p.ticker, Number(p.qty), px, "take-profit");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'target', ${title}, ${auto ? body + " · " + auto : body})`;
        sent.push({ title, body: auto ? body + " · " + auto : body }); total++;
      }
      if (await transition(user.id, p.ticker, "ml_hold", !!mlHit)) {
        const title = `⚠️ ${p.ticker} ML sell signal`;
        const body  = `Drop probability ${(prob! * 100).toFixed(0)}% — at or above your ${(Number(user.ml_threshold) * 100).toFixed(0)}% threshold`;
        const auto  = await tryAutoSell(user, p.ticker, Number(p.qty), px, "ml-signal");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'ml_hold', ${title}, ${auto ? body + " · " + auto : body})`;
        sent.push({ title, body: auto ? body + " · " + auto : body }); total++;
      }
    }

    // Watchlist: above / below / ML
    for (const w of watch) {
      const q = quotes[w.ticker]; if (!q) continue;
      const px = q.price;
      const above = w.alert_above != null ? Number(w.alert_above) : null;
      const below = w.alert_below != null ? Number(w.alert_below) : null;

      if (await transition(user.id, w.ticker, "above", above != null && px >= above)) {
        const title = `🔔 ${w.ticker} crossed above $${above!.toFixed(2)}`;
        const body  = `${w.ticker} is now $${px.toFixed(2)}`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'above', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
      if (await transition(user.id, w.ticker, "below", below != null && px <= below)) {
        const title = `🔔 ${w.ticker} dropped below $${below!.toFixed(2)}`;
        const body  = `${w.ticker} is now $${px.toFixed(2)}`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'below', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
      const prob = ml[w.ticker];
      const mlW  = user.ml_alerts && w.ml_alert && prob != null && prob >= Number(user.ml_threshold);
      if (await transition(user.id, w.ticker, "ml_watch", !!mlW)) {
        const title = `⚠️ ${w.ticker} ML sell signal (watchlist)`;
        const body  = `Drop probability ${(prob! * 100).toFixed(0)}%`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'ml_watch', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
    }

    // ───── AUTO-BUY: strong bullish ML signal on watchlist ─────
    // Skip new auto-buys entirely during bear regime — don't fight the tape.
    if (user.auto_trade && regime !== "bear") {
      const cashR = await sql`SELECT cash FROM users WHERE id=${user.id}`;
      let cash = Number(cashR.rows[0]?.cash ?? 0);
      const heldSet = new Set(positions.map((p: any) => p.ticker));
      // Stricter than `1 - ml_threshold`: require high-conviction signals (< 20% drop prob)
      const buyThr = Math.min(0.20, 1 - Number(user.ml_threshold));

      for (const w of watch) {
        if (heldSet.has(w.ticker)) continue;
        const prob = ml[w.ticker];
        if (prob == null || prob > buyThr) continue;
        // Skip if earnings are within 3 days — too much gap risk
        const daysToER = await daysUntilEarnings(w.ticker);
        if (daysToER != null && daysToER >= 0 && daysToER <= 3) continue;
        const q = quotes[w.ticker]; if (!q?.price) continue;
        // Conviction-based sizing: stronger signal = bigger position, capped at 1.5x.
        const buyBudget = (Number(user.auto_buy_size) || 500) * sizingMultiplier(prob);
        const qty = Math.floor(buyBudget / q.price);
        if (qty < 1) continue;
        const cost = qty * q.price;
        if (cost > cash) continue;
        if (!(await transition(user.id, w.ticker, "ml_buy", true))) continue;

        let alpacaOrderId: string | undefined;
        if (user.alpaca_key && user.alpaca_secret) {
          const r = await alpacaBuy(
            { key: user.alpaca_key, secret: user.alpaca_secret }, w.ticker, qty);
          if (r.ok) alpacaOrderId = r.orderId;
        }
        try {
          await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
            VALUES (${user.id}, ${w.ticker}, ${qty}, ${q.price}, 0.05, 0.10)
            ON CONFLICT (user_id, ticker) DO NOTHING`;
          await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${user.id}`;
          await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
            VALUES (${user.id}, ${w.ticker}, 'BUY', ${qty}, ${q.price})`;
          cash -= cost;
        } catch {}
        const title = `🤖 Auto-bought ${qty} ${w.ticker}`;
        const body  = `ML drop-prob ${(prob*100).toFixed(0)}% — strong buy.` +
          (alpacaOrderId ? ` Alpaca order ${alpacaOrderId}.` : " (paper-only).");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'auto_buy', ${title}, ${body})`;
        await alertUser(user, title, body);
        total++;
      }
      // Reset ml_buy state when signal weakens
      for (const w of watch) {
        const prob = ml[w.ticker];
        if (prob != null && prob > buyThr) await transition(user.id, w.ticker, "ml_buy", false);
      }
    }

    for (const s of sent) await alertUser(user, s.title, s.body);
  }

  return NextResponse.json({ ok: true, sent: total, ts: new Date().toISOString() });
}
