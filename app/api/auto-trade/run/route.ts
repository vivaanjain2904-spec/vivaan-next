import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart, daysUntilEarnings } from "@/lib/yfinance";
import { UNIVERSE } from "@/lib/universe";
import { computeSignal, computeMarketRegime, computeSmartStops, computeTrailingStop, sizingMultiplier } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaBuy, alpacaSell } from "@/lib/alpaca";

export const maxDuration = 60;

/**
 * Fully autonomous buy + sell cycle, end-to-end.
 *
 * Caller: "Run Auto-Trade Cycle" button on Overview.
 * One click does the lot:
 *   A. SELL pass — for every held position:
 *        * Compute fresh signal
 *        * If stop-loss / take-profit / ML threshold trips → sell + alert
 *        * If pos has run >10%, ratchet trailing stop tighter
 *   B. BUY pass — scan ~80 most-promising stocks from the 540+ universe:
 *        * Filter by liquidity (price ≥ $5, vol ≥ 200k)
 *        * Pre-rank by recent weakness
 *        * Multi-factor signal on top 80
 *        * Buy top 3 with conviction-based sizing + safety rails
 *   C. Return combined summary of all actions taken.
 *
 * The 15-min alert cron still runs sells continuously in the background —
 * this button is for triggering the WHOLE cycle on demand, not just buys.
 */
const MAX_CANDIDATES_TO_SCORE = 80;
const STRONG_BUY_THRESHOLD = 0.20;         // loosened from 0.15 so more buys actually fire
const MAX_NEW_BUYS_PER_CYCLE = 3;

export async function POST() {
  const s = await requireSession();
  await initDb().catch(() => {});

  const ur = await sql`SELECT id, name, cash, autonomous_mode, auto_scan_universe,
    max_positions, max_pos_pct, cash_reserve_pct, auto_buy_size, ml_threshold,
    alpaca_key, alpaca_secret, auto_trade, ntfy_topic, discord_webhook, email
    FROM users WHERE id=${s.uid}`;
  const user = ur.rows[0];
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  if (!user.autonomous_mode) {
    return NextResponse.json({
      ok: false,
      skipped: "autonomous_mode_off",
      msg: "Enable Fully Autonomous Mode in Settings to run.",
    });
  }

  // Current portfolio for safety rails
  const pos = await sql`SELECT ticker, qty, avg_cost, stop_loss, take_profit FROM positions WHERE user_id=${user.id} AND qty > 0`;
  let positions: any[] = pos.rows;
  let heldSet = new Set(positions.map((p: any) => p.ticker));
  const maxPositions = Number(user.max_positions) || 15;
  const maxPosPct = Number(user.max_pos_pct) || 0.08;
  const reservePct = Number(user.cash_reserve_pct) || 0.15;
  const mlThreshold = Number(user.ml_threshold) || 0.65;

  // ═══════════════════════════════════════════════════════════════════════
  //  PASS A — SELL: check every held position for stop/target/ML triggers
  // ═══════════════════════════════════════════════════════════════════════
  const sellOrders: any[] = [];
  let cashChange = 0;

  if (positions.length > 0) {
    const tickers = positions.map((p: any) => p.ticker);
    const heldQuotes = await getQuotes(tickers);

    for (const p of positions) {
      const q = heldQuotes[p.ticker];
      if (!q?.price) continue;
      const px = q.price;
      const avg = Number(p.avg_cost);
      if (!avg) continue;

      const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
      const tp = p.take_profit != null ? Number(p.take_profit) : null;
      const stopHit = sl != null && px <= avg * (1 - sl);
      const tgtHit  = tp != null && px >= avg * (1 + tp);

      // Quick ML check via chart
      let mlHit = false;
      let signal: any = null;
      try {
        const candles = await getChart(p.ticker, "3mo");
        signal = computeSignal(candles);
        if (signal && signal.dropProb >= mlThreshold) mlHit = true;
      } catch {}

      if (stopHit || tgtHit || mlHit) {
        const reason = stopHit ? "stop-loss" : tgtHit ? "take-profit" : "ml-signal";
        const qty = Number(p.qty);
        const proceeds = qty * px;

        // Alpaca leg
        let alpacaOrderId: string | undefined;
        if (user.alpaca_key && user.alpaca_secret) {
          const r = await alpacaSell({ key: user.alpaca_key, secret: user.alpaca_secret }, p.ticker, qty);
          if (r.ok) alpacaOrderId = r.orderId;
        }

        // Mirror paper
        try {
          await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${p.ticker}`;
          await sql`UPDATE users SET cash = cash + ${proceeds} WHERE id=${user.id}`;
          await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
            VALUES (${user.id}, ${p.ticker}, 'SELL', ${qty}, ${px})`;
          cashChange += proceeds;
        } catch {}

        sellOrders.push({ ticker: p.ticker, qty, price: px, reason,
                          mode: alpacaOrderId ? "alpaca" : "paper", orderId: alpacaOrderId });

        const title = stopHit ? `🔴 Auto-sold ${p.ticker} (stop)` :
                      tgtHit ? `🟢 Auto-sold ${p.ticker} (target)` :
                               `⚠️ Auto-sold ${p.ticker} (ML)`;
        const body = `${qty} shares @ $${px.toFixed(2)} · ${reason}` +
          (alpacaOrderId ? ` · Alpaca order ${alpacaOrderId}` : " · paper");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'auto_sell', ${title}, ${body})`;
        await alertUser(user as any, title, body);
      } else if (signal) {
        // No sell — check trailing stop ratchet
        const pnlFrac = (px - avg) / avg;
        const curSL = p.stop_loss != null ? Number(p.stop_loss) : 0.05;
        const newSL = computeTrailingStop(curSL, pnlFrac);
        if (newSL < curSL - 1e-9) {
          await sql`UPDATE positions SET stop_loss=${newSL}
            WHERE user_id=${user.id} AND ticker=${p.ticker}`;
        }
      }
    }

    // Refresh positions list after sells
    if (sellOrders.length > 0) {
      const refreshed = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty > 0`;
      positions = refreshed.rows;
      heldSet = new Set(positions.map((p: any) => p.ticker));
    }
  }

  // Total equity (cash + position market value, valued at avg_cost for speed)
  let cash = Number(user.cash) + cashChange;
  let positionValue = 0;
  for (const p of positions) positionValue += Number(p.qty) * Number(p.avg_cost);
  const totalEquity = cash + positionValue;
  const maxDeployable = Math.max(0, totalEquity * (1 - reservePct) - positionValue);
  const cashAvailable = Math.min(cash, maxDeployable);
  const openCount = positions.length;

  if (openCount >= maxPositions) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "max_positions_reached",
      open: openCount,
      max: maxPositions,
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Already at max positions (${openCount}/${maxPositions}). No new buys.`,
    });
  }
  if (cashAvailable <= 50) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "cash_below_reserve",
      cash, cashAvailable, sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Cash reserve protected.`,
    });
  }

  // ── Market regime: skip new buys in a bear tape ──
  let regime: "bull" | "bear" | "neutral" = "neutral";
  try {
    const spy = await getChart("SPY", "6mo");
    regime = computeMarketRegime(spy);
  } catch {}
  if (regime === "bear") {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "bear_regime",
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. SPY in bear regime — pausing new buys.`,
    });
  }

  // ── Build candidate list from universe ──
  const universe = user.auto_scan_universe ? UNIVERSE : [];

  if (!universe.length) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "scan_disabled",
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Universe scan is off — toggle it on in Settings.`,
    });
  }

  // Filter to what we don't already hold
  const candidates = universe.filter(t => !heldSet.has(t));

  // Pull quotes in one big batch (existing helper handles batching)
  const quoteMap = await getQuotes(candidates);
  const quotedCandidates = candidates
    .map(t => ({ ticker: t, q: quoteMap[t] }))
    .filter(c => c.q && c.q.price >= 5 && (c.q.vol ?? 0) >= 200_000)  // liquidity floor
    // Pre-rank by recent weakness — strong buys are usually stocks that dipped
    .sort((a, b) => (a.q.pct ?? 0) - (b.q.pct ?? 0))
    .slice(0, MAX_CANDIDATES_TO_SCORE);

  // ── Score each candidate (full chart fetch + signal) ──
  type Scored = {
    ticker: string; price: number; dropProb: number;
    smart?: { stop_loss: number; take_profit: number };
    daysToER: number | null;
  };
  const scored: Scored[] = [];

  // Fetch charts in parallel chunks of 12 (Yahoo polite usage)
  const CHUNK = 12;
  for (let i = 0; i < quotedCandidates.length; i += CHUNK) {
    const chunk = quotedCandidates.slice(i, i + CHUNK);
    const enriched = await Promise.all(chunk.map(async c => {
      const candles = await getChart(c.ticker, "3mo").catch(() => []);
      if (!candles.length) return null;
      const sig = computeSignal(candles);
      if (!sig || sig.dropProb > STRONG_BUY_THRESHOLD) return null;
      const smart = computeSmartStops(candles) ?? undefined;
      const daysToER = await daysUntilEarnings(c.ticker);
      if (daysToER != null && daysToER >= 0 && daysToER <= 3) return null; // earnings filter
      return {
        ticker: c.ticker, price: c.q.price, dropProb: sig.dropProb,
        smart, daysToER,
      } as Scored;
    }));
    for (const e of enriched) if (e) scored.push(e);
  }

  if (!scored.length) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      scanned: quotedCandidates.length,
      candidates: 0,
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. No high-conviction buys found in this cycle.`,
    });
  }

  // ── Rank by strongest signal (lowest dropProb) and buy top N ──
  scored.sort((a, b) => a.dropProb - b.dropProb);
  const slotsAvailable = Math.max(0, maxPositions - openCount);
  const buyTarget = Math.min(slotsAvailable, MAX_NEW_BUYS_PER_CYCLE, scored.length);

  const orders: any[] = [];
  let remainingCash = cashAvailable;

  for (let i = 0; i < buyTarget; i++) {
    const pick = scored[i];
    if (remainingCash < pick.price * 1.01) break;

    // Position size: conviction-multiplied base, capped by max_pos_pct of total equity
    const baseBudget = (Number(user.auto_buy_size) || 500) * sizingMultiplier(pick.dropProb);
    const maxBudgetForCap = totalEquity * maxPosPct;
    const targetBudget = Math.min(baseBudget, maxBudgetForCap, remainingCash);
    const qty = Math.floor(targetBudget / pick.price);
    if (qty < 1) continue;
    const cost = qty * pick.price;
    if (cost > remainingCash) continue;

    // Stops/targets: smart ATR-based when available, fallback to 5% / 10%
    const sl = pick.smart?.stop_loss ?? 0.05;
    const tp = pick.smart?.take_profit ?? 0.10;

    // Optional Alpaca leg
    let alpacaOrderId: string | undefined, alpacaErr: string | undefined;
    if (user.alpaca_key && user.alpaca_secret) {
      const r = await alpacaBuy(
        { key: user.alpaca_key, secret: user.alpaca_secret }, pick.ticker, qty);
      if (r.ok) alpacaOrderId = r.orderId; else alpacaErr = r.error;
    }

    try {
      await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
        VALUES (${user.id}, ${pick.ticker}, ${qty}, ${pick.price}, ${sl}, ${tp})
        ON CONFLICT (user_id, ticker) DO NOTHING`;
      await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
        VALUES (${user.id}, ${pick.ticker}, 'BUY', ${qty}, ${pick.price})`;
      remainingCash -= cost;
    } catch (e: any) {
      orders.push({ ticker: pick.ticker, ok: false, error: e?.message ?? "DB error" });
      continue;
    }

    orders.push({
      ticker: pick.ticker, ok: true, qty, price: pick.price,
      cost, dropProb: pick.dropProb,
      mode: alpacaOrderId ? "alpaca" : (alpacaErr ? "paper-only" : "paper"),
      orderId: alpacaOrderId,
    });

    const title = `🤖 Auto-discovered ${qty} ${pick.ticker}`;
    const body = `Signal ${(pick.dropProb * 100).toFixed(0)}% drop-prob (strong buy).` +
      ` Cost $${cost.toFixed(2)}. Smart stops: −${(sl * 100).toFixed(1)}% / +${(tp * 100).toFixed(1)}%.` +
      (alpacaOrderId ? ` Alpaca order ${alpacaOrderId}.` : " (paper-only).");
    await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
      VALUES (${user.id}, ${pick.ticker}, 'auto_discover', ${title}, ${body})`;
    await alertUser(user as any, title, body);
  }

  const boughtCount = orders.filter(o => o.ok).length;
  return NextResponse.json({
    ok: true,
    cycled: true,
    scanned: quotedCandidates.length,
    candidates: scored.length,
    bought: boughtCount,
    sold: sellOrders.length,
    regime,
    orders,
    sells: sellOrders,
    safetyRails: {
      maxPositions, openBefore: openCount,
      maxPosPct, reservePct,
      maxNewBuys: MAX_NEW_BUYS_PER_CYCLE,
      threshold: STRONG_BUY_THRESHOLD,
    },
    msg: [
      sellOrders.length > 0 ? `Sold ${sellOrders.length}` : null,
      boughtCount > 0 ? `Bought ${boughtCount}` : (scored.length ? `${scored.length} candidates didn't fit sizing rules` : null),
    ].filter(Boolean).join(" · ") || "No actions this cycle.",
  });
}
