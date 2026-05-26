import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart, daysUntilEarnings } from "@/lib/yfinance";
import { UNIVERSE } from "@/lib/universe";
import { computeSignal, computeMarketRegime, computeSmartStops, sizingMultiplier } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaBuy } from "@/lib/alpaca";

export const maxDuration = 60;

/**
 * Fully autonomous discovery + buy cycle.
 *
 * Caller: the user clicking "Run Auto-Trade Cycle" or a daily GitHub Actions cron.
 * What it does:
 *   1. Loads the user's autonomous_mode settings + current portfolio
 *   2. Bear-regime check (skip if SPY below 50-day MA)
 *   3. Scans up to 80 most-liquid universe stocks (filtered down from 540+)
 *   4. Computes the multi-factor signal for each
 *   5. Ranks BUY candidates (dropProb < 0.15) by signal strength
 *   6. Applies safety rails: max positions, max position %, cash reserve,
 *      max new buys per cycle, earnings window, not-already-held
 *   7. Sizes each buy by conviction (1.0–1.5x base) and the max_pos_pct cap
 *   8. Executes paper buys + optional Alpaca leg + fires alerts
 *
 * The existing /api/cron/check-alerts handles SELLS — this endpoint is BUY-side only.
 */
const MAX_CANDIDATES_TO_SCORE = 80;        // limit chart fetches
const STRONG_BUY_THRESHOLD = 0.15;         // dropProb must be ≤ this to consider
const MAX_NEW_BUYS_PER_CYCLE = 3;          // hard cap

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
  const pos = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty > 0`;
  const positions = pos.rows;
  const heldSet = new Set(positions.map((p: any) => p.ticker));
  const openCount = positions.length;
  const maxPositions = Number(user.max_positions) || 15;
  const maxPosPct = Number(user.max_pos_pct) || 0.08;
  const reservePct = Number(user.cash_reserve_pct) || 0.15;

  // Total equity (cash + position market value, valued at avg_cost for speed)
  let cash = Number(user.cash);
  let positionValue = 0;
  for (const p of positions) positionValue += Number(p.qty) * Number(p.avg_cost);
  const totalEquity = cash + positionValue;
  const maxDeployable = Math.max(0, totalEquity * (1 - reservePct) - positionValue);
  const cashAvailable = Math.min(cash, maxDeployable);

  if (openCount >= maxPositions) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "max_positions_reached",
      open: openCount,
      max: maxPositions,
      msg: `Already at max positions (${openCount}/${maxPositions}). No new buys.`,
    });
  }
  if (cashAvailable <= 50) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "cash_below_reserve",
      cash, cashAvailable,
      msg: `Cash reserve protected. ${cashAvailable.toFixed(0)} available for new buys.`,
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
      msg: "SPY below its 50-day MA. Pausing new buys. Existing sells still fire via cron.",
    });
  }

  // ── Build candidate list from universe ──
  // Strategy: pre-filter by quote (price >= $5, liquid volume) before fetching chart data
  // to keep total compute under 60s.
  const universe = user.auto_scan_universe
    ? UNIVERSE
    : []; // if scan disabled, this endpoint is just a no-op (only watchlist runs via existing cron)

  if (!universe.length) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "scan_disabled",
      msg: "Universe scan is off. Toggle 'Scan universe beyond watchlist' to discover new buys.",
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
      msg: "No high-conviction buys found in this cycle.",
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

  return NextResponse.json({
    ok: true,
    cycled: true,
    scanned: quotedCandidates.length,
    candidates: scored.length,
    bought: orders.filter(o => o.ok).length,
    regime,
    orders,
    safetyRails: {
      maxPositions, openBefore: openCount,
      maxPosPct, reservePct,
      maxNewBuys: MAX_NEW_BUYS_PER_CYCLE,
      threshold: STRONG_BUY_THRESHOLD,
    },
    msg: orders.length
      ? `Bought ${orders.filter(o => o.ok).length} new position(s) from ${scored.length} candidates.`
      : `${scored.length} candidates passed the bar but none fit cash/sizing rules.`,
  });
}
