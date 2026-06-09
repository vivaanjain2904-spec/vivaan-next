import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession, getUserSettings } from "@/lib/auth";
import { alpacaBuy, alpacaPositions, alpacaPing, alpacaOpenBuyQty } from "@/lib/alpaca";

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

  // Pending (accepted, unfilled) buy orders also count as "already covered" —
  // without this, re-running before the market opens would double-order.
  const open = await alpacaOpenBuyQty(creds);
  const pendingQty = open.ok ? (open.pending ?? {}) : {};

  const posR = await sql`SELECT ticker, qty FROM positions WHERE user_id=${s.uid} AND qty > 0 ORDER BY ticker`;

  const plan: { ticker: string; dbQty: number; brokerQty: number; pendingQty: number; toBuy: number }[] = [];
  for (const p of posR.rows) {
    const tk = String(p.ticker).toUpperCase();
    const dbQty = Math.floor(Number(p.qty));
    const have = Math.floor(Number(brokerQty[tk] ?? 0)) + Math.floor(Number(pendingQty[tk] ?? 0));
    const toBuy = dbQty - have;
    if (toBuy > 0) plan.push({ ticker: tk, dbQty, brokerQty: Math.floor(Number(brokerQty[tk] ?? 0)), pendingQty: Math.floor(Number(pendingQty[tk] ?? 0)), toBuy });
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
    // An accepted order that hasn't filled yet (market closed) is still a
    // success for sync purposes — r.ok is fill-based, so also accept any
    // submitted order id with a non-rejected status.
    const submitted = r.ok || (!!r.orderId && !["rejected", "canceled", "expired"].includes(String(r.status)));
    if (submitted) placed++; else failed++;
    results.push({
      ticker: o.ticker, qty: o.toBuy,
      ok: submitted, status: r.status, filledQty: r.filledQty,
      orderId: r.orderId, error: submitted ? undefined : r.error,
    });
  }

  return NextResponse.json({
    ok: failed === 0, placed, failed, total: plan.length, results,
    note: "Limit DAY orders — if the market is closed they fill at next open. Re-run GET tomorrow to confirm sync.",
  });
}
