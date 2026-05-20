import { NextResponse } from "next/server";
import { requireSession, getUserSettings } from "@/lib/auth";
import { alertUser } from "@/lib/ntfy";

export async function POST() {
  const s = await requireSession();
  const u = await getUserSettings(s.uid);
  if (!u) return NextResponse.json({ error: "user not found" }, { status: 404 });
  await alertUser(u as any, "Vivaan.io Test 🎉", "Notifications are working!");
  return NextResponse.json({ ok: true });
}
