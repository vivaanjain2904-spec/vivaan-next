import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession, getUserSettings } from "@/lib/auth";
import { alpacaBuy, alpacaPositions, alpacaPing } from "@/lib/alpaca";

export const maxDuration = 300;

/**
 * One-time broker sync: places paper orders on Alpaca so the broker account
 * mirrors the positions Vaelor's DB already holds. Use after connecting a
 * fresh Alpaca account to an app account that already has positions (the
 * reconcile cron flags every position as drift until the two sides match).
 *
 * Only buys the MISSING quantity per ticker (db qty − broker qty), so it's
 * safe to re-run; already-synced tickers are skipped. Never sells.
 *
 * GET returns a dry-run preview. POST executes the orders.
 */
export async function GET() { return run(false); }
export async function POST() { return run(true); }

async function run(execute: boolean) {
  const s = await requireSession();
  const u: any = await getUserSettings(s.uid);
  if (!u?.alpaca_key || !u?.alpaca_secret)
    return NextResponse.json({ error: "Alpaca keys not set" }, { status: 400 });

  const creds = {
    key: u.alpaca_key,
    secret: u.alpaca_secret,
    mode: (u.alpaca_mode === "live" ? "live" : "paper") as "live" | "paper",
  };

  const ping = await alpacaPing(creds);
  if (!ping.ok)
    return NextResponse.json({ error: `Alpaca connection failed: ${ping.error}` }, { status: 502 });

  const broker = await alpacaPositions(creds);
  if (!broker.ok)
    return NextResponse.json({ error: `Alpaca positions fetch failed: ${broker.error}` }, { status: 502 });
  const brokerQty = broker.positions ?? {};

  const posR = await sql`SELECT ticker, qty FROM positions WHERE user_id=${s.uid} AND qty > 0 ORDER BY ticker`;

  const plan: { ticker: string; dbQty: number; brokerQty: number; toBuy: number }[] = [];
  for (const p of posR.rows) {
    const tk = String(p.ticker).toUpperCase();
    const dbQty = Math.floor(Number(p.qty));
    const have = Math.floor(Number(brokerQty[tk] ?? 0));
    const toBuy = dbQty - have;
    if (toBuy > 0) plan.push({ ticker: tk, dbQty, brokerQty: have, toBuy });
  }

  if (!execute) {
    return NextResponse.json({
      ok: true, dryRun: true,
      account: { cash: ping.account?.cash, equity: ping.account?.equity },
      ordersPlanned: plan.length, plan,
      hint: plan.length ? "POST to this endpoint to place these orders." : "Already in sync — nothing to do.",
    });
  }

  const results: any[] = [];
  let placed = 0, failed = 0;
  for (const o of plan) {
    const r = await alpacaBuy(creds, o.ticker, o.toBuy);
    if (r.ok) placed++; else failed++;
    results.push({
      ticker: o.ticker, qty: o.toBuy,
      ok: r.ok, status: r.status, filledQty: r.filledQty,
      orderId: r.orderId, error: r.error,
    });
  }

  return NextResponse.json({
    ok: failed === 0, placed, failed, total: plan.length, results,
    note: "Limit DAY orders — if the market is closed they fill at next open. Re-run GET tomorrow to confirm sync.",
  });
}
