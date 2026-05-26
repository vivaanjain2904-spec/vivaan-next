/**
 * Backtest: replays the ML strategy on historical daily candles.
 * Trades:
 *   - BUY  when there's no position AND signal flips strongly bullish (drop_prob ≤ 1 - threshold)
 *   - SELL when stop-loss / take-profit hit OR signal flips strongly bearish
 *
 * Returns equity curve + trade log + stats vs. buy-and-hold.
 */
import type { Candle } from "./yfinance";
import { computeSignal, computeSmartStops } from "./signal";

export type BacktestTrade = {
  date: number; side: "BUY" | "SELL"; qty: number; price: number; pnl: number; reason?: string;
};
export type BacktestPoint = { t: number; v: number };
export type BacktestResult = {
  ticker: string;
  initial: number;
  final: number;
  return_pct: number;
  bh_return_pct: number;        // buy-and-hold benchmark
  alpha_pct: number;            // strategy vs benchmark
  max_drawdown_pct: number;
  bh_max_drawdown_pct: number;
  win_rate_pct: number;
  trade_count: number;
  sharpe: number;               // annualised Sharpe ratio
  sortino: number;              // annualised Sortino (downside-only)
  calmar: number;               // annual return / max drawdown
  slippage_bps: number;         // bps applied per fill (round-trip cost)
  trades: BacktestTrade[];
  equity: BacktestPoint[];
  bh_equity: BacktestPoint[];
};

/** Slippage applied to every fill — 5 bps default (BUY 0.05% above, SELL 0.05% below). */
const SLIPPAGE_BPS = 5;

export function backtest(
  ticker: string, candles: Candle[],
  initialCash: number = 10_000, threshold: number = 0.65,
  smartStops: boolean = true,
): BacktestResult {
  if (candles.length < 60) {
    return {
      ticker, initial: initialCash, final: initialCash,
      return_pct: 0, bh_return_pct: 0, alpha_pct: 0,
      max_drawdown_pct: 0, bh_max_drawdown_pct: 0,
      win_rate_pct: 0, trade_count: 0,
      sharpe: 0, sortino: 0, calmar: 0,
      slippage_bps: SLIPPAGE_BPS,
      trades: [], equity: [], bh_equity: [],
    };
  }

  const slip = SLIPPAGE_BPS / 10000; // 5 bps → 0.0005

  let cash = initialCash;
  let shares = 0;
  let entry = 0;
  let stop = 0;
  let tgt  = 0;
  const trades: BacktestTrade[] = [];
  const equity: BacktestPoint[] = [];
  const buyThr = 1 - threshold;

  // Buy-and-hold baseline: buy as many shares as possible on day 50 (first signal day)
  const startIdx = 50;
  const bhInitialPrice = candles[startIdx].c;
  const bhShares = Math.floor(initialCash / bhInitialPrice);
  const bhCashLeft = initialCash - bhShares * bhInitialPrice;
  const bhEquity: BacktestPoint[] = [];

  for (let i = startIdx; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const signal = computeSignal(window);
    const c = candles[i];
    const price = c.c;

    // Exit logic
    if (shares > 0) {
      const stopHit = stop && price <= stop;
      const tgtHit  = tgt  && price >= tgt;
      const mlSell  = signal && signal.dropProb >= threshold;
      if (stopHit || tgtHit || mlSell) {
        const fillPrice = price * (1 - slip);    // SELL slips DOWN
        const proceeds = shares * fillPrice;
        const pnl = (fillPrice - entry) * shares;
        cash += proceeds;
        trades.push({
          date: c.t, side: "SELL", qty: shares, price: fillPrice, pnl,
          reason: stopHit ? "stop" : tgtHit ? "target" : "ml",
        });
        shares = 0; entry = 0; stop = 0; tgt = 0;
      }
    }
    // Entry logic
    else if (signal && signal.dropProb <= buyThr) {
      const fillPrice = price * (1 + slip);     // BUY slips UP
      const qty = Math.floor((cash * 0.95) / fillPrice);
      if (qty >= 1) {
        const cost = qty * fillPrice;
        cash -= cost;
        shares = qty;
        entry = fillPrice;
        const stops = smartStops ? computeSmartStops(window) : null;
        const sl = stops ? stops.stop_loss : 0.05;
        const tp = stops ? stops.take_profit : 0.10;
        stop = fillPrice * (1 - sl);
        tgt  = fillPrice * (1 + tp);
        trades.push({ date: c.t, side: "BUY", qty, price: fillPrice, pnl: 0, reason: "ml-buy" });
      }
    }

    equity.push({ t: c.t, v: cash + shares * price });
    bhEquity.push({ t: c.t, v: bhCashLeft + bhShares * price });
  }

  // Close any open position at end (slip on the way out)
  if (shares > 0) {
    const last = candles[candles.length - 1];
    const fillPrice = last.c * (1 - slip);
    const proceeds = shares * fillPrice;
    cash += proceeds;
    trades.push({
      date: last.t, side: "SELL", qty: shares, price: fillPrice,
      pnl: (fillPrice - entry) * shares, reason: "end-of-period",
    });
    shares = 0;
  }

  // ── Stats ──
  const ret  = ((cash - initialCash) / initialCash) * 100;
  const lastPrice = candles[candles.length - 1].c;
  const bhFinal = bhCashLeft + bhShares * lastPrice;
  const bhRet   = ((bhFinal - initialCash) / initialCash) * 100;

  const maxDD   = computeMaxDrawdown(equity);
  const bhMaxDD = computeMaxDrawdown(bhEquity);

  const sells = trades.filter(t => t.side === "SELL");
  const wins  = sells.filter(t => t.pnl > 0).length;
  const winRate = sells.length ? (wins / sells.length) * 100 : 0;

  // Risk-adjusted ratios from daily equity returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].v, cur = equity[i].v;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const sharpe  = annualisedSharpe(dailyReturns);
  const sortino = annualisedSortino(dailyReturns);
  const yearsHeld = Math.max(0.01, (equity.length || 1) / 252);
  const cagrPct = (Math.pow(1 + ret / 100, 1 / yearsHeld) - 1) * 100;
  const calmar = maxDD > 0 ? cagrPct / maxDD : 0;

  return {
    ticker,
    initial: initialCash, final: cash,
    return_pct: ret, bh_return_pct: bhRet, alpha_pct: ret - bhRet,
    max_drawdown_pct: maxDD, bh_max_drawdown_pct: bhMaxDD,
    win_rate_pct: winRate, trade_count: trades.length,
    sharpe, sortino, calmar,
    slippage_bps: SLIPPAGE_BPS,
    trades, equity, bh_equity: bhEquity,
  };
}

function computeMaxDrawdown(curve: BacktestPoint[]): number {
  let peak = curve[0]?.v ?? 0, maxDD = 0;
  for (const p of curve) {
    if (p.v > peak) peak = p.v;
    if (peak > 0) {
      const dd = ((peak - p.v) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

function annualisedSharpe(daily: number[]): number {
  if (daily.length < 5) return 0;
  const m = daily.reduce((a, b) => a + b, 0) / daily.length;
  const variance = daily.reduce((a, b) => a + (b - m) ** 2, 0) / daily.length;
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return (m / sd) * Math.sqrt(252);
}

function annualisedSortino(daily: number[]): number {
  if (daily.length < 5) return 0;
  const m = daily.reduce((a, b) => a + b, 0) / daily.length;
  const downside = daily.filter(r => r < 0);
  if (!downside.length) return 0;
  const downVar = downside.reduce((a, b) => a + b * b, 0) / downside.length;
  const downSd = Math.sqrt(downVar);
  if (downSd <= 0) return 0;
  return (m / downSd) * Math.sqrt(252);
}
