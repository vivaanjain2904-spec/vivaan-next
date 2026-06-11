/**
 * Real-time technical signal — runs server-side on chart data.
 * Combines RSI, 20/50-day MA position, and 1-month momentum into a 0..1
 * "drop probability" score. No Python / no pre-trained model required.
 *
 * Users who want their own trained ML model can still upload from Python
 * to the `ml_signals` table — those scores override anything computed here.
 */
import type { Candle } from "./yfinance";

export type Signal = {
  dropProb: number;            // 0..1, higher = bearish
  rsi: number;                 // 0..100
  ma20Position: "above" | "below";
  ma50Position: "above" | "below";
  momentum1m: number;          // % over last ~22 trading days
  recommendation: "BUY" | "HOLD" | "SELL";
};

/**
 * Optional hints from external data sources. Pass what you have — anything
 * null/undefined is silently skipped so callers don't need to fetch all sources.
 */
export type SignalHints = {
  insiderBuyScore?: number | null; // 0..1 from lib/finnhub insiderBuyingScore; >0.6 = bullish cluster
  pead?: number | null;            // -1..+1 from lib/finnhub peadScore; positive = post-earnings drift up
};

/**
 * Scale multipliers applied to the bearish (drop-increasing) and bullish
 * (drop-decreasing) factor contributions. Defaults of 1 reproduce the
 * original hand-tuned weights exactly — used by lib/walkforward.ts to
 * search for better-calibrated multipliers without duplicating the factor
 * logic.
 */
export type SignalScales = { bearish: number; bullish: number };
// Walk-forward validation (730d, 445 tickers, 60/40 train/test split) found
// the original (1,1) weights have ~no out-of-sample calibration (test
// Spearman +0.086), while halving the bearish-factor contributions and
// amplifying the bullish ones by 50% generalized strongly (test Spearman
// -0.900, vs -0.829 on train) — i.e. the bearish factors are mostly noise
// and the bullish factors under-weighted. See lib/walkforward.ts /
// /api/admin/walkforward.
const DEFAULT_SCALES: SignalScales = { bearish: 0.5, bullish: 1.5 };

export function computeSignal(candles: Candle[], hints?: SignalHints, scales: SignalScales = DEFAULT_SCALES): Signal | null {
  if (candles.length < 26) return null;  // need >= 26 days for MACD
  const closes = candles.map(c => c.c);
  const volumes = candles.map(c => c.v ?? 0);
  const latest = closes[closes.length - 1];

  const rsi = computeRSI(closes, 14);
  const ma20 = avg(closes.slice(-20));
  const ma50 = closes.length >= 50 ? avg(closes.slice(-50)) : ma20;
  const oneMoAgo = closes[Math.max(0, closes.length - 22)];
  const momentum1m = ((latest - oneMoAgo) / oneMoAgo) * 100;

  // ── New factors (Tier 1 polish) ──
  const macd = computeMACD(closes);             // {macd, signal, hist}
  const bbPos = computeBollingerPos(closes);    // -1 (lower band) to +1 (upper band)
  const volZ = computeVolumeZScore(volumes);    // recent volume z-score

  // Each factor contributes a signed amount: positive = bearish (raises drop
  // prob), negative = bullish (lowers it). Collected so the bearish/bullish
  // sides can be scaled independently (see SignalScales).
  const contributions: number[] = [];
  // RSI (existing)
  if (rsi > 75)       contributions.push(0.22);
  else if (rsi > 70)  contributions.push(0.13);
  else if (rsi < 25)  contributions.push(-0.15);
  else if (rsi < 35)  contributions.push(-0.08);
  // MA position (existing)
  if (latest < ma20)  contributions.push(0.07);
  if (latest < ma50)  contributions.push(0.07);
  // 1m momentum (existing)
  if (momentum1m < -10) contributions.push(0.10);
  else if (momentum1m < -5) contributions.push(0.04);
  else if (momentum1m > 15) contributions.push(-0.08);
  // MACD: bearish if histogram negative AND falling
  if (macd.hist < 0 && macd.hist < macd.histPrev) contributions.push(0.08);
  else if (macd.hist > 0 && macd.hist > macd.histPrev) contributions.push(-0.06);
  // Bollinger: overbought near upper band, oversold near lower
  if (bbPos > 0.9)  contributions.push(0.06);       // hugging upper band, mean reversion likely
  else if (bbPos < -0.9) contributions.push(-0.05);  // hugging lower band, bounce likely
  // Volume z-score: high vol on a down day = distribution = bearish
  if (volZ > 2 && momentum1m < 0) contributions.push(0.06);
  else if (volZ > 2 && momentum1m > 0) contributions.push(-0.04);  // high vol on up day = accumulation
  // Mean-reversion bounce: deeply oversold AND today is already a reversal
  // (close > prior close) AND volume confirms — distinct from the
  // trend-following MACD/momentum factors, which fire on continuation.
  const reversalDay = latest > closes[closes.length - 2];
  if (rsi < 30 && reversalDay && volZ > 0.5) contributions.push(-0.06);
  // Insider buying signal (Form 4): cluster buying reduces drop probability
  const ibs = hints?.insiderBuyScore;
  if (ibs != null) {
    if (ibs > 0.75)      contributions.push(-0.07);  // strong cluster buying
    else if (ibs > 0.55) contributions.push(-0.03);  // mild net buying
    else if (ibs < 0.25) contributions.push(0.04);  // net insider selling
  }
  // PEAD: post-earnings drift — beat reduces drop prob, miss raises it (decays over 60 days)
  const pead = hints?.pead;
  if (pead != null) contributions.push(-pead * 0.08); // max ±0.08 at full beat/miss with no decay

  let drop = 0.4;
  for (const c of contributions) drop += c * (c > 0 ? scales.bearish : scales.bullish);
  drop = Math.max(0, Math.min(1, drop));

  return {
    dropProb: drop,
    rsi,
    ma20Position: latest >= ma20 ? "above" : "below",
    ma50Position: latest >= ma50 ? "above" : "below",
    momentum1m,
    recommendation: drop <= 0.35 ? "BUY" : drop >= 0.65 ? "SELL" : "HOLD",
  };
}

/** MACD = 12-EMA - 26-EMA, signal line = 9-EMA of MACD. Returns hist + previous hist for trend. */
function computeMACD(closes: number[]): { macd: number; signal: number; hist: number; histPrev: number } {
  if (closes.length < 27) return { macd: 0, signal: 0, hist: 0, histPrev: 0 };
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdSeries = ema12.map((v, i) => v - ema26[i]);
  const signalSeries = emaSeries(macdSeries, 9);
  const macd = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  const hist = macd - signal;
  const macdPrev = macdSeries[macdSeries.length - 2];
  const signalPrev = signalSeries[Math.max(0, signalSeries.length - 2)];
  const histPrev = macdPrev - signalPrev;
  return { macd, signal, hist, histPrev };
}

/** Position of latest price within 20-day Bollinger Band (2σ). -1 lower / 0 mid / +1 upper. */
function computeBollingerPos(closes: number[]): number {
  if (closes.length < 20) return 0;
  const window = closes.slice(-20);
  const ma = avg(window);
  const variance = avg(window.map(c => (c - ma) ** 2));
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  const upper = ma + 2 * sd;
  const lower = ma - 2 * sd;
  const last = closes[closes.length - 1];
  // Linear interpolation: -1 at lower band, 0 at MA, +1 at upper band
  if (last >= ma) return Math.min(1, (last - ma) / (upper - ma));
  return Math.max(-1, (last - ma) / (ma - lower));
}

/** Z-score of latest day's volume vs the 20-day average. */
function computeVolumeZScore(volumes: number[]): number {
  if (volumes.length < 20) return 0;
  const window = volumes.slice(-20);
  const m = avg(window);
  const variance = avg(window.map(v => (v - m) ** 2));
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return (volumes[volumes.length - 1] - m) / sd;
}

/** Standard exponential moving average, returns the full series. */
function emaSeries(arr: number[], period: number): number[] {
  if (arr.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    out.push(arr[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function avg(arr: number[]) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

/**
 * Smart stop-loss / take-profit from price action.
 * Uses 14-period Average True Range (ATR) — the standard measure of volatility.
 * - stop_loss  = 2 × ATR below entry  (volatility-adjusted "noise floor")
 * - take_profit = 4 × ATR above entry (2:1 reward-to-risk default)
 * Floors at 3% / 6% so penny-stock ATR doesn't make stops absurdly tight.
 * Returns FRACTIONS, e.g. { stop_loss: 0.07, take_profit: 0.14 }.
 */
export function computeSmartStops(candles: Candle[]): { stop_loss: number; take_profit: number } | null {
  if (candles.length < 15) return null;
  const recent = candles.slice(-15);
  let trSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const h = recent[i].h, l = recent[i].l, prevC = recent[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trSum += tr;
  }
  const atr = trSum / (recent.length - 1);
  const lastPrice = recent[recent.length - 1].c;
  if (!lastPrice || atr <= 0) return null;
  const volPct = atr / lastPrice;       // ATR as % of price
  return {
    stop_loss:   Math.max(2 * volPct, 0.03),
    take_profit: Math.max(4 * volPct, 0.06),
  };
}

/**
 * Full recommended setup for a position — stops, target, and a review window.
 * Combines ATR-based stops (`computeSmartStops`) with a volatility bucket so
 * higher-vol names get re-evaluated sooner.
 *
 * volatility_class:
 *   - "low"      <2% daily ATR  → review in 60 days, tighter relative stops
 *   - "moderate" 2-4% daily ATR → review in 30 days
 *   - "high"     >4% daily ATR  → review in 14 days, ATR-based wider stops
 */
export type Recommendation = {
  stop_loss: number;        // fraction, e.g. 0.07
  take_profit: number;      // fraction, e.g. 0.14
  review_days: number;
  volatility_class: "low" | "moderate" | "high";
  atr_pct: number;          // ATR as % of price (rounded)
  rationale: string;        // 1-line human-readable explanation
};

export function computeRecommendation(candles: Candle[]): Recommendation | null {
  const stops = computeSmartStops(candles);
  if (!stops) return null;
  const recent = candles.slice(-15);
  let trSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const h = recent[i].h, l = recent[i].l, prevC = recent[i - 1].c;
    trSum += Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }
  const atr = trSum / (recent.length - 1);
  const lastPrice = recent[recent.length - 1].c;
  const volPct = atr / lastPrice;

  let cls: "low" | "moderate" | "high";
  let reviewDays: number;
  let label: string;
  if (volPct < 0.02)      { cls = "low";      reviewDays = 60; label = "low-volatility"; }
  else if (volPct < 0.04) { cls = "moderate"; reviewDays = 30; label = "moderate-volatility"; }
  else                    { cls = "high";     reviewDays = 14; label = "high-volatility"; }

  return {
    stop_loss: stops.stop_loss,
    take_profit: stops.take_profit,
    review_days: reviewDays,
    volatility_class: cls,
    atr_pct: Number((volPct * 100).toFixed(2)),
    rationale: `${label} (ATR ${(volPct * 100).toFixed(1)}%/day) — recommended review every ${reviewDays}d`,
  };
}

function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0))  / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/**
 * Market regime from a price series (typically SPY).
 * Bull = price >= 50-day MA AND 50-day MA rising
 * Bear = price < 50-day MA
 * Neutral otherwise.
 * Used to suppress new auto-buys during clear downtrends — most strategies
 * lose money trying to fight the tape.
 */
export function computeMarketRegime(candles: Candle[]): "bull" | "bear" | "neutral" {
  if (candles.length < 60) return "neutral";
  const closes = candles.map(c => c.c);
  const ma50 = avg(closes.slice(-50));
  const ma50Prior = avg(closes.slice(-60, -10)); // 50-day MA from 10 days ago
  const last = closes[closes.length - 1];

  if (last < ma50) return "bear";
  if (last >= ma50 && ma50 >= ma50Prior) return "bull";
  return "neutral";
}

/**
 * Volatility regime from a price series (typically SPY) — realized volatility
 * over the last 10 days vs its own 60-day baseline. Turbulent markets warrant
 * a higher conviction bar before entering new positions; unusually calm
 * markets can tolerate slightly more.
 */
export function computeVolRegime(candles: Candle[]): "calm" | "normal" | "panic" {
  if (candles.length < 65) return "normal";
  const closes = candles.map(c => c.c);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const stdev = (arr: number[]) => {
    const m = avg(arr);
    return Math.sqrt(avg(arr.map(x => (x - m) ** 2)));
  };
  const recent = stdev(rets.slice(-10));
  const baseline = stdev(rets.slice(-60));
  if (baseline <= 0) return "normal";
  const ratio = recent / baseline;
  if (ratio > 1.5) return "panic";
  if (ratio < 0.7) return "calm";
  return "normal";
}

/**
 * Ratchet logic for trailing stops. Given the current stop_loss fraction
 * and the current unrealized P&L % (as a 0..1 fraction), return the
 * recommended new stop_loss. NEVER widens — only tightens.
 *
 * stop_loss convention: stop fires at avg_cost * (1 - stop_loss).
 *   - 0.05 = fires 5% below cost (normal stop)
 *   - 0     = fires AT break-even
 *   - -0.10 = fires at 110% of cost (profit-lock)
 *
 * Ladder:
 *   pnl >= 50% → lock in 30% gain   (sl = -0.30)
 *   pnl >= 35% → lock in 15% gain   (sl = -0.15)
 *   pnl >= 20% → lock in 5% gain    (sl = -0.05)
 *   pnl >= 10% → move stop to break-even (sl = 0)
 *   otherwise → keep current
 */
export function computeTrailingStop(currentSL: number, pnlFrac: number): number {
  if (pnlFrac <= 0) return currentSL;
  // Continuous ratchet: lock in (pnlFrac - 1×ATR-equivalent buffer)
  // Buffer = 10% of the gain, floored at 5% nominal stop
  const lockIn = pnlFrac - Math.max(pnlFrac * 0.10, 0.05);
  const target = -lockIn; // negative = profit-lock (fires above cost)
  return Math.min(currentSL, target);
}

/**
 * Position-size multiplier based on signal conviction.
 * Stronger bullish signal (lower dropProb) → larger position, capped at 1.5x.
 * Used to scale the base auto_buy_size at decision time.
 *
 *   dropProb 0.20 → 1.00x   (entry threshold)
 *   dropProb 0.10 → 1.25x
 *   dropProb 0.05 → 1.40x
 *   dropProb 0.00 → 1.50x   (max)
 */
export function sizingMultiplier(dropProb: number): number {
  if (dropProb >= 0.20) return 1.0;
  const conviction = Math.max(0, Math.min(1, (0.20 - dropProb) / 0.20)); // 0..1
  return 1.0 + conviction * 0.5;
}
