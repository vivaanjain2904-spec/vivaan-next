import { NextResponse } from "next/server";
import { readSession, getUserSettings } from "@/lib/auth";
import { initDb } from "@/lib/db";

export async function GET() {
  const s = await readSession();
  if (!s) return NextResponse.json({ user: null });
  // Idempotently run pending migrations (new columns like `email`) before SELECT.
  await initDb().catch(() => {});
  const u = await getUserSettings(s.uid);
  return NextResponse.json({ user: u });
}
