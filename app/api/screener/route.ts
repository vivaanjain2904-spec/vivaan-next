import { NextResponse } from "next/server";
import { getQuote, type Quote } from "@/lib/yfinance";
import { UNIVERSE } from "@/lib/universe";
import { sql } from "@/lib/db";

export const dynamic    = "force-dynamic";   // never prerender at build
export const revalidate = 300;               // 5-min cache between live calls
export const maxDuration = 60;               // allow up to 60s on Vercel Pro

/** Fetch quotes in concurrent chunks so we don't hammer Yahoo (or our function). */
async function chunkFetchQuotes(tickers: string[], chunkSize = 25): Promise<Quote[]> {
  const out: Quote[] = [];
  for (let i = 0; i < tickers.length; i += chunkSize) {
    const slice = tickers.slice(i, i + chunkSize);
    const results = await Promise.all(slice.map(t => getQuote(t).catch(() => null)));
    for (const q of results) if (q) out.push(q);
  }
  return out;
}

export async function GET() {
  const arr = await chunkFetchQuotes(UNIVERSE);

  const gainers = [...arr].filter(q => q.pct != null).sort((a, b) => b.pct - a.pct).slice(0, 25);
  const losers  = [...arr].filter(q => q.pct != null).sort((a, b) => a.pct - b.pct).slice(0, 25);
  const active  = [...arr].sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 25);
  const all     = [...arr].sort((a, b) => a.ticker.localeCompare(b.ticker));

  let ml: any[] = [];
  try {
    const r = await sql`SELECT ticker, drop_probability, price, rsi, return_1m
      FROM ml_signals ORDER BY drop_probability ASC LIMIT 50`;
    ml = r.rows;
  } catch { ml = []; }

  return NextResponse.json({
    gainers, losers, active, all, ml,
    scanned: arr.length,
    universe: UNIVERSE.length,
    ts: new Date().toISOString(),
  });
}
