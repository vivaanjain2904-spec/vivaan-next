import { NextResponse } from "next/server";
import { UNIVERSE } from "@/lib/universe";

export const dynamic = "force-static";
export async function GET() {
  return NextResponse.json({ universe: UNIVERSE });
}
