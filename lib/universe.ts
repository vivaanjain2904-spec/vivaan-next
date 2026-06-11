import universe from "./universe.json";
export const UNIVERSE: string[] = universe as string[];

/**
 * UNIVERSE is today's constituent list — it doesn't include names that have
 * since been delisted, acquired, or gone bankrupt. Any backtest/calibration
 * run over UNIVERSE is therefore subject to survivorship bias: historically
 * the worst-performing dropouts are invisible, which can make both the raw
 * buy-and-hold baseline and the strategy's calibration look better than a
 * point-in-time universe would have.
 */
export const SURVIVORSHIP_BIAS_NOTE =
  "UNIVERSE reflects today's tickers only (no delisted/acquired/bankrupt names) — " +
  "results may be optimistic vs. a true point-in-time universe.";

