import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession, getUserSettings } from "@/lib/auth";
import { alpacaBuy, alpacaSell, alpacaPositions, alpacaPing, alpacaOpenOrderQty, alpacaAssetInfo } from "@/lib/alpaca";

export const maxDuration = 300;

/**
 * Broker sync: brings the Alpaca account in line with Vaelor's DB positions.
 *
 * - Buy pass: tops up any ticker where Alpaca holds less than the DB (db qty
 *   − broker qty − pending buy qty). Safe to re-run; already-covered tickers
 *   are skipped.
 * - Mirror pass (`?mirror=1`): additionally SELLS any ticker (or excess qty
 *   of a ticker) that Alpaca holds but the DB doesn't, so the two position
 *   lists converge to the same tickers/share-counts. Use this once to align
 *   a broker account that has unrelated legacy holdings.
 *
 * GET returns a dry-run preview. POST executes the orders.
 */
export async function GET(req: Request) { return run(req, false); }
export async function POST(req: Request) { return run(req, true); }

async function run(req: Request, execute: boolean) {
  const s = await requireSession();
  const u: any = await getUserSettings(s.uid);
  if (!u?.alpaca_key || !u?.alpaca_secret)
    return NextResponse.json({ error: "Alpaca keys not set" }, { status: 400 });

  const mirror = new URL(req.url).searchParams.get("mirror") === "1";

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

  // Pending (accepted, unfilled) orders also count as "already covered" —
  // without this, re-running before the market opens would double-order.
  const open = await alpacaOpenOrderQty(creds);
  const pendingBuy = open.ok ? (open.pendingBuy ?? {}) : {};
  const pendingSell = open.ok ? (open.pendingSell ?? {}) : {};

  const posR = await sql`SELECT ticker, qty FROM positions WHERE user_id=${s.uid} AND qty > 0 ORDER BY ticker`;
  const dbQty: Record<string, number> = {};
  for (const p of posR.rows) dbQty[String(p.ticker).trim().toUpperCase()] = Math.floor(Number(p.qty));

  const buyPlan: { ticker: string; dbQty: number; brokerQty: number; pendingQty: number; toBuy: number }[] = [];
  for (const tk of Object.keys(dbQty)) {
    const have = Math.floor(Number(brokerQty[tk] ?? 0)) + Math.floor(Number(pendingBuy[tk] ?? 0));
    const toBuy = dbQty[tk] - have;
    if (toBuy > 0) buyPlan.push({ ticker: tk, dbQty: dbQty[tk], brokerQty: Math.floor(Number(brokerQty[tk] ?? 0)), pendingQty: Math.floor(Number(pendingBuy[tk] ?? 0)), toBuy });
  }

  const sellPlan: { ticker: string; dbQty: number; brokerQty: number; pendingQty: number; toSell: number }[] = [];
  if (mirror) {
    for (const tk of Object.keys(brokerQty)) {
      const want = dbQty[tk] ?? 0;
      const have = Math.floor(Number(brokerQty[tk]));
      const pending = Math.floor(Number(pendingSell[tk] ?? 0));
      const toSell = have - pending - want;
      if (toSell > 0) sellPlan.push({ ticker: tk, dbQty: want, brokerQty: have, pendingQty: pending, toSell });
    }
  }

  if (!execute) {
    return NextResponse.json({
      ok: true, dryRun: true, mirror,
      account: { cash: ping.account?.cash, equity: ping.account?.equity },
      ordersPlanned: buyPlan.length + sellPlan.length,
      buyPlan, sellPlan,
      hint: (buyPlan.length + sellPlan.length) ? "POST to this endpoint (with the same ?mirror= flag) to place these orders." : "Already in sync — nothing to do.",
    });
  }

  const results: any[] = [];
  let placed = 0, failed = 0;

  // "asset not found" is unexpected for an S&P-listed ticker — look up why.
  // Returns notFound=true when Alpaca has no asset record at all (the position
  // can never sync and should be removed from the DB).
  async function diagnoseNotFound(ticker: string, error: string | undefined): Promise<{ error?: string; notFound: boolean }> {
    if (!error || !/not found/i.test(error)) return { error, notFound: false };
    const info = await alpacaAssetInfo(creds, ticker);
    if (info.ok && !info.found) return { error: error + ` (Alpaca has no asset record for "${ticker}" — removing this untradeable position from your portfolio)`, notFound: true };
    if (info.ok && info.found) return { error: error + ` (asset exists on ${info.exchange}, status=${info.status}, tradable=${info.tradable} — order was rejected for a different reason)`, notFound: false };
    return { error, notFound: false };
  }

  // A position Alpaca has no asset record for can never be bought/sold there —
  // close it out in the DB at avg_cost (zero P&L) so it stops blocking sync.
  async function removePhantomPosition(ticker: string): Promise<void> {
    const pr = await sql`SELECT qty, avg_cost FROM positions WHERE user_id=${s.uid} AND ticker=${ticker}`;
    const row = pr.rows[0];
    if (!row) return;
    const qty = Number(row.qty), avgCost = Number(row.avg_cost);
    await sql`UPDATE users SET cash = cash + ${qty * avgCost} WHERE id=${s.uid}`;
    await sql`DELETE FROM positions WHERE user_id=${s.uid} AND ticker=${ticker}`;
    await sql`INSERT INTO trades (user_id, ticker, side, qty, price) VALUES (${s.uid}, ${ticker}, 'SELL', ${qty}, ${avgCost})`;
  }

  // Sell first to free up buying power for the buy pass.
  for (const o of sellPlan) {
    const r = await alpacaSell(creds, o.ticker, o.toSell);
    const submitted = r.ok || (!!r.orderId && !["rejected", "canceled", "expired"].includes(String(r.status)));
    if (submitted) placed++; else failed++;
    const error = submitted ? undefined : (await diagnoseNotFound(o.ticker, r.error)).error;
    results.push({ ticker: o.ticker, side: "sell", qty: o.toSell, ok: submitted, status: r.status, filledQty: r.filledQty, orderId: r.orderId, error });
  }

  for (const o of buyPlan) {
    const r = await alpacaBuy(creds, o.ticker, o.toBuy);
    // An accepted order that hasn't filled yet (market closed) is still a
    // success for sync purposes — r.ok is fill-based, so also accept any
    // submitted order id with a non-rejected status.
    const submitted = r.ok || (!!r.orderId && !["rejected", "canceled", "expired"].includes(String(r.status)));
    if (submitted) placed++; else failed++;
    let error: string | undefined;
    let removed = false;
    if (!submitted) {
      const diag = await diagnoseNotFound(o.ticker, r.error);
      error = diag.error;
      if (diag.notFound) { await removePhantomPosition(o.ticker); removed = true; }
    }
    results.push({ ticker: o.ticker, side: "buy", qty: o.toBuy, ok: submitted, status: r.status, filledQty: r.filledQty, orderId: r.orderId, error, removed });
  }

  return NextResponse.json({
    ok: failed === 0, mirror, placed, failed, total: buyPlan.length + sellPlan.length, results,
    note: "Limit DAY orders — if the market is closed they fill at next open. Re-run GET tomorrow to confirm sync.",
  });
}
