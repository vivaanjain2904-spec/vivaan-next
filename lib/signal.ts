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

export function computeSignal(candles: Candle[]): Signal | null {
  if (candles.length < 22) return null;
  const closes = candles.map(c => c.c);
  const latest = closes[closes.length - 1];

  const rsi = computeRSI(closes, 14);
  const ma20 = avg(closes.slice(-20));
  const ma50 = closes.length >= 50 ? avg(closes.slice(-50)) : ma20;
  const oneMoAgo = closes[Math.max(0, closes.length - 22)];
  const momentum1m = ((latest - oneMoAgo) / oneMoAgo) * 100;

  // Heuristic score
  let drop = 0.4;
  if (rsi > 75)       drop += 0.30;
  else if (rsi > 70)  drop += 0.18;
  else if (rsi < 25)  drop -= 0.20;
  else if (rsi < 35)  drop -= 0.10;
  if (latest < ma20)  drop += 0.10;
  if (latest < ma50)  drop += 0.10;
  if (momentum1m < -10) drop += 0.15;
  else if (momentum1m < -5) drop += 0.05;
  else if (momentum1m > 15) drop -= 0.10;
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

function avg(arr: number[]) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

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
