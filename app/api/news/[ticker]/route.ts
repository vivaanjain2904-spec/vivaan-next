import { NextResponse } from "next/server";
import { getNews } from "@/lib/yfinance";

export const revalidate = 300;

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const items = await getNews(params.ticker.toUpperCase());
  return NextResponse.json({ items });
}
