import { NextResponse } from "next/server";
import { getQuote } from "@/lib/yfinance";

export const revalidate = 60;

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const q = await getQuote(params.ticker.toUpperCase());
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(q);
}
