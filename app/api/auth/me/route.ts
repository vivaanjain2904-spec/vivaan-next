import { NextResponse } from "next/server";
import { readSession, getUserSettings } from "@/lib/auth";

export async function GET() {
  const s = await readSession();
  if (!s) return NextResponse.json({ user: null });
  const u = await getUserSettings(s.uid);
  return NextResponse.json({ user: u });
}
