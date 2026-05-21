import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart } from "@/lib/yfinance";
import { computeSignal } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaSell, alpacaBuy } from "@/lib/alpaca";

const AUTO_BUY_SIZE_USD = 500;   // $ per auto-buy

export const maxDuration = 30;

/**
 * Self-trigger the alert check for the currently logged-in user only.
 * Same logic as the daily cron, but scoped to one user (so anyone can use it
 * via the dashboard's "Test auto-trader" button without exposing the cron secret).
 */
export async function POST() {
  const s = await requireSession();

  const userRow = await sql`SELECT id, name, ntfy_topic, discord_webhook,
    ml_alerts, ml_threshold, alpaca_key, alpaca_secret, auto_trade
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
    if (!user.auto_trade || !user.alpaca_key || !user.alpaca_secret) {
      return { tried: false, info: "auto-trade disabled or keys missing" };
    }
    const r = await alpacaSell(
      { key: user.alpaca_key, secret: user.alpaca_secret }, ticker, qty);
    if (r.ok) {
      try {
        await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${ticker}`;
        await sql`UPDATE users SET cash = cash + ${qty * price} WHERE id=${user.id}`;
        await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
          VALUES (${user.id}, ${ticker}, 'SELL', ${qty}, ${price})`;
      } catch {}
      return { tried: true, ok: true, orderId: r.orderId, reason };
    }
    return { tried: true, ok: false, error: r.error, reason };
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
  //  AUTO-BUY: strong bullish ML signal on a watchlist stock
  // ──────────────────────────────────────────────────────────
  const heldSet = new Set(positions.map(p => p.ticker));
  if (user.auto_trade && user.alpaca_key && user.alpaca_secret) {
    const cashR = await sql`SELECT cash FROM users WHERE id=${user.id}`;
    let cash = Number(cashR.rows[0]?.cash ?? 0);
    const buySignalThr = 1 - Number(user.ml_threshold);   // e.g. 0.35 by default

    for (const w of watch) {
      if (heldSet.has(w.ticker)) continue;                 // already own it
      const prob = ml[w.ticker];
      if (prob == null || prob > buySignalThr) continue;   // not a strong buy
      const q = quotes[w.ticker]; if (!q?.price) continue;
      const qty = Math.floor(AUTO_BUY_SIZE_USD / q.price);
      if (qty < 1) continue;
      const cost = qty * q.price;
      if (cost > cash) continue;

      // Only fire once per "buy window"
      if (!(await transition(w.ticker, "ml_buy", true))) continue;

      const r = await alpacaBuy(
        { key: user.alpaca_key, secret: user.alpaca_secret }, w.ticker, qty);
      if (r.ok) {
        try {
          await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
            VALUES (${user.id}, ${w.ticker}, ${qty}, ${q.price}, 0.05, 0.10)
            ON CONFLICT (user_id, ticker) DO NOTHING`;
          await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${user.id}`;
          await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
            VALUES (${user.id}, ${w.ticker}, 'BUY', ${qty}, ${q.price})`;
          cash -= cost;
        } catch {}
        orders.push({ ticker: w.ticker, ok: true, side: "BUY", orderId: r.orderId,
                      qty, price: q.price, reason: `ML buy signal (${(prob*100).toFixed(0)}%)` });
        const title = `🤖 Auto-bought ${qty} ${w.ticker}`;
        const body  = `ML drop-prob ${(prob*100).toFixed(0)}% — strong buy. Order ${r.orderId}. Cost $${cost.toFixed(2)}.`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'auto_buy', ${title}, ${body})`;
        await alertUser(user, title, body);
      } else {
        orders.push({ ticker: w.ticker, ok: false, side: "BUY", error: r.error });
      }
    }
    // Reset ml_buy state once signal flips back above threshold so we can buy again later
    for (const w of watch) {
      const prob = ml[w.ticker];
      if (prob != null && prob > buySignalThr) await transition(w.ticker, "ml_buy", false);
    }
  }

  return NextResponse.json({
    ok: true,
    checked: tickers.length,
    breaches, orders,
    msg: breaches.length || orders.length
      ? `${breaches.length} alert(s), ${orders.length} order(s) executed.`
      : "No alerts tripped — all positions within range.",
  });
}
