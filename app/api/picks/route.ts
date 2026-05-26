import { NextResponse } from "next/server";
import { getQuotes, getChart } from "@/lib/yfinance";
import { UNIVERSE } from "@/lib/universe";
import { computeSignal, computeSmartStops } from "@/lib/signal";

export const maxDuration = 60;
export const revalidate = 600; // cache for 10 minutes

/**
 * GET /api/picks?limit=20
 * Returns the top BUY candidates from the universe, ranked by signal strength
 * (lowest drop-probability = strongest bullish conviction).
 *
 * For each pick we include:
 *   - current price + day %
 *   - drop probability (0..1) and buy strength (1 - dropProb)
 *   - suggested smart stops (ATR-based)
 *   - suggested target price
 *
 * Used by the Top Picks tab on /screener and (eventually) any "what should
 * I buy" affordance in the app.
 */
const MAX_TO_SCORE = 80;          // limit chart fetches
const BUY_THRESHOLD = 0.30;       // include anything with dropProb < this (broader than autonomous)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));

  // Stage 1: pull quotes for the full universe
  const quoteMap = await getQuotes(UNIVERSE);

  // Stage 2: liquidity + price floor + pre-rank by recent weakness
  // (strong buys typically come from stocks that have pulled back a bit)
  const pre = UNIVERSE
    .map(t => ({ ticker: t, q: quoteMap[t] }))
    .filter(c => c.q && c.q.price >= 5 && (c.q.vol ?? 0) >= 200_000)
    .sort((a, b) => (a.q.pct ?? 0) - (b.q.pct ?? 0))
    .slice(0, MAX_TO_SCORE);

  // Stage 3: score each candidate with the full multi-factor signal
  const scored: any[] = [];
  const CHUNK = 12;
  for (let i = 0; i < pre.length; i += CHUNK) {
    const chunk = pre.slice(i, i + CHUNK);
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
        smart_stops: smart,                // { stop_loss: 0.07, take_profit: 0.14 } | null
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
    total_scanned: pre.length,
    total_candidates: scored.length,
    threshold: BUY_THRESHOLD,
    ts: new Date().toISOString(),
  });
}
