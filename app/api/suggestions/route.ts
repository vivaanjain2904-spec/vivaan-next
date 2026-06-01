import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes } from "@/lib/yfinance";

export const maxDuration = 30;

/**
 * GET /api/suggestions
 * SUGGEST-MODE (legally safe): computes recommended trades toward the latest
 * factor target for the LOGGED-IN user and returns them with entry/exit prices.
 * It does NOT execute anything — the user reviews and approves each trade in the
 * UI. No discretionary trading = no RIA/broker-dealer registration required.
 *
 * Each suggestion includes: side, ticker, qty, est. price, target weight, and a
 * plain-English reason + recommended stop-loss / take-profit levels.
 */
const STOP_LOSS_PCT = 0.08;   // suggested protective stop
const TAKE_PROFIT_PCT = 0.16; // suggested target
const MIN_TRADE = 50;

export async function GET() {
  try {
    const s = await requireSession();
    await initDb().catch(() => {});

    const ur = await sql`SELECT id, name, cash FROM users WHERE id=${s.uid}`;
    const user = ur.rows[0];
    if (!user) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });

    const tgtR = await sql`SELECT as_of, regime, exposure, targets FROM factor_targets ORDER BY id DESC LIMIT 1`;
    if (!tgtR.rows.length) {
      return NextResponse.json({ ok: true, suggestions: [], note: "No strategy target available yet." });
    }
    const tgt = tgtR.rows[0];
    const targets: Record<string, number> = typeof tgt.targets === "string" ? JSON.parse(tgt.targets) : tgt.targets;
    const tgtTickers = Object.keys(targets);

    const posR = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty>0`;
    const held: Record<string, { qty: number; avg: number }> = {};
    for (const p of posR.rows) held[p.ticker.toUpperCase()] = { qty: Number(p.qty), avg: Number(p.avg_cost) };

    const allTickers = Array.from(new Set([...tgtTickers, ...Object.keys(held)]));
    const quotes = await getQuotes(allTickers);

    let cash = Number(user.cash);
    let posVal = 0;
    for (const [t, h] of Object.entries(held)) { const px = quotes[t]?.price; if (px) posVal += h.qty * px; }
    const equity = cash + posVal;

    type Sug = { side: "BUY" | "SELL"; ticker: string; qty: number; price: number;
      reason: string; stop_loss?: number; take_profit?: number; targetWeightPct?: number };
    const sells: Sug[] = [];
    const buys: Sug[] = [];

    // SELL: anything held but not in the target
    for (const [t, h] of Object.entries(held)) {
      if (tgtTickers.includes(t)) continue;
      const px = quotes[t]?.price;
      if (!px) continue;
      sells.push({ side: "SELL", ticker: t, qty: h.qty, price: px,
        reason: "No longer in the strategy's target portfolio — exit to free capital." });
    }

    // BUY / trim toward target weight
    for (const t of tgtTickers) {
      const px = quotes[t]?.price;
      if (!px || px <= 0) continue;
      const targetDollars = Number(targets[t]) * equity;
      const cur = held[t]?.qty ?? 0;
      const delta = targetDollars - cur * px;
      if (Math.abs(delta) < MIN_TRADE) continue;
      const shares = Math.floor(Math.abs(delta) / px);
      if (shares < 1) continue;
      const wPct = +(Number(targets[t]) * 100).toFixed(1);
      if (delta > 0) {
        buys.push({ side: "BUY", ticker: t, qty: shares, price: px,
          targetWeightPct: wPct,
          reason: `Top momentum + low-volatility pick — target ${wPct}% of portfolio.`,
          stop_loss: +(px * (1 - STOP_LOSS_PCT)).toFixed(2),
          take_profit: +(px * (1 + TAKE_PROFIT_PCT)).toFixed(2) });
      } else {
        sells.push({ side: "SELL", ticker: t, qty: Math.min(shares, cur), price: px,
          targetWeightPct: wPct,
          reason: `Trim back to target weight (${wPct}%).` });
      }
    }

    return NextResponse.json({
      ok: true,
      asOf: tgt.as_of,
      regime: tgt.regime,
      exposurePct: +(Number(tgt.exposure) * 100).toFixed(0),
      equity: +equity.toFixed(2),
      cash: +cash.toFixed(2),
      suggestions: [...sells, ...buys],
      counts: { sell: sells.length, buy: buys.length },
    });
  } catch (e: any) {
    if (e instanceof Response) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
