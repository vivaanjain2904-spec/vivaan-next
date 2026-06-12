import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart, daysUntilEarnings } from "@/lib/yfinance";
import { computeSignal, computeMarketRegime, computeTrailingStop, sizingMultiplier } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaSell, alpacaBuy } from "@/lib/alpaca";

export const maxDuration = 30;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(() => { clearTimeout(t); resolve(null); });
  });
}

/**
 * Self-trigger the alert check for the currently logged-in user only.
 * Same logic as the 15-min cron (cron/check-alerts), but scoped to one user
 * (so anyone can use it via the dashboard's "Test auto-trader" button
 * without exposing the cron secret).
 */
export async function POST() {
  const s = await requireSession();

  const userRow = await sql`SELECT id, name, cash, ntfy_topic, discord_webhook, email,
    ml_alerts, ml_threshold, alpaca_key, alpaca_secret, alpaca_mode, auto_trade, auto_buy_size,
    circuit_breaker_until, max_positions, max_pos_pct, cash_reserve_pct
    FROM users WHERE id=${s.uid}`;
  const user = userRow.rows[0];
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const [pos, wl] = await Promise.all([
    sql`SELECT ticker, qty, avg_cost, stop_loss, take_profit
        FROM positions WHERE user_id=${user.id} AND qty>0`,
    sql`SELECT ticker, alert_above, alert_below, ml_alert
        FROM watchlist WHERE user_id=${user.id}`,
  ]);
  const positions = pos.rows, watch = wl.rows;
  const tickers = Array.from(new Set([
    ...positions.map(p => p.ticker), ...watch.map(w => w.ticker),
  ]));
  if (!tickers.length) {
    return NextResponse.json({
      ok: true, info: "No positions or watchlist entries to check.",
      breaches: [], orders: [],
    });
  }

  // Live data + ML — Python uploads first (fresh only), fall back to live compute
  const quotes = await getQuotes(tickers);
  const pyR = await sql`SELECT ticker, drop_probability FROM ml_signals
    WHERE ticker = ANY(${tickers as any})
      AND updated_at > NOW() - INTERVAL '24 hours'`;
  const ml: Record<string, number> = {};
  for (const r of pyR.rows) ml[r.ticker] = Number(r.drop_probability);
  const need = tickers.filter(t => ml[t] == null).slice(0, 15);
  if (need.length) {
    const charts = await Promise.all(need.map(t => getChart(t, "3mo").catch(() => [])));
    charts.forEach((c, j) => {
      const sig = computeSignal(c);
      if (sig) ml[need[j]] = sig.dropProb;
    });
  }

  async function transition(ticker: string, kind: string, nowActive: boolean) {
    const cur = await sql`SELECT active FROM alert_state
      WHERE user_id=${user.id} AND ticker=${ticker} AND kind=${kind}`;
    const was = cur.rows[0]?.active ?? false;
    if (cur.rows[0])
      await sql`UPDATE alert_state SET active=${nowActive}
        WHERE user_id=${user.id} AND ticker=${ticker} AND kind=${kind}`;
    else
      await sql`INSERT INTO alert_state (user_id, ticker, kind, active)
        VALUES (${user.id}, ${ticker}, ${kind}, ${nowActive})`;
    return nowActive && !was;
  }

  const breaches: any[] = [];
  const orders: any[] = [];

  async function tryAutoSell(ticker: string, qty: number, price: number, reason: string) {
    if (!user.auto_trade) return null;

    let filledQty = qty; // paper: assume full fill
    let fillPrice = price; // paper: book at the signal price
    let alpacaOrderId: string | undefined, alpacaErr: string | undefined, alpacaPending = false;
    if (user.alpaca_key && user.alpaca_secret) {
      const r = await alpacaSell(
        { key: user.alpaca_key, secret: user.alpaca_secret, mode: user.alpaca_mode === "live" ? "live" : "paper" }, ticker, qty);
      const submitted = !!r.orderId && !["rejected", "canceled", "expired"].includes(String(r.status));
      if (submitted) {
        alpacaOrderId = r.orderId;
        alpacaPending = !r.ok;
        if (r.filledQty && r.filledQty < qty) filledQty = r.filledQty;
        if (r.filledAvgPrice) fillPrice = r.filledAvgPrice;
      } else {
        alpacaErr = r.error;
      }
    }

    // Mirror the sell in the local DB using the actual filled qty + price
    try {
      const remaining = qty - filledQty;
      if (remaining > 0.0001) {
        await sql`UPDATE positions SET qty=${remaining} WHERE user_id=${user.id} AND ticker=${ticker}`;
      } else {
        await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${ticker}`;
      }
      await sql`UPDATE users SET cash = cash + ${filledQty * fillPrice} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
        VALUES (${user.id}, ${ticker}, 'SELL', ${filledQty}, ${fillPrice})`;
    } catch {}

    if (alpacaOrderId) return { tried: true, ok: true, orderId: alpacaOrderId,
      info: `🤖 Auto-sold ${filledQty} ${ticker} via Alpaca (${reason}). Order ${alpacaOrderId}${alpacaPending ? " (pending fill)" : ""}` };
    if (alpacaErr) return { tried: true, ok: true, alpacaErr,
      info: `🤖 Paper auto-sold ${filledQty} ${ticker} (${reason}). Alpaca failed: ${alpacaErr}` };
    return { tried: true, ok: true, info: `🤖 Paper auto-sold ${filledQty} ${ticker} (${reason})` };
  }

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

    if (await transition(p.ticker, "stop", !!stopHit)) {
      breaches.push({ ticker: p.ticker, kind: "stop", price: px, qty: p.qty });
      const auto = await tryAutoSell(p.ticker, Number(p.qty), px, "stop-loss");
      if (auto?.tried) orders.push({ ticker: p.ticker, ...auto });
      const title = `🔴 ${p.ticker} hit stop-loss`;
      const body  = `${p.ticker} $${px.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs $${avg.toFixed(2)})` +
        (auto?.info ? ` · ${auto.info}` : "");
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
        VALUES (${user.id}, ${p.ticker}, 'stop', ${title}, ${body})`;
      await alertUser(user, title, body);
    }
    if (await transition(p.ticker, "target", !!tgtHit)) {
      breaches.push({ ticker: p.ticker, kind: "target", price: px, qty: p.qty });
      const auto = await tryAutoSell(p.ticker, Number(p.qty), px, "take-profit");
      if (auto?.tried) orders.push({ ticker: p.ticker, ...auto });
      const title = `🟢 ${p.ticker} hit take-profit`;
      const body  = `${p.ticker} $${px.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs $${avg.toFixed(2)})` +
        (auto?.info ? ` · ${auto.info}` : "");
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
        VALUES (${user.id}, ${p.ticker}, 'target', ${title}, ${body})`;
      await alertUser(user, title, body);
    }
    if (await transition(p.ticker, "ml_hold", !!mlHit)) {
      breaches.push({ ticker: p.ticker, kind: "ml_hold", price: px, qty: p.qty });
      // Alert at the user's threshold, but only auto-SELL on an extreme score —
      // calibration showed dropProb 0.60-0.70 doesn't predict drops, and
      // oversold names tend to bounce at 1-month horizons.
      const auto = prob! >= Math.max(Number(user.ml_threshold) || 0.65, 0.80)
        ? await tryAutoSell(p.ticker, Number(p.qty), px, "ml-signal")
        : null;
      if (auto?.tried) orders.push({ ticker: p.ticker, ...auto });
      const title = `⚠️ ${p.ticker} ML sell signal`;
      const body  = `Drop probability ${(prob! * 100).toFixed(0)}% — at or above your ${(Number(user.ml_threshold) * 100).toFixed(0)}% threshold` +
        (auto?.info ? ` · ${auto.info}` : "");
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
        VALUES (${user.id}, ${p.ticker}, 'ml_hold', ${title}, ${body})`;
      await alertUser(user, title, body);
    }
  }

  // ──────────────────────────────────────────────────────────
  //  TRAILING STOPS — ratchet stop_loss up as positions run
  // ──────────────────────────────────────────────────────────
  const ratcheted: { ticker: string; oldSL: number; newSL: number; pnlPct: number }[] = [];
  for (const p of positions) {
    const q = quotes[p.ticker]; if (!q) continue;
    const avg = Number(p.avg_cost);
    if (!avg) continue;
    const pnlFrac = (q.price - avg) / avg;
    const curSL   = p.stop_loss != null ? Number(p.stop_loss) : 0.05;
    const newSL   = computeTrailingStop(curSL, pnlFrac);
    if (newSL < curSL - 1e-9) {
      await sql`UPDATE positions SET stop_loss=${newSL}
        WHERE user_id=${user.id} AND ticker=${p.ticker}`;
      ratcheted.push({ ticker: p.ticker, oldSL: curSL, newSL, pnlPct: pnlFrac * 100 });
      const lockPct = newSL <= 0 ? `+${(-newSL * 100).toFixed(0)}%` : "break-even";
      const title = `🔒 ${p.ticker} trailing stop tightened`;
      const body  = `${p.ticker} up ${(pnlFrac * 100).toFixed(1)}% — moved stop to lock in ${lockPct}.`;
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
        VALUES (${user.id}, ${p.ticker}, 'trail', ${title}, ${body})`;
      await alertUser(user, title, body);
    }
  }

  // ──────────────────────────────────────────────────────────
  //  MARKET REGIME — skip new auto-buys when SPY is in a downtrend
  // ──────────────────────────────────────────────────────────
  let regime: "bull" | "bear" | "neutral" = "neutral";
  try {
    const spyChart = await getChart("SPY", "6mo").catch(() => []);
    regime = computeMarketRegime(spyChart);
  } catch {}

  // ──────────────────────────────────────────────────────────
  //  AUTO-BUY: strong bullish ML signal on a watchlist stock
  // ──────────────────────────────────────────────────────────
  const breakerUntil = user.circuit_breaker_until ? new Date(user.circuit_breaker_until) : null;
  const breakerActive = breakerUntil != null && breakerUntil.getTime() > Date.now();

  if (user.auto_trade && regime !== "bear" && !breakerActive) {
    let cash = Number(user.cash);
    const heldSet = new Set(positions.map(p => p.ticker));
    let openCount = positions.length;
    const maxPositions = Number(user.max_positions) || 15;
    const maxPosPct = Number(user.max_pos_pct) || 0.08;
    const reservePct = Number(user.cash_reserve_pct) || 0.15;

    let positionValue = 0;
    for (const p of positions) {
      const px = quotes[p.ticker]?.price;
      positionValue += Number(p.qty) * (px && px > 0 ? px : Number(p.avg_cost));
    }
    const totalEquity = cash + positionValue;
    let cashAvailable = Math.max(0, Math.min(cash, totalEquity * (1 - reservePct) - positionValue));

    // Stricter than `1 - ml_threshold`: only fire on genuinely high-conviction
    // bullish signals (drop probability under 20%, vs. the previous ~35%).
    const buySignalThr = Math.min(0.20, 1 - Number(user.ml_threshold));

    for (const w of watch) {
      if (openCount >= maxPositions) break;
      if (heldSet.has(w.ticker)) continue;
      const prob = ml[w.ticker];
      if (prob == null || prob > buySignalThr) continue;
      // Skip if earnings are within 3 days — too much gap risk
      const daysToER = await withTimeout(daysUntilEarnings(w.ticker), 2000);
      if (daysToER != null && daysToER >= 0 && daysToER <= 3) continue;
      const q = quotes[w.ticker]; if (!q?.price) continue;
      // Conviction-based sizing: stronger signal (lower dropProb) → bigger position,
      // capped at 1.5x, and capped at the per-position equity limit.
      const buyBudget = Math.min((Number(user.auto_buy_size) || 500) * sizingMultiplier(prob), totalEquity * maxPosPct);
      const qty = Math.floor(buyBudget / q.price);
      if (qty < 1) continue;
      const cost = qty * q.price;
      if (cost > cashAvailable) continue;
      if (!(await transition(w.ticker, "ml_buy", true))) continue;

      // Optional Alpaca leg
      let alpacaOrderId: string | undefined, alpacaPending = false, alpacaErr: string | undefined;
      let fillQty = qty, fillPrice = q.price; // paper: book the planned fill
      if (user.alpaca_key && user.alpaca_secret) {
        const r = await alpacaBuy(
          { key: user.alpaca_key, secret: user.alpaca_secret, mode: user.alpaca_mode === "live" ? "live" : "paper" }, w.ticker, qty);
        const submitted = !!r.orderId && !["rejected", "canceled", "expired"].includes(String(r.status));
        if (submitted) {
          alpacaOrderId = r.orderId;
          alpacaPending = !r.ok;
          if (r.filledQty) fillQty = r.filledQty;
          if (r.filledAvgPrice) fillPrice = r.filledAvgPrice;
        } else {
          alpacaErr = r.error;
        }
      }

      const fillCost = fillQty * fillPrice;
      try {
        await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
          VALUES (${user.id}, ${w.ticker}, ${fillQty}, ${fillPrice}, 0.05, 0.10)
          ON CONFLICT (user_id, ticker) DO UPDATE SET
            qty = positions.qty + ${fillQty},
            avg_cost = (positions.qty * positions.avg_cost + ${fillCost}) / (positions.qty + ${fillQty})`;
        await sql`UPDATE users SET cash = cash - ${fillCost} WHERE id=${user.id}`;
        await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
          VALUES (${user.id}, ${w.ticker}, 'BUY', ${fillQty}, ${fillPrice})`;
        cash -= fillCost;
        cashAvailable -= fillCost;
        openCount++;
        heldSet.add(w.ticker);
      } catch {}

      const mode = alpacaOrderId ? "Alpaca" : (alpacaErr ? "paper-only (Alpaca failed)" : "paper");
      orders.push({ ticker: w.ticker, ok: true, side: "BUY", orderId: alpacaOrderId,
                    qty: fillQty, price: fillPrice, mode,
                    reason: `ML buy signal (${(prob*100).toFixed(0)}%)` });
      const sizeMult = sizingMultiplier(prob);
      const title = `🤖 Auto-bought ${fillQty} ${w.ticker}`;
      const body  = `ML drop-prob ${(prob*100).toFixed(0)}% — high-conviction buy` +
                    ` (${sizeMult.toFixed(2)}x size, ${regime} regime).` +
                    (alpacaOrderId ? ` Alpaca order ${alpacaOrderId}${alpacaPending ? " (pending fill)" : ""}.` : " (paper-only).") +
                    ` Cost $${fillCost.toFixed(2)}.`;
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
        VALUES (${user.id}, ${w.ticker}, 'auto_buy', ${title}, ${body})`;
      await alertUser(user, title, body);
    }
    for (const w of watch) {
      const prob = ml[w.ticker];
      if (prob != null && prob > buySignalThr) await transition(w.ticker, "ml_buy", false);
    }
  }

  return NextResponse.json({
    ok: true,
    checked: tickers.length,
    regime,
    trailing_ratchets: ratcheted,
    breaches, orders,
    msg: breaches.length || orders.length
      ? `${breaches.length} alert(s), ${orders.length} order(s) executed.`
      : "No alerts tripped — all positions within range.",
  });
}
