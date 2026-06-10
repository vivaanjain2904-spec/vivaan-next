/**
 * Signal calibration: is dropProb actually predictive?
 *
 * Walks the universe's daily-bar history, samples computeSignal at regular
 * intervals, and pairs each score with the realized FORWARD return over the
 * next N trading days. Buckets the samples into dropProb deciles so we can
 * see whether higher scores really precede worse returns (monotonically
 * decreasing mean forward return = well-calibrated ranking).
 *
 * This is a ranking/calibration check, not a full strategy backtest —
 * lib/backtest.ts handles per-ticker trade simulation.
 */
import type { Candle } from "./yfinance";
import { computeSignal } from "./signal";

export type CalibrationBucket = {
  bucket: string;          // e.g. "0.30–0.40"
  lo: number; hi: number;
  count: number;
  meanFwdPct: number;      // mean forward return %
  medianFwdPct: number;
  hitRatePct: number;      // % of samples with positive forward return
};

export type CalibrationResult = {
  tickers: number;         // tickers contributing samples
  samples: number;
  horizonDays: number;
  sampleEveryDays: number;
  buckets: CalibrationBucket[];
  spearman: number;        // rank correlation: bucket midpoint vs mean fwd return
  monotonic: boolean;      // does mean fwd return strictly fall as dropProb rises?
  verdict: string;
};

const WARMUP_BARS = 60;    // bars needed before the first signal sample

export function calibrate(
  barsMap: Record<string, Candle[]>,
  horizonDays = 10,
  sampleEveryDays = 5,
): CalibrationResult {
  const pairs: { drop: number; fwd: number }[] = [];
  let tickersUsed = 0;

  for (const candles of Object.values(barsMap)) {
    if (!candles || candles.length < WARMUP_BARS + horizonDays + 1) continue;
    let used = false;
    for (let i = WARMUP_BARS; i < candles.length - horizonDays; i += sampleEveryDays) {
      const sig = computeSignal(candles.slice(0, i + 1));
      if (!sig) continue;
      const now = candles[i].c;
      const later = candles[i + horizonDays].c;
      if (!now || !later) continue;
      pairs.push({ drop: sig.dropProb, fwd: ((later - now) / now) * 100 });
      used = true;
    }
    if (used) tickersUsed++;
  }

  // Fixed-width dropProb buckets (deciles of the score range)
  const buckets: CalibrationBucket[] = [];
  for (let b = 0; b < 10; b++) {
    const lo = b / 10, hi = (b + 1) / 10;
    const inB = pairs.filter(p => p.drop >= lo && (b === 9 ? p.drop <= hi : p.drop < hi));
    if (!inB.length) continue;
    const fwds = inB.map(p => p.fwd).sort((a, c) => a - c);
    const mean = fwds.reduce((a, c) => a + c, 0) / fwds.length;
    const median = fwds[Math.floor(fwds.length / 2)];
    const hits = inB.filter(p => p.fwd > 0).length;
    buckets.push({
      bucket: `${lo.toFixed(2)}–${hi.toFixed(2)}`, lo, hi,
      count: inB.length,
      meanFwdPct: Number(mean.toFixed(3)),
      medianFwdPct: Number(median.toFixed(3)),
      hitRatePct: Number(((hits / inB.length) * 100).toFixed(1)),
    });
  }

  // Spearman rank correlation between bucket order and mean forward return.
  // Well-calibrated: strongly negative (higher dropProb → lower fwd return).
  const spearman = spearmanRank(
    buckets.map((_, i) => i),
    buckets.map(b => b.meanFwdPct),
  );
  let monotonic = buckets.length >= 3;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].meanFwdPct >= buckets[i - 1].meanFwdPct) { monotonic = false; break; }
  }

  const verdict =
    buckets.length < 3 ? "insufficient data — too few populated buckets" :
    spearman <= -0.8 ? "well-calibrated ranking: higher dropProb consistently precedes worse forward returns" :
    spearman <= -0.4 ? "weakly calibrated: directionally right but noisy — thresholds are rough guides, not probabilities" :
    "NOT calibrated: dropProb ordering does not predict forward returns at this horizon";

  return {
    tickers: tickersUsed,
    samples: pairs.length,
    horizonDays,
    sampleEveryDays,
    buckets,
    spearman: Number(spearman.toFixed(3)),
    monotonic,
    verdict,
  };
}

function spearmanRank(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return 0;
  const rank = (arr: number[]) => {
    const idx = arr.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const r = new Array<number>(n);
    idx.forEach(([, orig], pos) => { r[orig] = pos; });
    return r;
  };
  const ra = rank(a), rb = rank(b);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}
