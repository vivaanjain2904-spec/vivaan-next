import { NextResponse } from "next/server";
import { requireAdmin, getUserSettings } from "@/lib/auth";
import { getBarsBulk } from "@/lib/yfinance";
import { calibrateThresholds } from "@/lib/thresholds";
import { UNIVERSE } from "@/lib/universe";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/threshold-calibration?days=730&horizon=10&step=5&trainFrac=0.6&limit=200
 *
 * Buy/Sell dropProb threshold calibration (see lib/thresholds.ts): scans
 * candidate cutoffs on a chronological train window for expected value per
 * trade, then reports how the train-optimal and current live thresholds
 * (0.35/0.65) perform on the held-out test window. Admin-only; CRON_SECRET
 * bearer accepted.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const viaCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  let adminUid: number | null = null;
  if (!viaCron) {
    try { adminUid = (await requireAdmin()).uid; } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const days      = Math.min(730, Math.max(120, Number(url.searchParams.get("days")) || 365));
  const horizon   = Math.min(60,  Math.max(1,   Number(url.searchParams.get("horizon")) || 10));
  const step      = Math.min(20,  Math.max(1,   Number(url.searchParams.get("step")) || 5));
  const trainFrac = Math.min(0.9, Math.max(0.3, Number(url.searchParams.get("trainFrac")) || 0.6));
  const limit     = Math.min(UNIVERSE.length, Math.max(10, Number(url.searchParams.get("limit")) || UNIVERSE.length));

  let creds: { key: string; secret: string } | undefined;
  if (adminUid != null) {
    const u: any = await getUserSettings(adminUid).catch(() => null);
    if (u?.alpaca_key && u?.alpaca_secret) creds = { key: u.alpaca_key, secret: u.alpaca_secret };
  }

  const tickers = UNIVERSE.slice(0, limit).map(t => t.toUpperCase());
  const barsMap = await getBarsBulk(tickers, days, creds);
  if (!Object.keys(barsMap).length) {
    return NextResponse.json({
      error: "no bar data — set ALPACA_DATA_KEY/ALPACA_DATA_SECRET env vars, or save your Alpaca keys in Settings",
    }, { status: 502 });
  }

  const result = calibrateThresholds(barsMap, horizon, step, trainFrac);
  return NextResponse.json({ ok: true, days, ...result });
}
