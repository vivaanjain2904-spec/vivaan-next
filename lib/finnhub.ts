/**
 * Finnhub free-tier wrapper.
 * Set FINNHUB_KEY in Vercel env. Free tier: 60 req/min.
 * Docs: https://finnhub.io/docs/api
 */
const BASE = "https://finnhub.io/api/v1";

function key(): string | null {
  return process.env.FINNHUB_KEY ?? null;
}

async function _get<T = any>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const k = key();
  if (!k) return null;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("token", k);
  for (const [kk, vv] of Object.entries(params)) url.searchParams.set(kk, vv);
  try {
    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch { return null; }
}

/**
 * Returns days until the next earnings date (positive = future, negative = past).
 * Returns null if no upcoming earnings or Finnhub key not set.
 */
export async function getEarningsDate(ticker: string): Promise<number | null> {
  const tk = ticker.toUpperCase();
  // Finnhub earnings calendar endpoint returns events in a date range
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const j = await _get<{ earningsCalendar: { date: string; symbol: string }[] }>(
    "/calendar/earnings", { symbol: tk, from, to }
  );
  const events = j?.earningsCalendar ?? [];
  if (!events.length) return null;
  const now = Date.now();
  const future = events
    .map(e => ({ days: Math.floor((new Date(e.date).getTime() - now) / 86_400_000) }))
    .filter(e => e.days >= 0)
    .sort((a, b) => a.days - b.days);
  return future[0]?.days ?? null;
}

export type InsiderTx = {
  name: string;
  txType: string; // "P-Purchase" | "S-Sale" | etc.
  share: number;
  value: number;
  transactionDate: string;
};

/**
 * Recent insider transactions for a ticker (Form 4, last 90 days).
 * Returns empty array if FINNHUB_KEY not set or request fails.
 */
export async function getInsiderActivity(ticker: string): Promise<InsiderTx[]> {
  const tk = ticker.toUpperCase();
  const j = await _get<{ data: InsiderTx[] }>("/stock/insider-transactions", { symbol: tk });
  const data = j?.data ?? [];
  const cutoff = Date.now() - 90 * 86_400_000;
  return data.filter(tx => new Date(tx.transactionDate).getTime() >= cutoff);
}

export type Fundamentals = {
  pe: number | null;
  eps: number | null;
  epsGrowth: number | null;
  revenueGrowth: number | null;
  debtEquity: number | null;
  roe: number | null;
};

/**
 * Key fundamentals for a ticker. Returns null if key missing or request fails.
 */
export async function getFundamentals(ticker: string): Promise<Fundamentals | null> {
  const tk = ticker.toUpperCase();
  const j = await _get<{ metric: Record<string, any> }>("/stock/metric", { symbol: tk, metric: "all" });
  if (!j?.metric) return null;
  const m = j.metric;
  return {
    pe:            m["peNormalizedAnnual"] ?? m["peBasicExclExtraTTM"] ?? null,
    eps:           m["epsNormalizedAnnual"] ?? null,
    epsGrowth:     m["epsGrowth5Y"] ?? m["epsGrowth3Y"] ?? null,
    revenueGrowth: m["revenueGrowthAnnual"] ?? m["revenueGrowth5Y"] ?? null,
    debtEquity:    m["totalDebt/totalEquityAnnual"] ?? null,
    roe:           m["roeAnnual"] ?? null,
  };
}

export type EarningsSurprise = {
  period: string;       // e.g. "2026-03-31"
  actual: number;       // reported EPS
  estimate: number;     // consensus estimate
  surprise: number;     // actual - estimate
  surprisePct: number;  // (actual - estimate) / |estimate| * 100
  daysAgo: number;      // how many days since this report
};

/**
 * Most recent earnings surprise from Finnhub.
 * Returns null if FINNHUB_KEY not set, no data, or estimate was zero.
 * Finnhub endpoint: GET /stock/earnings?symbol=AAPL&limit=4
 */
export async function getLastEarningsSurprise(ticker: string): Promise<EarningsSurprise | null> {
  const tk = ticker.toUpperCase();
  const j = await _get<{ actual: number; estimate: number; period: string; symbol: string }[]>(
    "/stock/earnings", { symbol: tk, limit: "4" }
  );
  if (!Array.isArray(j) || !j.length) return null;
  // Sort by period descending, pick most recent past report
  const past = j
    .filter(e => e.actual != null && e.estimate != null && e.period)
    .sort((a, b) => b.period.localeCompare(a.period));
  if (!past.length) return null;
  const e = past[0];
  if (Math.abs(e.estimate) < 0.001) return null; // avoid divide-by-zero on near-zero estimates
  const surprise = e.actual - e.estimate;
  const surprisePct = (surprise / Math.abs(e.estimate)) * 100;
  const daysAgo = Math.floor((Date.now() - new Date(e.period).getTime()) / 86_400_000);
  return { period: e.period, actual: e.actual, estimate: e.estimate, surprise, surprisePct, daysAgo };
}

/**
 * PEAD score: positive = bullish drift expected, negative = bearish.
 * Returns null if no data or key missing.
 * Only active within 60 days of the report (drift decays after that).
 * Score range roughly -1..+1.
 */
export async function peadScore(ticker: string): Promise<number | null> {
  const s = await getLastEarningsSurprise(ticker);
  if (!s || s.daysAgo > 60) return null;  // outside PEAD window
  // Decay linearly from full weight at day 0 to 0 at day 60
  const decay = 1 - s.daysAgo / 60;
  // Surprise magnitude buckets (surprisePct = % beat/miss vs estimate)
  let raw = 0;
  if (s.surprisePct > 20)      raw =  1.0;  // massive beat
  else if (s.surprisePct > 10) raw =  0.6;  // strong beat
  else if (s.surprisePct > 5)  raw =  0.3;  // moderate beat
  else if (s.surprisePct > 2)  raw =  0.15; // small beat
  else if (s.surprisePct < -20) raw = -1.0; // massive miss
  else if (s.surprisePct < -10) raw = -0.6; // strong miss
  else if (s.surprisePct < -5)  raw = -0.3; // moderate miss
  else if (s.surprisePct < -2)  raw = -0.15;// small miss
  return raw * decay;
}

/**
 * Net insider buying signal: ratio of purchases to (purchases + sales) in recent 90d.
 * Returns null if no transactions or key missing. 1.0 = all purchases, 0.0 = all sales.
 */
export async function insiderBuyingScore(ticker: string): Promise<number | null> {
  const txs = await getInsiderActivity(ticker);
  if (!txs.length) return null;
  let buyValue = 0, sellValue = 0;
  for (const tx of txs) {
    if (tx.txType?.includes("P-Purchase")) buyValue += Math.abs(tx.value);
    else if (tx.txType?.includes("S-Sale")) sellValue += Math.abs(tx.value);
  }
  const total = buyValue + sellValue;
  return total > 0 ? buyValue / total : null;
}
