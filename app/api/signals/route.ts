import { NextResponse } from "next/server";
import { getChart } from "@/lib/yfinance";
import { computeSignal, type Signal } from "@/lib/signal";
import { sql } from "@/lib/db";

export const maxDuration = 30;

/**
 * POST { tickers: string[] } → { signals: { [tk]: Signal } }
 * Computes a technical drop-probability signal for each ticker.
 * Falls back to ml_signals table when uploaded scores exist (Python override).
 */
export async function POST(req: Request) {
  const { tickers } = await req.json().catch(() => ({}));
  if (!Array.isArray(tickers) || !tickers.length)
    return NextResponse.json({ signals: {} });

  const upper = tickers.map((t: string) => String(t).toUpperCase());

  // 1) Pull Python-uploaded overrides first
  const overrides: Record<string, number> = {};
  try {
    const r = await sql`SELECT ticker, drop_probability FROM ml_signals
      WHERE ticker = ANY(${upper as any})`;
    for (const row of r.rows) overrides[row.ticker] = Number(row.drop_probability);
  } catch {}

  // 2) Fetch charts + compute signals for the rest, in chunks
  const out: Record<string, Signal & { source?: "py" }> = {};
  const needs = upper.filter(t => overrides[t] == null);
  for (let i = 0; i < needs.length; i += 12) {
    const slice = needs.slice(i, i + 12);
    const charts = await Promise.all(slice.map(t => getChart(t, "3mo")));
    charts.forEach((c, j) => {
      const sig = computeSignal(c);
      if (sig) out[slice[j]] = sig;
    });
  }
  for (const tk of upper) {
    if (overrides[tk] != null) {
      // Wrap the override into the Signal shape so the UI looks the same.
      out[tk] = {
        dropProb: overrides[tk],
        rsi: NaN, ma20Position: "above", ma50Position: "above",
        momentum1m: NaN,
        recommendation: overrides[tk] <= 0.35 ? "BUY" : overrides[tk] >= 0.65 ? "SELL" : "HOLD",
        source: "py",
      };
    }
  }

  return NextResponse.json({ signals: out });
}
