/**
 * Threshold calibration: where should the Buy/Sell dropProb cutoffs sit?
 *
 * The walk-forward harness (lib/walkforward.ts) validated that dropProb
 * *ranks* forward returns well (-0.900 test Spearman), but the live
 * thresholds (Buy <= 0.35, Sell >= 0.65) are hand-picked. This module scans
 * candidate cutoffs on a chronological train window, picks the ones that
 * maximize expected value per trade subject to a minimum-coverage
 * constraint (so we don't cherry-pick a tiny tail), then reports how those
 * choices — and the current live thresholds — perform on the held-out test
 * window.
 *
 * Expected value here = mean forward return of the samples the rule selects,
 * measured against the unconditional mean ("edge"). Buy rule selects
 * drop <= t; sell rule selects drop >= t (where we want the most NEGATIVE
 * mean forward return, i.e. selling avoids the worst outcomes).
 */
import type { Candle } from "./yfinance";
import { computeSignal } from "./signal";
import { SURVIVORSHIP_BIAS_NOTE } from "./universe";

export type ThresholdStats = {
  threshold: number;
  count: number;
  coveragePct: number;   // % of window samples selected by the rule
  meanFwdPct: number;    // mean forward return of selected samples
  hitRatePct: number;    // % of selected samples with positive forward return
  edgePct: number;       // meanFwdPct minus the window's unconditional mean
};

export type ThresholdCalibrationResult = {
  tickers: number;
  trainSamples: number;
  testSamples: number;
  horizonDays: number;
  sampleEveryDays: number;
  trainFrac: number;
  trainMeanFwdPct: number;   // unconditional baseline, train window
  testMeanFwdPct: number;    // unconditional baseline, test window
  buyGrid: ThresholdStats[];     // train-window stats per buy candidate
  sellGrid: ThresholdStats[];    // train-window stats per sell candidate
  bestBuy: { threshold: number; train: ThresholdStats; test: ThresholdStats };
  bestSell: { threshold: number; train: ThresholdStats; test: ThresholdStats };
  currentBuy: { threshold: number; train: ThresholdStats; test: ThresholdStats };
  currentSell: { threshold: number; train: ThresholdStats; test: ThresholdStats };
  verdict: string;
  caveats: string[];
};

const WARMUP_BARS = 60;
const LIVE_BUY_THRESHOLD = 0.35;
const LIVE_SELL_THRESHOLD = 0.65;
// Candidate cutoffs (dropProb units). Buy = enter when drop <= t; sell = exit when drop >= t.
const BUY_GRID = [0.2, 0.225, 0.25, 0.275, 0.3, 0.325, 0.35, 0.375, 0.4, 0.425, 0.45];
const SELL_GRID = [0.5, 0.525, 0.55, 0.575, 0.6, 0.625, 0.65, 0.675, 0.7, 0.725, 0.75];
// A rule must select at least this share of samples to be considered —
// guards against overfitting to a handful of extreme scores.
const MIN_COVERAGE = 0.05;

type Sample = { drop: number; fwd: number };

export function calibrateThresholds(
  barsMap: Record<string, Candle[]>,
  horizonDays = 10,
  sampleEveryDays = 5,
  trainFrac = 0.6,
): ThresholdCalibrationResult {
  const trainSamples: Sample[] = [];
  const testSamples: Sample[] = [];
  let tickersUsed = 0;

  for (const candles of Object.values(barsMap)) {
    if (!candles || candles.length < WARMUP_BARS + horizonDays + 1) continue;
    const splitIdx = WARMUP_BARS + Math.floor((candles.length - WARMUP_BARS - horizonDays) * trainFrac);
    let used = false;
    for (let i = WARMUP_BARS; i < candles.length - horizonDays; i += sampleEveryDays) {
      const sig = computeSignal(candles.slice(0, i + 1));
      if (!sig) continue;
      const now = candles[i].c;
      const later = candles[i + horizonDays].c;
      if (!now || !later) continue;
      (i < splitIdx ? trainSamples : testSamples).push({ drop: sig.dropProb, fwd: ((later - now) / now) * 100 });
      used = true;
    }
    if (used) tickersUsed++;
  }

  const mean = (xs: number[]) => xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0;
  const trainMean = mean(trainSamples.map(s => s.fwd));
  const testMean = mean(testSamples.map(s => s.fwd));

  const statsFor = (samples: Sample[], windowMean: number, threshold: number, side: "buy" | "sell"): ThresholdStats => {
    const sel = samples.filter(s => side === "buy" ? s.drop <= threshold : s.drop >= threshold);
    const m = mean(sel.map(s => s.fwd));
    const hits = sel.filter(s => s.fwd > 0).length;
    return {
      threshold,
      count: sel.length,
      coveragePct: Number((samples.length ? (sel.length / samples.length) * 100 : 0).toFixed(1)),
      meanFwdPct: Number(m.toFixed(3)),
      hitRatePct: Number((sel.length ? (hits / sel.length) * 100 : 0).toFixed(1)),
      edgePct: Number((m - windowMean).toFixed(3)),
    };
  };

  const buyGrid = BUY_GRID.map(t => statsFor(trainSamples, trainMean, t, "buy"));
  const sellGrid = SELL_GRID.map(t => statsFor(trainSamples, trainMean, t, "sell"));

  // Buy: maximize edge (selected mean above unconditional). Sell: minimize
  // selected mean (most negative edge — the rule should isolate the worst
  // outcomes). Both subject to the coverage floor.
  const minCount = Math.max(30, Math.floor(trainSamples.length * MIN_COVERAGE));
  const eligible = (g: ThresholdStats[]) => g.filter(s => s.count >= minCount);
  const pick = (g: ThresholdStats[], better: (a: ThresholdStats, b: ThresholdStats) => boolean) => {
    const cands = eligible(g);
    if (!cands.length) return g[Math.floor(g.length / 2)];
    let best = cands[0];
    for (const c of cands) if (better(c, best)) best = c;
    return best;
  };
  const bestBuyTrain = pick(buyGrid, (a, b) => a.edgePct > b.edgePct);
  const bestSellTrain = pick(sellGrid, (a, b) => a.edgePct < b.edgePct);

  const wrap = (t: number, side: "buy" | "sell") => ({
    threshold: t,
    train: statsFor(trainSamples, trainMean, t, side),
    test: statsFor(testSamples, testMean, t, side),
  });

  const bestBuy = wrap(bestBuyTrain.threshold, "buy");
  const bestSell = wrap(bestSellTrain.threshold, "sell");
  const currentBuy = wrap(LIVE_BUY_THRESHOLD, "buy");
  const currentSell = wrap(LIVE_SELL_THRESHOLD, "sell");

  // Verdict: did the train-optimal thresholds beat the live ones out-of-sample
  // by a margin worth acting on (>= 0.1% mean forward return per trade)?
  const buyGain = bestBuy.test.edgePct - currentBuy.test.edgePct;
  const sellGain = currentSell.test.edgePct - bestSell.test.edgePct; // sell: lower is better
  const insufficient = trainSamples.length < 1000 || testSamples.length < 1000;
  const parts: string[] = [];
  if (!insufficient) {
    parts.push(buyGain >= 0.1
      ? `buy threshold ${bestBuy.threshold} beats live ${LIVE_BUY_THRESHOLD} out-of-sample (+${buyGain.toFixed(3)}% edge per trade)`
      : `live buy threshold ${LIVE_BUY_THRESHOLD} holds up (train-optimal ${bestBuy.threshold} gains only ${buyGain.toFixed(3)}% out-of-sample)`);
    parts.push(sellGain >= 0.1
      ? `sell threshold ${bestSell.threshold} beats live ${LIVE_SELL_THRESHOLD} out-of-sample (avoids ${sellGain.toFixed(3)}% more downside per trade)`
      : `live sell threshold ${LIVE_SELL_THRESHOLD} holds up (train-optimal ${bestSell.threshold} gains only ${sellGain.toFixed(3)}% out-of-sample)`);
  }
  const verdict = insufficient ? "insufficient data — too few samples" : parts.join("; ");

  return {
    tickers: tickersUsed,
    trainSamples: trainSamples.length,
    testSamples: testSamples.length,
    horizonDays, sampleEveryDays, trainFrac,
    trainMeanFwdPct: Number(trainMean.toFixed(3)),
    testMeanFwdPct: Number(testMean.toFixed(3)),
    buyGrid, sellGrid,
    bestBuy, bestSell, currentBuy, currentSell,
    verdict,
    caveats: [SURVIVORSHIP_BIAS_NOTE],
  };
}
