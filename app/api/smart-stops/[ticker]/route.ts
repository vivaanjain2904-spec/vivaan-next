import { NextResponse } from "next/server";
import { getChart } from "@/lib/yfinance";
import { computeSmartStops } from "@/lib/signal";

export const revalidate = 300;

/** GET /api/smart-stops/[ticker] → ATR-based stop_loss & take_profit fractions. */
export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const candles = await getChart(params.ticker.toUpperCase(), "3mo");
  const stops = computeSmartStops(candles);
  if (!stops) return NextResponse.json({ error: "not enough data" }, { status: 502 });
  return NextResponse.json(stops);
}
