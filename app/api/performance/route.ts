import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart } from "@/lib/yfinance";

export const maxDuration = 30;

const DEFAULT_STARTING_CASH = 100000;

/**
 * GET /api/performance
 * Returns the full performance picture for the current user:
 *   - Total/realized/unrealized P&L
 *   - Win rate, avg win/loss, profit factor (closed round-trips, FIFO-matched)
 *   - Per-position contribution
 *   - Best/worst closed trades
 *   - SPY benchmark return over the same period
 *   - Equity curve (replayed from trade history)
 */
export async function GET() {
  const s = await requireSession();

  const [userR, posR, tradeR] = await Promise.all([
    sql`SELECT cash FROM users WHERE id=${s.uid}`,
    sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${s.uid} AND qty > 0`,
    sql`SELECT ticker, side, qty, price, ts FROM trades WHERE user_id=${s.uid} ORDER BY ts ASC`,
  ]);

  const cash = Number(userR.rows[0]?.cash ?? 0);
  const trades = tradeR.rows;

  // ── FIFO match BUYs and SELLs to compute closed round-trip P&L ──
  type Closed = {
    ticker: string; qty: number;
    buyPrice: number; sellPrice: number;
    pnl: number; pct: number;
    buyTs: string; sellTs: string;
    holdDays: number;
  };
  const closed: Closed[] = [];
  const queue: Record<string, { qty: number; price: number; ts: string }[]> = {};

  for (const t of trades) {
    const qty = Number(t.qty), price = Number(t.price);
    if (t.side === "BUY") {
      (queue[t.ticker] ??= []).push({ qty, price, ts: t.ts });
    } else {
      let remaining = qty;
      const q = queue[t.ticker] ?? [];
      while (remaining > 0 && q.length) {
        const lot = q[0];
        const m = Math.min(remaining, lot.qty);
        const pnl = (price - lot.price) * m;
        const pct = lot.price > 0 ? ((price - lot.price) / lot.price) * 100 : 0;
        const holdDays = Math.max(1, Math.floor(
          (new Date(t.ts).getTime() - new Date(lot.ts).getTime()) / 86400_000));
        closed.push({
          ticker: t.ticker, qty: m,
          buyPrice: lot.price, sellPrice: price,
          pnl, pct,
          buyTs: lot.ts, sellTs: t.ts,
          holdDays,
        });
        lot.qty -= m;
        remaining -= m;
        if (lot.qty <= 0) q.shift();
      }
    }
  }

  const realizedPnL = closed.reduce((s, c) => s + c.pnl, 0);
  const wins   = closed.filter(c => c.pnl > 0);
  const losses = closed.filter(c => c.pnl <= 0);
  const winRate     = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin      = wins.length   ? wins.reduce((s, c) => s + c.pnl, 0) / wins.length     : 0;
  const avgLoss     = losses.length ? Math.abs(losses.reduce((s, c) => s + c.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : (wins.length ? Infinity : 0);
  const avgHoldDays  = closed.length ? closed.reduce((s, c) => s + c.holdDays, 0) / closed.length : 0;

  // ── Live quotes for open positions ──
  const tickers = posR.rows.map(p => p.ticker);
  const quotes = tickers.length ? await getQuotes(tickers) : {};
  let unrealizedPnL = 0, totalValue = 0, totalCost = 0;
  const positionsOut = posR.rows.map(p => {
    const q = quotes[p.ticker];
    const price = q?.price ?? 0;
    const qty   = Number(p.qty);
    const avg   = Number(p.avg_cost);
    const value = price * qty;
    const cost  = avg * qty;
    const pnl   = value - cost;
    unrealizedPnL += pnl;
    totalValue    += value;
    totalCost     += cost;
    return { ticker: p.ticker, qty, avg_cost: avg, price, value, cost, pnl,
             pct: cost > 0 ? (pnl / cost) * 100 : 0 };
  }).sort((a, b) => b.pnl - a.pnl);

  // ── Total return vs starting cash ──
  const currentEquity = cash + totalValue;
  const totalReturn   = ((currentEquity - DEFAULT_STARTING_CASH) / DEFAULT_STARTING_CASH) * 100;
  const totalPnL      = currentEquity - DEFAULT_STARTING_CASH;

  // ── SPY benchmark over same window (first trade → now) ──
  let spyReturn: number | null = null;
  if (trades.length > 0) {
    try {
      // Pull enough history to cover the window
      const earliest = new Date(trades[0].ts).getTime();
      const daysAgo = Math.floor((Date.now() - earliest) / 86400_000);
      const range = daysAgo > 365 ? "2y" : daysAgo > 90 ? "1y" : daysAgo > 30 ? "6mo" : "3mo";
      const spy = await getChart("SPY", range);
      if (spy.length >= 2) {
        // Find first SPY candle on or after the earliest trade
        const startIdx = spy.findIndex(c => c.t * 1000 >= earliest);
        const start = spy[Math.max(0, startIdx)]?.c ?? spy[0].c;
        const end   = spy[spy.length - 1].c;
        if (start > 0) spyReturn = ((end - start) / start) * 100;
      }
    } catch {}
  }

  // ── Equity curve: replay trades chronologically against the current price,
  //    using the closing price at each trade date as a proxy for value-on-the-day ──
  // Simplified: just snapshot equity at each trade tick (cost-basis equity).
  // This isn't mark-to-market intraday but it's accurate at trade time.
  type CurvePoint = { t: number; equity: number };
  const curve: CurvePoint[] = [];
  let runCash = DEFAULT_STARTING_CASH;
  const runPos: Record<string, { qty: number; avg: number }> = {};
  for (const t of trades) {
    const qty = Number(t.qty), price = Number(t.price);
    if (t.side === "BUY") {
      runCash -= qty * price;
      const cur = runPos[t.ticker] ?? { qty: 0, avg: 0 };
      const newQty = cur.qty + qty;
      runPos[t.ticker] = { qty: newQty, avg: (cur.qty * cur.avg + qty * price) / newQty };
    } else {
      runCash += qty * price;
      const cur = runPos[t.ticker];
      if (cur) cur.qty -= qty;
    }
    // Mark-to-cost equity (positions valued at avg cost, snapshotted at this moment)
    let posValue = 0;
    for (const tk in runPos) posValue += runPos[tk].qty * runPos[tk].avg;
    curve.push({ t: new Date(t.ts).getTime(), equity: runCash + posValue });
  }
  // Cap point at current real equity
  curve.push({ t: Date.now(), equity: currentEquity });

  // Best/worst closed trades
  const bestTrades  = [...closed].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const worstTrades = [...closed].sort((a, b) => a.pnl - b.pnl).slice(0, 5);

  return NextResponse.json({
    startingCash: DEFAULT_STARTING_CASH,
    cash,
    totalValue,
    totalCost,
    currentEquity,
    totalPnL,
    totalReturn,
    realizedPnL,
    unrealizedPnL,
    spyReturn,
    alpha: spyReturn != null ? totalReturn - spyReturn : null, // simple, not risk-adjusted
    winRate, avgWin, avgLoss, profitFactor, avgHoldDays,
    totalTrades: trades.length,
    closedRoundTrips: closed.length,
    openPositions: posR.rows.length,
    positions: positionsOut,
    bestTrades,
    worstTrades,
    equityCurve: curve,
  });
}
