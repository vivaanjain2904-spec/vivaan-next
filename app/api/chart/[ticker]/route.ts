import { NextResponse } from "next/server";
import { getChart } from "@/lib/yfinance";

export const revalidate = 120;

export async function GET(req: Request, { params }: { params: { ticker: string } }) {
  const range = new URL(req.url).searchParams.get("range") ?? "1mo";
  const data = await getChart(params.ticker.toUpperCase(), range);
  return NextResponse.json({ data });
}
