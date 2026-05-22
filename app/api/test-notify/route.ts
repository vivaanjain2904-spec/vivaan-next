import { NextResponse } from "next/server";
import { requireSession, getUserSettings } from "@/lib/auth";
import { alertUser } from "@/lib/ntfy";

export async function POST() {
  const s = await requireSession();
  const u = await getUserSettings(s.uid);
  if (!u) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const configured = {
    ntfy:    !!u.ntfy_topic,
    discord: !!u.discord_webhook,
    email:   !!u.email,
  };
  const hasResendKey = !!process.env.RESEND_API_KEY;

  if (!configured.ntfy && !configured.discord && !configured.email) {
    return NextResponse.json({
      ok: false,
      error: "No notification channel configured. Fill ntfy / Discord / email and hit Save.",
      configured, hasResendKey,
    });
  }

  const results = await alertUser(
    u as any,
    "Vaelor Test 🎉",
    "If you can read this, notifications are working!",
  );

  return NextResponse.json({
    ok: results.every(r => r.ok),
    results, configured, hasResendKey,
  });
}
