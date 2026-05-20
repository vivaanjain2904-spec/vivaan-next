import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/yfinance";
import { sql } from "@/lib/db";

export const revalidate = 180; // 3-min cache

// Popular cross-sector subset of the universe — fast enough to query live
const POPULAR = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","NFLX",
  "AMD","AVGO","ORCL","CRM","ADBE","INTC","CSCO","QCOM","MU","ARM",
  "JPM","BAC","GS","MS","WFC","V","MA","BRK-B","BLK",
  "WMT","COST","KO","PEP","MCD","NKE","SBUX","DIS","HD","LOW",
  "XOM","CVX","CAT","BA","LMT","GE","UPS","FDX",
  "COIN","HOOD","PLTR","SOFI","UBER","SHOP","ABNB","SNOW","MDB","CRWD","PANW",
  "UNH","JNJ","LLY","PFE","MRK","ABBV","TMO","ABT",
];

export async function GET() {
  const quotes = await getQuotes(POPULAR);
  const arr = Object.values(quotes);

  const gainers = [...arr].sort((a, b) => b.pct - a.pct).slice(0, 10);
  const losers  = [...arr].sort((a, b) => a.pct - b.pct).slice(0, 10);
  const active  = [...arr].sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)).slice(0, 10);

  let ml: any[] = [];
  try {
    const r = await sql`SELECT ticker, drop_probability, price, rsi, return_1m
      FROM ml_signals ORDER BY drop_probability ASC LIMIT 40`;
    ml = r.rows;
  } catch { ml = []; }

  return NextResponse.json({ gainers, losers, active, ml, ts: new Date().toISOString() });
}
