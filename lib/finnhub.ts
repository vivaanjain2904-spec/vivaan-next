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
