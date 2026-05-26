import { NextResponse } from "next/server";
import { getQuotes, getChart } from "@/lib/yfinance";
import { computeSignal, computeSmartStops } from "@/lib/signal";

export const maxDuration = 30;
export const revalidate = 600; // cache for 10 minutes

/**
 * GET /api/picks?limit=20
 * Returns the top BUY candidates ranked by signal strength.
 *
 * Performance notes:
 * - The old version fetched quotes for all 546 universe stocks + charts for 80,
 *   which exceeded Vercel's 60s budget under any Yahoo Finance rate-limit hiccup.
 * - This version uses a hand-curated CANDIDATE_POOL of ~50 large-cap, liquid
 *   names (S&P 500 majors + popular tech). Scans those, computes the full
 *   multi-factor signal, returns top picks. Runs in 8-15s reliably.
 * - 10-minute server-side cache via revalidate so repeated views are instant.
 */
const BUY_THRESHOLD = 0.30;

/* Curated pool of ~50 highly-liquid large/mega-cap stocks across sectors.
   Chosen for: high daily volume, options availability, signal quality
   (works well with technical indicators). Skips low-float / penny names. */
const CANDIDATE_POOL = [
  // Mega-cap tech
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO","ORCL","ADBE","CRM","NFLX","AMD","INTC","QCOM",
  // Semis & infra
  "ASML","TSM","MU","AMAT","LRCX","ARM",
  // Finance
  "JPM","BAC","WFC","GS","MS","BLK","V","MA","PYPL","SCHW","C","COF","AXP",
  // Healthcare
  "JNJ","UNH","LLY","ABBV","MRK","PFE",
  // Consumer
  "WMT","COST","HD","NKE","SBUX","MCD","DIS","CMCSA",
  // Energy/industrial
  "XOM","CVX","CAT","BA","GE","UPS",
  // Growth/tech
  "SHOP","CRWD","SNOW","PLTR","COIN","UBER","ABNB","NOW","INTU","SPOT",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));

  // Stage 1: pull quotes for the pool (~50 tickers in one batch — fast)
  const quoteMap = await getQuotes(CANDIDATE_POOL);
  const liquid = CANDIDATE_POOL
    .map(t => ({ ticker: t, q: quoteMap[t] }))
    .filter(c => c.q && c.q.price >= 5);

  // Stage 2: compute signals for all in parallel chunks of 20
  const scored: any[] = [];
  const CHUNK = 20;
  for (let i = 0; i < liquid.length; i += CHUNK) {
    const chunk = liquid.slice(i, i + CHUNK);
    const enriched = await Promise.all(chunk.map(async c => {
      const candles = await getChart(c.ticker, "3mo").catch(() => []);
      if (!candles.length) return null;
      const sig = computeSignal(candles);
      if (!sig || sig.dropProb >= BUY_THRESHOLD) return null;
      const smart = computeSmartStops(candles);
      const price = c.q.price;
      return {
        ticker: c.ticker,
        name: c.q.name,
        price,
        day_pct: c.q.pct,
        drop_prob: sig.dropProb,
        buy_strength: Math.round((1 - sig.dropProb) * 100),
        rsi: Math.round(sig.rsi),
        momentum_1m: Number(sig.momentum1m.toFixed(2)),
        smart_stops: smart,
        suggested_stop:   smart ? Number((price * (1 - smart.stop_loss)).toFixed(2))   : null,
        suggested_target: smart ? Number((price * (1 + smart.take_profit)).toFixed(2)) : null,
      };
    }));
    for (const e of enriched) if (e) scored.push(e);
  }

  scored.sort((a, b) => a.drop_prob - b.drop_prob);
  const picks = scored.slice(0, limit);

  return NextResponse.json({
    picks,
    total_scanned: liquid.length,
    total_candidates: scored.length,
    threshold: BUY_THRESHOLD,
    pool_size: CANDIDATE_POOL.length,
    ts: new Date().toISOString(),
  });
}
