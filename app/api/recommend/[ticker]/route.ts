import { NextResponse } from "next/server";
import { getChart } from "@/lib/yfinance";
import { computeRecommendation } from "@/lib/signal";

export const revalidate = 300;

/** GET /api/recommend/[ticker] → recommended setup (stops, target, review period). */
export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const candles = await getChart(params.ticker.toUpperCase(), "3mo");
  const rec = computeRecommendation(candles);
  if (!rec) return NextResponse.json({ error: "not enough data" }, { status: 502 });
  return NextResponse.json(rec);
}
