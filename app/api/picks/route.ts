import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { getQuotes, getChart } from "@/lib/yfinance";
import { computeSignal, computeSmartStops } from "@/lib/signal";

export const maxDuration = 30;
export const revalidate = 600;

/**
 * GET /api/picks?limit=20
 * Top BUY candidates ranked by signal strength.
 *
 * Performance approach (after multiple iterations):
 *  1. First try: read precomputed signals from ml_signals table — instant
 *  2. Fallback: live scan of a tiny 20-stock pool with strict per-fetch
 *     timeouts using Promise.allSettled (partial results OK)
 *  3. Cache result in the DB so next call is instant
 */
const BUY_THRESHOLD = 0.30;

/* Tight 20-stock pool of the most-watched names. Trade-off: less breadth
   for much more reliable response time. */
const POOL = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO",
  "AMD","NFLX","CRM","ORCL","JPM","V","MA","JNJ",
  "WMT","HD","XOM","COST",
];

const FETCH_TIMEOUT_MS = 4500;     // per chart fetch (Yahoo Finance)

/** Wraps a promise with a hard timeout. Resolves to null on timeout/fail. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(() => { clearTimeout(t); resolve(null); });
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));

  await initDb().catch(() => {});

  // ── Step 1: read precomputed signals from ml_signals table ──
  try {
    const r = await sql`SELECT ticker, drop_probability, price, rsi, return_1m, updated_at
      FROM ml_signals
      WHERE ticker = ANY(${POOL as any})
        AND drop_probability < ${BUY_THRESHOLD}
      ORDER BY drop_probability ASC
      LIMIT ${limit}`;
    if (r.rows.length > 0) {
      // Fetch fresh quote + smart_stops only for the ranked rows (much smaller call)
      const tickers = r.rows.map((x: any) => x.ticker);
      const quotes = await getQuotes(tickers);
      const enriched = await Promise.all(r.rows.map(async (row: any) => {
        const q = quotes[row.ticker];
        const price = q?.price ?? Number(row.price ?? 0);
        const candles = await withTimeout(getChart(row.ticker, "1mo"), FETCH_TIMEOUT_MS).catch(() => null);
        const smart = candles ? computeSmartStops(candles) : null;
        return {
          ticker: row.ticker,
          name: q?.name ?? "",
          price,
          day_pct: q?.pct ?? 0,
          drop_prob: Number(row.drop_probability),
          buy_strength: Math.round((1 - Number(row.drop_probability)) * 100),
          rsi: Math.round(Number(row.rsi ?? 50)),
          momentum_1m: Number(row.return_1m ?? 0) * 100,
          smart_stops: smart,
          suggested_stop:   smart ? Number((price * (1 - smart.stop_loss)).toFixed(2))   : null,
          suggested_target: smart ? Number((price * (1 + smart.take_profit)).toFixed(2)) : null,
        };
      }));
      return NextResponse.json({
        picks: enriched,
        total_scanned: POOL.length,
        total_candidates: r.rows.length,
        threshold: BUY_THRESHOLD,
        source: "cache",
        ts: new Date().toISOString(),
      });
    }
  } catch {}

  // ── Step 2: fallback live scan with strict per-fetch timeouts ──
  const quotes = await getQuotes(POOL);
  const liquid = POOL
    .map(t => ({ ticker: t, q: quotes[t] }))
    .filter(c => c.q && c.q.price >= 5);

  // Run ALL chart fetches in parallel with Promise.allSettled — slow ones don't block
  const enriched = await Promise.allSettled(
    liquid.map(async c => {
      const candles = await withTimeout(getChart(c.ticker, "3mo"), FETCH_TIMEOUT_MS);
      if (!candles) return null;
      const sig = computeSignal(candles);
      if (!sig || sig.dropProb >= BUY_THRESHOLD) return null;
      const smart = computeSmartStops(candles);
      const price = c.q.price;
      return {
        ticker: c.ticker, name: c.q.name, price, day_pct: c.q.pct,
        drop_prob: sig.dropProb,
        buy_strength: Math.round((1 - sig.dropProb) * 100),
        rsi: Math.round(sig.rsi),
        momentum_1m: Number(sig.momentum1m.toFixed(2)),
        smart_stops: smart,
        suggested_stop:   smart ? Number((price * (1 - smart.stop_loss)).toFixed(2))   : null,
        suggested_target: smart ? Number((price * (1 + smart.take_profit)).toFixed(2)) : null,
        _signal: sig,
      };
    })
  );

  const scored = enriched
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => (r as any).value);

  scored.sort((a, b) => a.drop_prob - b.drop_prob);

  // ── Step 3: write back to ml_signals table for next time (best-effort) ──
  for (const s of scored) {
    try {
      await sql`INSERT INTO ml_signals (ticker, drop_probability, price, rsi, return_1m, updated_at)
        VALUES (${s.ticker}, ${s.drop_prob}, ${s.price}, ${s._signal?.rsi ?? null},
                ${(s._signal?.momentum1m ?? 0) / 100}, NOW())
        ON CONFLICT (ticker) DO UPDATE
          SET drop_probability = EXCLUDED.drop_probability,
              price = EXCLUDED.price,
              rsi = EXCLUDED.rsi,
              return_1m = EXCLUDED.return_1m,
              updated_at = NOW()`;
    } catch {}
  }

  // strip internal field
  const out = scored.map(({ _signal, ...rest }) => rest).slice(0, limit);

  return NextResponse.json({
    picks: out,
    total_scanned: liquid.length,
    total_candidates: scored.length,
    threshold: BUY_THRESHOLD,
    source: "live",
    ts: new Date().toISOString(),
  });
}
