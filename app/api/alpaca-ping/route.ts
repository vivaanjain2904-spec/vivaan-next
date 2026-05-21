import { NextResponse } from "next/server";
import { requireSession, getUserSettings } from "@/lib/auth";
import { alpacaPing } from "@/lib/alpaca";

export async function POST() {
  const s = await requireSession();
  const u: any = await getUserSettings(s.uid);
  if (!u?.alpaca_key || !u?.alpaca_secret)
    return NextResponse.json({ error: "Alpaca keys not set" }, { status: 400 });
  const r = await alpacaPing({ key: u.alpaca_key, secret: u.alpaca_secret });
  return NextResponse.json(r);
}
