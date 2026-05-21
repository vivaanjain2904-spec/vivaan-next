import { NextResponse } from "next/server";
import { getChart } from "@/lib/yfinance";
import { backtest } from "@/lib/backtest";

export const maxDuration = 30;

/** GET /api/backtest/[ticker]?cash=10000&range=2y&threshold=0.65&smart=1 */
export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const url = new URL(req.url);
  const cash   = Number(url.searchParams.get("cash") ?? 10000);
  const range  = url.searchParams.get("range") ?? "2y";
  const thr    = Number(url.searchParams.get("threshold") ?? 0.65);
  const smart  = url.searchParams.get("smart") !== "0";

  const candles = await getChart(params.ticker.toUpperCase(), range);
  if (candles.length < 60)
    return NextResponse.json({ error: "Not enough history for backtest" }, { status: 400 });

  const result = backtest(params.ticker.toUpperCase(), candles, cash, thr, smart);
  return NextResponse.json(result);
}
