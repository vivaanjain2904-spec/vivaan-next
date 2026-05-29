import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";

export const maxDuration = 30;

/**
 * POST /api/admin/factor-target
 * Secure upload endpoint for the research pipeline's daily target portfolio.
 * Protected by ADMIN_UPLOAD_SECRET (Bearer) — so the Python side can write to
 * the production DB without ever holding a raw DB credential.
 *
 * Body: { as_of: "YYYY-MM-DD", regime: "risk_on"|"risk_off",
 *         exposure: number, targets: { TICKER: weight, ... } }
 */
export async function POST(req: Request) {
  const secret = process.env.ADMIN_UPLOAD_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "ADMIN_UPLOAD_SECRET not configured on server" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  const { as_of, regime, exposure, targets } = body || {};
  if (!as_of || typeof exposure !== "number" || !targets || typeof targets !== "object" || !Object.keys(targets).length) {
    return NextResponse.json({ ok: false, error: "missing/invalid fields (need as_of, exposure, targets)" }, { status: 400 });
  }
  // Normalize tickers + clamp weights to [0,1]
  const clean: Record<string, number> = {};
  for (const [t, w] of Object.entries(targets)) {
    const wn = Number(w);
    if (Number.isFinite(wn) && wn > 0) clean[String(t).toUpperCase()] = Math.min(1, wn);
  }
  if (!Object.keys(clean).length) {
    return NextResponse.json({ ok: false, error: "no valid target weights" }, { status: 400 });
  }

  try {
    await initDb().catch(() => {});
    await sql`INSERT INTO factor_targets (as_of, regime, exposure, targets)
      VALUES (${as_of}, ${regime ?? null}, ${exposure}, ${JSON.stringify(clean)}::jsonb)`;
    return NextResponse.json({
      ok: true, as_of, regime, exposure,
      n_targets: Object.keys(clean).length,
      msg: `Stored target: ${Object.keys(clean).length} names, ${(exposure * 100).toFixed(0)}% invested (${regime}).`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
