import { NextResponse } from "next/server";
import { UNIVERSE } from "@/lib/universe";
import names from "@/lib/universe-names.json";

export const dynamic = "force-static";
export async function GET() {
  // Each item: { t: ticker, n: human-readable company name }.
  // We keep the original ticker-only `universe` array on top so any legacy
  // callers expecting string[] keep working.
  const items = UNIVERSE.map(t => ({
    t,
    n: (names as Record<string, string>)[t] ?? "",
  }));
  return NextResponse.json({ universe: UNIVERSE, items });
}
