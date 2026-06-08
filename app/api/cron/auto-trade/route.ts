import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { getQuotes, getChart, daysUntilEarnings } from "@/lib/yfinance";
import { computeSignal, computeMarketRegime, computeSmartStops, sizingMultiplier } from "@/lib/signal";
import { alertUser } from "@/lib/ntfy";
import { alpacaBuy } from "@/lib/alpaca";

export const maxDuration = 60;

const POOL = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO","ORCL","ADBE","CRM","NFLX","AMD","INTC","QCOM",
  "ASML","TSM","MU","AMAT","LRCX","ARM","ANET",
  "JPM","BAC","WFC","GS","MS","BLK","V","MA","PYPL","SCHW","C","COF","AXP","SPGI",
  "JNJ","UNH","LLY","ABBV","MRK","PFE","TMO","ABT",
  "WMT","COST","HD","NKE","SBUX","MCD","DIS","CMCSA","KO","PEP","PG",
  "XOM","CVX","CAT","BA","GE","UPS","LMT","BX",
  "SHOP","CRWD","SNOW","PLTR","COIN","UBER","ABNB","NOW","INTU","SPOT","DDOG","NET",
];

const FETCH_TIMEOUT_MS = 4500;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(() => { clearTimeout(t); resolve(null); });
  });
}

/**
 * Daily autonomous discovery cron — runs ONCE per day (via GitHub Actions
 * at ~10am ET on weekdays).
 *
 * Auth: requires Authorization: Bearer ${CRON_SECRET}
 *
 * For each user with autonomous_mode=true, runs the same logic as
 * /api/auto-trade/run. Decoupled from the 15-min alert cron because:
 *   - Discovery is slow (chart fetch for many tickers)
 *   - It doesn't need 15-min frequency — daily is enough for new positions
 *   - Sells stay on the 15-min cron for fast risk management
 */
const MAX_CANDIDATES_TO_SCORE = 80;
const STRONG_BUY_THRESHOLD = 0.25;
const MAX_NEW_BUYS_PER_CYCLE = 3;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await initDb().catch(() => {});

  // Only users who opted in
  // Exclude the factor-strategy account — it's managed solely by the monthly
  // factor rebalance, so the old TA buy logic must not touch it.
  const factorAccount = process.env.FACTOR_ACCOUNT_NAME || "Vivaan";
  const usersR = await sql`SELECT id, name, cash, autonomous_mode, auto_scan_universe,
    max_positions, max_pos_pct, cash_reserve_pct, auto_buy_size, ml_threshold,
    alpaca_key, alpaca_secret, auto_trade, ntfy_topic, discord_webhook, email
    FROM users WHERE autonomous_mode = TRUE AND strategy <> 'factor' AND name <> ${factorAccount}`;

  if (!usersR.rows.length) {
    return NextResponse.json({ ok: true, users: 0, msg: "No users with autonomous_mode on." });
  }

  // Bear-regime check happens ONCE per cron tick — share across users
  let regime: "bull" | "bear" | "neutral" = "neutral";
  try {
    const spy = await getChart("SPY", "6mo");
    regime = computeMarketRegime(spy);
  } catch {}

  if (regime === "bear") {
    return NextResponse.json({
      ok: true, regime, users: usersR.rows.length,
      msg: "SPY in bear regime — no new buys for any user.",
    });
  }

  const summary: any[] = [];
  for (const user of usersR.rows) {
    try {
      const res = await runForUser(user as any);
      summary.push({ userId: user.id, ...res });
    } catch (e: any) {
      summary.push({ userId: user.id, error: e?.message ?? "unknown error" });
    }
  }

  return NextResponse.json({
    ok: true, regime, users: usersR.rows.length, summary,
    ts: new Date().toISOString(),
  });
}

async function runForUser(user: any): Promise<any> {
  const pos = await sql`SELECT ticker FROM positions WHERE user_id=${user.id} AND qty > 0`;
  const positionRows = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty > 0`;
  const heldSet = new Set(pos.rows.map((p: any) => p.ticker));
  const openCount = pos.rows.length;
  const maxPositions = Number(user.max_positions) || 15;
  const maxPosPct   = Number(user.max_pos_pct) || 0.08;
  const reservePct  = Number(user.cash_reserve_pct) || 0.15;

  let cash = Number(user.cash);
  let positionValue = 0;
  for (const p of positionRows.rows) positionValue += Number(p.qty) * Number(p.avg_cost);
  const totalEquity = cash + positionValue;
  const maxDeployable = Math.max(0, totalEquity * (1 - reservePct) - positionValue);
  const cashAvailable = Math.min(cash, maxDeployable);

  if (openCount >= maxPositions) return { skipped: "max_positions" };
  if (cashAvailable <= 50) return { skipped: "cash_reserve_protected" };
  if (!user.auto_scan_universe) return { skipped: "scan_disabled" };

  // Use curated POOL instead of full UNIVERSE — Yahoo rate-limits the
  // bulk fetch and we get 0 candidates back. POOL is reliable.
  const candidates = POOL.filter(t => !heldSet.has(t));
  const quoteMap = await getQuotes(candidates);
  const pre = candidates
    .map(t => ({ ticker: t, q: quoteMap[t] }))
    .filter(c => c.q && c.q.price >= 5);

  // Score EVERY candidate that produces a valid signal (no threshold filter).
  // We'll rank by dropProb and just buy the BEST 3 — guarantees the bot
  // always acts, instead of waiting for an absolute threshold that may
  // rarely trip in a bull market.
  const scored: any[] = [];
  const results = await Promise.allSettled(pre.map(async c => {
    const candles = await withTimeout(getChart(c.ticker, "3mo"), FETCH_TIMEOUT_MS);
    if (!candles) return null;
    const sig = computeSignal(candles);
    if (!sig) return null;
    // Skip stocks where the model is bearish (drop prob > 0.55 = avoid)
    if (sig.dropProb > 0.55) return null;
    const smart = computeSmartStops(candles) ?? undefined;
    const daysToER = await withTimeout(daysUntilEarnings(c.ticker), 2000);
    if (daysToER != null && daysToER >= 0 && daysToER <= 3) return null;
    return { ticker: c.ticker, price: c.q.price, dropProb: sig.dropProb, smart };
  }));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) scored.push(r.value);
  }

  if (!scored.length) return { candidates: 0, scanned: pre.length };

  scored.sort((a, b) => a.dropProb - b.dropProb);
  const slotsAvailable = Math.max(0, maxPositions - openCount);
  const buyTarget = Math.min(slotsAvailable, MAX_NEW_BUYS_PER_CYCLE, scored.length);

  const orders: any[] = [];
  let remainingCash = cashAvailable;

  for (let i = 0; i < buyTarget; i++) {
    const pick = scored[i];
    if (remainingCash < pick.price * 1.01) break;

    const baseBudget = (Number(user.auto_buy_size) || 500) * sizingMultiplier(pick.dropProb);
    const maxBudgetForCap = totalEquity * maxPosPct;
    const targetBudget = Math.min(baseBudget, maxBudgetForCap, remainingCash);
    const qty = Math.floor(targetBudget / pick.price);
    if (qty < 1) continue;
    const cost = qty * pick.price;
    if (cost > remainingCash) continue;

    const sl = pick.smart?.stop_loss ?? 0.05;
    const tp = pick.smart?.take_profit ?? 0.10;

    let alpacaOrderId: string | undefined;
    if (user.alpaca_key && user.alpaca_secret) {
      const r = await alpacaBuy({ key: user.alpaca_key, secret: user.alpaca_secret }, pick.ticker, qty);
      if (r.ok) alpacaOrderId = r.orderId;
    }

    try {
      await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
        VALUES (${user.id}, ${pick.ticker}, ${qty}, ${pick.price}, ${sl}, ${tp})
        ON CONFLICT (user_id, ticker) DO UPDATE SET
          qty = positions.qty + ${qty},
          avg_cost = (positions.qty * positions.avg_cost + ${cost}) / (positions.qty + ${qty})`;
      await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${user.id}`;
      await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
        VALUES (${user.id}, ${pick.ticker}, 'BUY', ${qty}, ${pick.price})`;
      remainingCash -= cost;
    } catch { continue; }

    orders.push({ ticker: pick.ticker, qty, price: pick.price, dropProb: pick.dropProb,
                  mode: alpacaOrderId ? "alpaca" : "paper", orderId: alpacaOrderId });

    const title = `🤖 Auto-discovered ${qty} ${pick.ticker}`;
    const body = `Signal ${(pick.dropProb * 100).toFixed(0)}% drop-prob. Cost $${cost.toFixed(2)}.` +
      ` Smart stops: −${(sl*100).toFixed(1)}% / +${(tp*100).toFixed(1)}%.` +
      (alpacaOrderId ? ` Alpaca order ${alpacaOrderId}.` : "");
    await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
      VALUES (${user.id}, ${pick.ticker}, 'auto_discover', ${title}, ${body})`;
    await alertUser(user as any, title, body);
  }

  return { bought: orders.length, candidates: scored.length, orders };
}
