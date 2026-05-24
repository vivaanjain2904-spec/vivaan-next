import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart } from "@/lib/yfinance";
import { computeSignal, computeMarketRegime, computeTrailingStop, sizingMultiplier } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaSell, alpacaBuy } from "@/lib/alpaca";

export const maxDuration = 30;

/**
 * Self-trigger the alert check for the currently logged-in user only.
 * Same logic as the daily cron, but scoped to one user (so anyone can use it
 * via the dashboard's "Test auto-trader" button without exposing the cron secret).
 */
export async function POST() {
  const s = await requireSession();

  const userRow = await sql`SELECT id, name, ntfy_topic, discord_webhook, email,
    ml_alerts, ml_threshold, alpaca_key, alpaca_secret, auto_trade, auto_buy_size
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

  // Live data + ML
  const quotes = await getQuotes(tickers);
  const pyR = await sql`SELECT ticker, drop_probability FROM ml_signals
    WHERE ticker = ANY(${tickers as any})`;
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

  async function maybeAutoSell(ticker: string, qty: number, price: number, reason: string) {
    if (!user.auto_trade) return { tried: false, info: "auto-trade disabled" };

    // Optional Alpaca leg — runs only when keys are configured
    let alpacaOrderId: string | undefined, alpacaErr: string | undefined;
    if (user.alpaca_key && user.alpaca_secret) {
      const r = await alpacaSell(
        { key: user.alpaca_key, secret: user.alpaca_secret }, ticker, qty);
      if (r.ok) alpacaOrderId = r.orderId; else alpacaErr = r.error;
    }

    // Always mirror the sell in the dashboard's paper portfolio
    try {
      await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${ticker}`;
      await sql`UPDATE users SET cash = cash + ${qty * price} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
        VALUES (${user.id}, ${ticker}, 'SELL', ${qty}, ${price})`;
    } catch {}

    return { tried: true, ok: true, orderId: alpacaOrderId, alpacaErr, reason,
             mode: alpacaOrderId ? "alpaca" : (alpacaErr ? "paper-only (alpaca failed)" : "paper") };
  }

  for (const p of positions) {
    const q = quotes[p.ticker]; if (!q) continue;
    const px = q.price, avg = Number(p.avg_cost);
    const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
    const tp = p.take_profit != null ? Number(p.take_profit) : null;
    const stopHit = sl != null && avg && px <= avg * (1 - sl);
    const tgtHit  = tp != null && avg && px >= avg * (1 + tp);
    const prob = ml[p.ticker];
    const mlHit = user.ml_alerts && prob != null && prob >= Number(user.ml_threshold);

    for (const [kind, hit, reason] of [
      ["stop",    stopHit, "stop-loss"   ],
      ["target",  tgtHit,  "take-profit" ],
      ["ml_hold", mlHit,   "ml-signal"   ],
    ] as const) {
      if (await transition(p.ticker, kind, !!hit)) {
        breaches.push({ ticker: p.ticker, kind, price: px, qty: p.qty });
        const auto = await maybeAutoSell(p.ticker, Number(p.qty), px, reason);
        if (auto.tried) orders.push({ ticker: p.ticker, ...auto });
        const title = kind === "stop"   ? `🔴 ${p.ticker} hit stop-loss`
                    : kind === "target" ? `🟢 ${p.ticker} hit take-profit`
                                        : `⚠️ ${p.ticker} ML sell signal`;
        const body  = `${p.ticker} $${px.toFixed(2)}` +
          (auto.tried && auto.ok ? ` · 🤖 Auto-sold via Alpaca (order ${auto.orderId})` : "");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, ${kind}, ${title}, ${body})`;
        await alertUser(user, title, body);
      }
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
  const heldSet = new Set(positions.map(p => p.ticker));
  if (user.auto_trade && regime !== "bear") {
    const cashR = await sql`SELECT cash FROM users WHERE id=${user.id}`;
    let cash = Number(cashR.rows[0]?.cash ?? 0);
    // Stricter than `1 - ml_threshold`: only fire on genuinely high-conviction
    // bullish signals (drop probability under 20%, vs. the previous ~35%).
    const buySignalThr = Math.min(0.20, 1 - Number(user.ml_threshold));

    for (const w of watch) {
      if (heldSet.has(w.ticker)) continue;
      const prob = ml[w.ticker];
      if (prob == null || prob > buySignalThr) continue;
      const q = quotes[w.ticker]; if (!q?.price) continue;
      // Conviction-based sizing: stronger signal (lower dropProb) → bigger position, capped at 1.5x.
      const baseBudget = Number(user.auto_buy_size) || 500;
      const buyBudget = baseBudget * sizingMultiplier(prob);
      const qty = Math.floor(buyBudget / q.price);
      if (qty < 1) continue;
      const cost = qty * q.price;
      if (cost > cash) continue;
      if (!(await transition(w.ticker, "ml_buy", true))) continue;

      // Optional Alpaca leg
      let alpacaOrderId: string | undefined, alpacaErr: string | undefined;
      if (user.alpaca_key && user.alpaca_secret) {
        const r = await alpacaBuy(
          { key: user.alpaca_key, secret: user.alpaca_secret }, w.ticker, qty);
        if (r.ok) alpacaOrderId = r.orderId; else alpacaErr = r.error;
      }

      // Always do the paper buy in our DB
      try {
        await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
          VALUES (${user.id}, ${w.ticker}, ${qty}, ${q.price}, 0.05, 0.10)
          ON CONFLICT (user_id, ticker) DO NOTHING`;
        await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${user.id}`;
        await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
          VALUES (${user.id}, ${w.ticker}, 'BUY', ${qty}, ${q.price})`;
        cash -= cost;
      } catch {}

      const mode = alpacaOrderId ? "Alpaca" : (alpacaErr ? "paper-only (Alpaca failed)" : "paper");
      orders.push({ ticker: w.ticker, ok: true, side: "BUY", orderId: alpacaOrderId,
                    qty, price: q.price, mode,
                    reason: `ML buy signal (${(prob*100).toFixed(0)}%)` });
      const sizeMult = sizingMultiplier(prob);
      const title = `🤖 Auto-bought ${qty} ${w.ticker}`;
      const body  = `ML drop-prob ${(prob*100).toFixed(0)}% — high-conviction buy` +
                    ` (${sizeMult.toFixed(2)}x size, ${regime} regime).` +
                    (alpacaOrderId ? ` Alpaca order ${alpacaOrderId}.` : " (paper-only).") +
                    ` Cost $${cost.toFixed(2)}.`;
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
