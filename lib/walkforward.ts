/**
 * Walk-forward validation of the bearish/bullish factor-weight scales in
 * computeSignal (see SignalScales in lib/signal.ts).
 *
 * For each ticker's bar history, splits the sampled (dropProb, forward
 * return) pairs chronologically into a train window and a test window.
 * Searches a small grid of {bearish, bullish} scale multipliers, picks the
 * one with the strongest (most negative) Spearman correlation on the train
 * window, then reports how that choice performs out-of-sample on the test
 * window versus the baseline (1, 1) — i.e. today's hand-tuned weights.
 *
 * This is a coarse two-parameter search (not per-factor) — enough to tell
 * us whether the bearish/bullish sides of the heuristic are over- or
 * under-weighted relative to each other, without an expensive per-factor
 * grid search.
 */
import type { Candle } from "./yfinance";
import { computeSignal, computeSignalContributions, FACTOR_NAMES, DEFAULT_SCALES, type SignalScales, type FactorWeights } from "./signal";
import { SURVIVORSHIP_BIAS_NOTE } from "./universe";

export type WalkForwardResult = {
  tickers: number;
  trainSamples: number;
  testSamples: number;
  horizonDays: number;
  sampleEveryDays: number;
  trainFrac: number;
  grid: { bearish: number; bullish: number; trainSpearman: number }[];
  best: { bearish: number; bullish: number };
  trainSpearmanAtBest: number;
  testSpearmanAtBest: number;
  testSpearmanBaseline: number;
  verdict: string;
  caveats: string[];
};

const WARMUP_BARS = 60;
const SCALE_GRID = [0.5, 0.75, 1.0, 1.25, 1.5];

export function walkForwardValidate(
  barsMap: Record<string, Candle[]>,
  horizonDays = 10,
  sampleEveryDays = 5,
  trainFrac = 0.6,
): WalkForwardResult {
  // pairs[i] = { drop, fwd } computed at scales=(1,1); we re-derive dropProb
  // for other scales from the per-factor contributions, so we need those too.
  type Sample = { contributions: number[]; fwd: number };
  const trainSamples: Sample[] = [];
  const testSamples: Sample[] = [];
  let tickersUsed = 0;

  for (const candles of Object.values(barsMap)) {
    if (!candles || candles.length < WARMUP_BARS + horizonDays + 1) continue;
    const splitIdx = WARMUP_BARS + Math.floor((candles.length - WARMUP_BARS - horizonDays) * trainFrac);
    let used = false;
    for (let i = WARMUP_BARS; i < candles.length - horizonDays; i += sampleEveryDays) {
      const sig = computeSignalWithContributions(candles.slice(0, i + 1));
      if (!sig) continue;
      const now = candles[i].c;
      const later = candles[i + horizonDays].c;
      if (!now || !later) continue;
      const sample: Sample = { contributions: sig.contributions, fwd: ((later - now) / now) * 100 };
      (i < splitIdx ? trainSamples : testSamples).push(sample);
      used = true;
    }
    if (used) tickersUsed++;
  }

  const grid: { bearish: number; bullish: number; trainSpearman: number }[] = [];
  for (const bearish of SCALE_GRID) {
    for (const bullish of SCALE_GRID) {
      grid.push({ bearish, bullish, trainSpearman: spearmanForScales(trainSamples, { bearish, bullish }, horizonDays, sampleEveryDays) });
    }
  }

  let best = grid[0];
  for (const g of grid) if (g.trainSpearman < best.trainSpearman) best = g;

  const testSpearmanAtBest = spearmanForScales(testSamples, { bearish: best.bearish, bullish: best.bullish }, horizonDays, sampleEveryDays);
  const testSpearmanBaseline = spearmanForScales(testSamples, { bearish: 1, bullish: 1 }, horizonDays, sampleEveryDays);

  const improved = testSpearmanAtBest < testSpearmanBaseline - 0.05;
  const verdict =
    trainSamples.length < 100 || testSamples.length < 100 ? "insufficient data — too few samples" :
    improved ? `re-weighting helps out-of-sample: bearish×${best.bearish}, bullish×${best.bullish} (test Spearman ${testSpearmanAtBest.toFixed(3)} vs baseline ${testSpearmanBaseline.toFixed(3)})` :
    "current (1,1) weights hold up — no re-weighting found that generalizes out-of-sample";

  return {
    tickers: tickersUsed,
    trainSamples: trainSamples.length,
    testSamples: testSamples.length,
    horizonDays, sampleEveryDays, trainFrac,
    grid,
    best: { bearish: best.bearish, bullish: best.bullish },
    trainSpearmanAtBest: Number(best.trainSpearman.toFixed(3)),
    testSpearmanAtBest: Number(testSpearmanAtBest.toFixed(3)),
    testSpearmanBaseline: Number(testSpearmanBaseline.toFixed(3)),
    verdict,
    caveats: [SURVIVORSHIP_BIAS_NOTE],
  };
}

/** Re-derives dropProb from cached per-factor contributions at given scales, then buckets + Spearman. */
function spearmanForScales(
  samples: { contributions: number[]; fwd: number }[],
  scales: SignalScales,
  _horizonDays: number,
  _sampleEveryDays: number,
): number {
  if (samples.length < 30) return 0;
  const pairs = samples.map(s => {
    let drop = 0.4;
    for (const c of s.contributions) drop += c * (c > 0 ? scales.bearish : scales.bullish);
    drop = Math.max(0, Math.min(1, drop));
    return { drop, fwd: s.fwd };
  });

  const buckets: { meanFwd: number }[] = [];
  for (let b = 0; b < 10; b++) {
    const lo = b / 10, hi = (b + 1) / 10;
    const inB = pairs.filter(p => p.drop >= lo && (b === 9 ? p.drop <= hi : p.drop < hi));
    if (!inB.length) continue;
    buckets.push({ meanFwd: inB.reduce((a, c) => a + c.fwd, 0) / inB.length });
  }
  if (buckets.length < 3) return 0;
  return spearmanRank(buckets.map((_, i) => i), buckets.map(b => b.meanFwd));
}

/** computeSignal but also returns the raw per-factor contributions (scales=(1,1) doesn't matter, we read contributions directly). */
function computeSignalWithContributions(candles: Candle[]): { contributions: number[] } | null {
  // computeSignal doesn't expose contributions directly; re-run the same
  // factor logic isn't worth duplicating here — instead reconstruct
  // contributions from dropProb at scales (1,0) and (0,1), which isolate
  // the bearish-only and bullish-only sums respectively. Note: computeSignal
  // clamps dropProb to [0,1], so in the rare case where the bearish (or
  // bullish) sum alone would push 0.4 outside that range, the extracted sum
  // is truncated — an acceptable approximation for this coarse 2-param search.
  const base = computeSignal(candles, undefined, { bearish: 0, bullish: 0 });
  if (!base) return null;
  const bearishOnly = computeSignal(candles, undefined, { bearish: 1, bullish: 0 })!;
  const bullishOnly = computeSignal(candles, undefined, { bearish: 0, bullish: 1 })!;
  const bearishSum = bearishOnly.dropProb - base.dropProb; // 0.4 + bearishSum - 0.4
  const bullishSum = bullishOnly.dropProb - base.dropProb; // 0.4 + bullishSum - 0.4
  // Represent as two pseudo-contributions; spearmanForScales applies the
  // scale to each based on sign, which reproduces drop = 0.4 + bearishSum*scale.bearish + bullishSum*scale.bullish
  const contributions: number[] = [];
  if (bearishSum !== 0) contributions.push(bearishSum);
  if (bullishSum !== 0) contributions.push(bullishSum);
  return { contributions };
}

export type PerFactorResult = {
  tickers: number;
  trainSamples: number;
  testSamples: number;
  horizonDays: number;
  sampleEveryDays: number;
  trainFrac: number;
  baselineTrainSpearman: number;
  baselineTestSpearman: number;
  bestWeights: FactorWeights;
  trainSpearmanAtBest: number;
  testSpearmanAtBest: number;
  perFactor: { name: string; weight: number; trainSpearman: number }[];
  verdict: string;
  caveats: string[];
};

const FACTOR_WEIGHT_GRID = [0, 0.5, 1, 1.5, 2];

/**
 * Coordinate-ascent walk-forward search over per-factor weight multipliers
 * (see FactorWeights / FACTOR_NAMES in lib/signal.ts), applied on top of the
 * already-calibrated bearish/bullish DEFAULT_SCALES. For each factor in turn,
 * grid-searches its weight to maximize (most negative) train Spearman while
 * holding all other factors' weights fixed, for 2 passes. Reports how the
 * resulting weights perform out-of-sample vs the all-1 baseline.
 */
export function walkForwardValidatePerFactor(
  barsMap: Record<string, Candle[]>,
  horizonDays = 10,
  sampleEveryDays = 5,
  trainFrac = 0.6,
): PerFactorResult {
  type Sample = { contributions: { name: string; value: number }[]; fwd: number };
  const trainSamples: Sample[] = [];
  const testSamples: Sample[] = [];
  let tickersUsed = 0;

  for (const candles of Object.values(barsMap)) {
    if (!candles || candles.length < WARMUP_BARS + horizonDays + 1) continue;
    const splitIdx = WARMUP_BARS + Math.floor((candles.length - WARMUP_BARS - horizonDays) * trainFrac);
    let used = false;
    for (let i = WARMUP_BARS; i < candles.length - horizonDays; i += sampleEveryDays) {
      const contributions = computeSignalContributions(candles.slice(0, i + 1));
      if (!contributions) continue;
      const now = candles[i].c;
      const later = candles[i + horizonDays].c;
      if (!now || !later) continue;
      (i < splitIdx ? trainSamples : testSamples).push({ contributions, fwd: ((later - now) / now) * 100 });
      used = true;
    }
    if (used) tickersUsed++;
  }

  const dropFor = (s: Sample, weights: FactorWeights) => {
    let drop = 0.4;
    for (const { name, value } of s.contributions) {
      const scale = value > 0 ? DEFAULT_SCALES.bearish : DEFAULT_SCALES.bullish;
      drop += value * scale * (weights[name] ?? 1);
    }
    return Math.max(0, Math.min(1, drop));
  };

  const spearmanFor = (samples: Sample[], weights: FactorWeights) => {
    if (samples.length < 30) return 0;
    const pairs = samples.map(s => ({ drop: dropFor(s, weights), fwd: s.fwd }));
    const buckets: { meanFwd: number }[] = [];
    for (let b = 0; b < 10; b++) {
      const lo = b / 10, hi = (b + 1) / 10;
      const inB = pairs.filter(p => p.drop >= lo && (b === 9 ? p.drop <= hi : p.drop < hi));
      if (!inB.length) continue;
      buckets.push({ meanFwd: inB.reduce((a, c) => a + c.fwd, 0) / inB.length });
    }
    if (buckets.length < 3) return 0;
    return spearmanRank(buckets.map((_, i) => i), buckets.map(b => b.meanFwd));
  };

  const allOnes: FactorWeights = {};
  for (const name of FACTOR_NAMES) allOnes[name] = 1;
  const baselineTrainSpearman = spearmanFor(trainSamples, allOnes);
  const baselineTestSpearman = spearmanFor(testSamples, allOnes);

  // Coordinate-ascent: 2 passes over all factors, each time picking the
  // weight that most improves (most negative) train Spearman, holding the
  // rest fixed at their current best.
  const weights: FactorWeights = { ...allOnes };
  const perFactor: { name: string; weight: number; trainSpearman: number }[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const name of FACTOR_NAMES) {
      let bestW = weights[name], bestS = spearmanFor(trainSamples, weights);
      for (const w of FACTOR_WEIGHT_GRID) {
        const trial = { ...weights, [name]: w };
        const s = spearmanFor(trainSamples, trial);
        if (s < bestS) { bestS = s; bestW = w; }
      }
      weights[name] = bestW;
      if (pass === 1) perFactor.push({ name, weight: bestW, trainSpearman: Number(bestS.toFixed(3)) });
    }
  }

  const trainSpearmanAtBest = spearmanFor(trainSamples, weights);
  const testSpearmanAtBest = spearmanFor(testSamples, weights);

  const improved = testSpearmanAtBest < baselineTestSpearman - 0.05;
  const verdict =
    trainSamples.length < 100 || testSamples.length < 100 ? "insufficient data — too few samples" :
    improved ? `per-factor re-weighting helps out-of-sample (test Spearman ${testSpearmanAtBest.toFixed(3)} vs baseline ${baselineTestSpearman.toFixed(3)})` :
    "current per-factor weights (all 1) hold up — no per-factor re-weighting found that generalizes out-of-sample";

  return {
    tickers: tickersUsed,
    trainSamples: trainSamples.length,
    testSamples: testSamples.length,
    horizonDays, sampleEveryDays, trainFrac,
    baselineTrainSpearman: Number(baselineTrainSpearman.toFixed(3)),
    baselineTestSpearman: Number(baselineTestSpearman.toFixed(3)),
    bestWeights: weights,
    trainSpearmanAtBest: Number(trainSpearmanAtBest.toFixed(3)),
    testSpearmanAtBest: Number(testSpearmanAtBest.toFixed(3)),
    perFactor,
    verdict,
    caveats: [SURVIVORSHIP_BIAS_NOTE],
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
