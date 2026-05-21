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
  win_rate_pct: number;
  trade_count: number;
  trades: BacktestTrade[];
  equity: BacktestPoint[];
  bh_equity: BacktestPoint[];
};

export function backtest(
  ticker: string, candles: Candle[],
  initialCash: number = 10_000, threshold: number = 0.65,
  smartStops: boolean = true,
): BacktestResult {
  if (candles.length < 60) {
    return {
      ticker, initial: initialCash, final: initialCash,
      return_pct: 0, bh_return_pct: 0, alpha_pct: 0, max_drawdown_pct: 0,
      win_rate_pct: 0, trade_count: 0, trades: [], equity: [], bh_equity: [],
    };
  }

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
        const proceeds = shares * price;
        const pnl = (price - entry) * shares;
        cash += proceeds;
        trades.push({
          date: c.t, side: "SELL", qty: shares, price, pnl,
          reason: stopHit ? "stop" : tgtHit ? "target" : "ml",
        });
        shares = 0; entry = 0; stop = 0; tgt = 0;
      }
    }
    // Entry logic
    else if (signal && signal.dropProb <= buyThr) {
      const qty = Math.floor((cash * 0.95) / price);
      if (qty >= 1) {
        const cost = qty * price;
        cash -= cost;
        shares = qty;
        entry = price;
        const stops = smartStops ? computeSmartStops(window) : null;
        const sl = stops ? stops.stop_loss : 0.05;
        const tp = stops ? stops.take_profit : 0.10;
        stop = price * (1 - sl);
        tgt  = price * (1 + tp);
        trades.push({ date: c.t, side: "BUY", qty, price, pnl: 0, reason: "ml-buy" });
      }
    }

    equity.push({ t: c.t, v: cash + shares * price });
    bhEquity.push({ t: c.t, v: bhCashLeft + bhShares * price });
  }

  // Close any open position at end
  if (shares > 0) {
    const last = candles[candles.length - 1];
    const proceeds = shares * last.c;
    cash += proceeds;
    trades.push({
      date: last.t, side: "SELL", qty: shares, price: last.c,
      pnl: (last.c - entry) * shares, reason: "end-of-period",
    });
    shares = 0;
  }

  // Stats
  const ret  = ((cash - initialCash) / initialCash) * 100;
  const lastPrice = candles[candles.length - 1].c;
  const bhFinal = bhCashLeft + bhShares * lastPrice;
  const bhRet   = ((bhFinal - initialCash) / initialCash) * 100;

  let peak = initialCash, maxDD = 0;
  for (const p of equity) {
    if (p.v > peak) peak = p.v;
    const dd = ((peak - p.v) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const sells = trades.filter(t => t.side === "SELL");
  const wins  = sells.filter(t => t.pnl > 0).length;
  const winRate = sells.length ? (wins / sells.length) * 100 : 0;

  return {
    ticker,
    initial: initialCash, final: cash,
    return_pct: ret, bh_return_pct: bhRet, alpha_pct: ret - bhRet,
    max_drawdown_pct: maxDD, win_rate_pct: winRate,
    trade_count: trades.length, trades,
    equity, bh_equity: bhEquity,
  };
}
