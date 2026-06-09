import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuotes, getChart, daysUntilEarnings, getNews } from "@/lib/yfinance";
import { computeSignal, computeMarketRegime, computeSmartStops, computeTrailingStop, sizingMultiplier } from "@/lib/signal";
import { scoreHeadlines } from "@/lib/sentiment";
import { alertUser } from "@/lib/ntfy";
import { alpacaBuy, alpacaSell } from "@/lib/alpaca";

export const maxDuration = 60;

function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((s, v) => s + v, 0) / n;
  const mb = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ax[i] - ma) * (bx[i] - mb);
    da  += (ax[i] - ma) ** 2;
    db  += (bx[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/* Curated pool of ~60 liquid mega/large-caps. Yahoo Finance rate-limits the
   full 540+ universe under load, but reliably handles ~60. Covers the names
   that actually drive the market anyway. */
const POOL = [
  // Mega tech
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO","ORCL","ADBE","CRM","NFLX","AMD","INTC","QCOM",
  // Semis & infra
  "ASML","TSM","MU","AMAT","LRCX","ARM","ANET","MRVL","KLAC","SNPS","CDNS",
  // Finance
  "JPM","BAC","WFC","GS","MS","BLK","V","MA","PYPL","SCHW","C","COF","AXP","SPGI","ICE","CME","MCO","PGR","TRV",
  // Healthcare
  "JNJ","UNH","LLY","ABBV","MRK","PFE","TMO","ABT","ISRG","BSX","EW","VRTX","REGN","GILD","BMY","CVS","CI","HUM",
  // Consumer discretionary
  "WMT","COST","HD","NKE","SBUX","MCD","DIS","CMCSA","KO","PEP","PG","LOW","TGT","AMZN","BKNG","MAR","HLT","YUM",
  // Energy & industrial
  "XOM","CVX","CAT","BA","GE","UPS","LMT","BX","RTX","HON","MMM","EMR","ETN","SLB","OXY","COP","EOG",
  // Growth / tech
  "SHOP","CRWD","SNOW","PLTR","COIN","UBER","ABNB","NOW","INTU","SPOT","DDOG","NET","ZS","PANW","MDB","GTLB","HUBS","TTD","BILL","IOT",
  // Mid-cap growth
  "CELH","DUOL","APP","RBLX","U","RIVN","LCID","SOFI","HOOD","AFRM","UPST","SQ","TWLO","OKTA","ZM","DOCU","FIVN","APPN",
];

const SECTOR: Record<string, string> = {
  // Tech
  AAPL:"tech",MSFT:"tech",NVDA:"tech",GOOGL:"tech",AMZN:"tech",META:"tech",TSLA:"tech",
  AVGO:"tech",ORCL:"tech",ADBE:"tech",CRM:"tech",NFLX:"tech",AMD:"tech",INTC:"tech",QCOM:"tech",
  ASML:"semis",TSM:"semis",MU:"semis",AMAT:"semis",LRCX:"semis",ARM:"semis",ANET:"tech",
  // Finance
  JPM:"finance",BAC:"finance",WFC:"finance",GS:"finance",MS:"finance",BLK:"finance",
  V:"finance",MA:"finance",PYPL:"finance",SCHW:"finance",C:"finance",COF:"finance",AXP:"finance",SPGI:"finance",
  // Healthcare
  JNJ:"health",UNH:"health",LLY:"health",ABBV:"health",MRK:"health",PFE:"health",TMO:"health",ABT:"health",
  // Consumer
  WMT:"consumer",COST:"consumer",HD:"consumer",NKE:"consumer",SBUX:"consumer",MCD:"consumer",
  DIS:"consumer",CMCSA:"consumer",KO:"consumer",PEP:"consumer",PG:"consumer",
  // Energy/Industrial
  XOM:"energy",CVX:"energy",CAT:"industrial",BA:"industrial",GE:"industrial",UPS:"industrial",LMT:"industrial",BX:"finance",
  // Growth
  SHOP:"tech",CRWD:"tech",SNOW:"tech",PLTR:"tech",COIN:"crypto",UBER:"tech",ABNB:"consumer",
  NOW:"tech",INTU:"tech",SPOT:"tech",DDOG:"tech",NET:"tech",
};

const FETCH_TIMEOUT_MS = 4500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(() => { clearTimeout(t); resolve(null); });
  });
}

/**
 * Fully autonomous buy + sell cycle, end-to-end.
 *
 * Caller: "Run Auto-Trade Cycle" button on Overview.
 * One click does the lot:
 *   A. SELL pass — for every held position:
 *        * Compute fresh signal
 *        * If stop-loss / take-profit / ML threshold trips → sell + alert
 *        * If pos has run >10%, ratchet trailing stop tighter
 *   B. BUY pass — scan ~80 most-promising stocks from the 540+ universe:
 *        * Filter by liquidity (price ≥ $5, vol ≥ 200k)
 *        * Pre-rank by recent weakness
 *        * Multi-factor signal on top 80
 *        * Buy top 3 with conviction-based sizing + safety rails
 *   C. Return combined summary of all actions taken.
 *
 * The 15-min alert cron still runs sells continuously in the background —
 * this button is for triggering the WHOLE cycle on demand, not just buys.
 */
const MAX_CANDIDATES_TO_SCORE = 80;
const STRONG_BUY_THRESHOLD = 0.25;         // loosened — was 0.20, before that 0.15
const MAX_NEW_BUYS_PER_CYCLE = 5;          // fill positions faster (was 3)
const ML_RANK_CANDIDATES = 25;             // how many top model-ranked names to score per cycle

export async function POST() {
  try {
  const s = await requireSession();
  await initDb().catch(() => {});

  const ur = await sql`SELECT id, name, cash, autonomous_mode, auto_scan_universe,
    max_positions, max_pos_pct, cash_reserve_pct, auto_buy_size, ml_threshold,
    alpaca_key, alpaca_secret, auto_trade, ntfy_topic, discord_webhook, email,
    core_ticker, core_pct, peak_equity, circuit_breaker_pct, circuit_breaker_until, strategy
    FROM users WHERE id=${s.uid}`;
  const user = ur.rows[0];
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // Protect the factor-strategy account: the old TA auto-trade must not run here
  // (it would mix strategies). This account is managed by the factor rebalance.
  if (user.strategy === "factor" || user.name === (process.env.FACTOR_ACCOUNT_NAME || "Vivaan")) {
    return NextResponse.json({
      ok: false,
      skipped: "factor_account",
      msg: "This account runs the factor strategy (managed by the monthly factor rebalance). The old auto-trade is disabled here to prevent mixing strategies.",
    });
  }

  if (!user.autonomous_mode) {
    return NextResponse.json({
      ok: false,
      skipped: "autonomous_mode_off",
      msg: "Enable Fully Autonomous Mode in Settings to run.",
    });
  }

  // Current portfolio for safety rails
  const pos = await sql`SELECT ticker, qty, avg_cost, stop_loss, take_profit FROM positions WHERE user_id=${user.id} AND qty > 0`;
  let positions: any[] = pos.rows;
  let heldSet = new Set(positions.map((p: any) => p.ticker));
  const maxPositions = Number(user.max_positions) || 15;
  const maxPosPct = Number(user.max_pos_pct) || 0.08;
  const reservePct = Number(user.cash_reserve_pct) || 0.15;
  const mlThreshold = Number(user.ml_threshold) || 0.65;

  // ── Core-satellite + circuit breaker config ──
  const coreTicker = (user.core_ticker || "VOO").toUpperCase();
  const corePct = Math.max(0, Math.min(0.9, Number(user.core_pct) || 0));   // 0 = off
  const breakerPct = Math.max(0, Number(user.circuit_breaker_pct) || 0);    // 0 = off
  const coreEnabled = corePct > 0;

  // ── Python model override ──────────────────────────────────────────────
  // The cross-sectional model writes percentile-rank drop probabilities to
  // ml_signals (0 = safest in universe, 1 = riskiest). When a ticker has a row
  // here we TRADE on the model's score instead of the on-the-fly TA signal.
  // This is what actually connects the validated Python research to the bot.
  const mlOverride = new Map<string, number>();
  try {
    const r = await sql`SELECT ticker, drop_probability FROM ml_signals
      WHERE updated_at > NOW() - INTERVAL '24 hours'`;
    for (const row of r.rows) mlOverride.set(row.ticker, Number(row.drop_probability));
  } catch {}
  const dropProbFor = (ticker: string, taSignal: { dropProb: number } | null): number | null =>
    mlOverride.has(ticker) ? mlOverride.get(ticker)! : (taSignal?.dropProb ?? null);

  // ═══════════════════════════════════════════════════════════════════════
  //  PASS A — SELL: check every held position for stop/target/ML triggers
  // ═══════════════════════════════════════════════════════════════════════
  const sellOrders: any[] = [];
  let cashChange = 0;

  let heldQuotes: Record<string, { price: number }> = {};
  if (positions.length > 0) {
    const tickers = positions.map((p: any) => p.ticker);
    heldQuotes = await getQuotes(tickers);

    for (const p of positions) {
      // The core index holding is never sold by the model — it's the floor.
      if (coreEnabled && p.ticker === coreTicker) continue;

      const q = heldQuotes[p.ticker];
      if (!q?.price) continue;
      const px = q.price;
      const avg = Number(p.avg_cost);
      if (!avg) continue;

      const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
      const tp = p.take_profit != null ? Number(p.take_profit) : null;
      const stopHit = sl != null && px <= avg * (1 - sl);
      const tgtHit  = tp != null && px >= avg * (1 + tp);

      // Quick ML check via chart
      let mlHit = false;
      let signal: any = null;
      let dp: number | null = null;
      try {
        const candles = await getChart(p.ticker, "3mo");
        signal = computeSignal(candles);
        // Prefer the Python model's score; fall back to TA signal.
        dp = dropProbFor(p.ticker, signal);
        if (dp != null && dp >= mlThreshold) mlHit = true;
      } catch {}

      // Time-based exit: trim 25% if position has been sideways for 90+ days
      let timeHit = false;
      const createdAt = p.created_at ? new Date(p.created_at).getTime() : null;
      const ageInDays = createdAt ? (Date.now() - createdAt) / 86400_000 : 0;
      if (ageInDays >= 90 && dp != null && dp >= 0.45) timeHit = true;

      // News-sentiment RISK OVERLAY (sell-side only, never a buy signal).
      // To bound API calls we only check news for BORDERLINE holdings — model
      // already moderately risky (dp >= 0.50) but not yet a hard ML sell, and
      // not already exiting on stop/target. Strongly negative headlines then
      // escalate to an exit. Being wrong just means selling early.
      let newsHit = false;
      let newsScore: number | null = null;
      if (!stopHit && !tgtHit && !mlHit && dp != null && dp >= 0.50) {
        try {
          const news = await getNews(p.ticker, 8);
          const s = scoreHeadlines(news.map(n => n.title));
          if (s.n >= 3) { newsScore = s.score; if (s.score <= -0.4) newsHit = true; }
        } catch {}
      }

      if (stopHit || tgtHit || mlHit || newsHit || timeHit) {
        const reason = stopHit ? "stop-loss" : tgtHit ? "take-profit" : mlHit ? "ml-signal" : timeHit ? "time-exit" : "negative-news";
        const qty = timeHit && !stopHit && !tgtHit && !mlHit && !newsHit
          ? Math.max(1, Math.floor(Number(p.qty) * 0.25))
          : Number(p.qty);
        const proceeds = qty * px;

        // Alpaca leg
        let alpacaOrderId: string | undefined;
        if (user.alpaca_key && user.alpaca_secret) {
          const r = await alpacaSell({ key: user.alpaca_key, secret: user.alpaca_secret }, p.ticker, qty);
          if (r.ok) alpacaOrderId = r.orderId;
        }

        // Mirror paper
        const isPartial = timeHit && !stopHit && !tgtHit && !mlHit && !newsHit;
        try {
          if (isPartial) {
            const newQty = Number(p.qty) - qty;
            await sql`UPDATE positions SET qty=${newQty} WHERE user_id=${user.id} AND ticker=${p.ticker}`;
          } else {
            await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${p.ticker}`;
          }
          await sql`UPDATE users SET cash = cash + ${proceeds} WHERE id=${user.id}`;
          await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
            VALUES (${user.id}, ${p.ticker}, 'SELL', ${qty}, ${px})`;
          cashChange += proceeds;
        } catch {}

        sellOrders.push({ ticker: p.ticker, qty, price: px, reason,
                          mode: alpacaOrderId ? "alpaca" : "paper", orderId: alpacaOrderId });

        const title = stopHit ? `🔴 Auto-sold ${p.ticker} (stop)` :
                      tgtHit ? `🟢 Auto-sold ${p.ticker} (target)` :
                      mlHit  ? `⚠️ Auto-sold ${p.ticker} (ML)` :
                      timeHit ? `⏱️ Auto-trimmed ${p.ticker} 25% (time-exit)` :
                               `📰 Auto-sold ${p.ticker} (negative news${newsScore != null ? ` ${newsScore.toFixed(2)}` : ""})`;
        const body = `${qty} shares @ $${px.toFixed(2)} · ${reason}` +
          (alpacaOrderId ? ` · Alpaca order ${alpacaOrderId}` : " · paper");
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'auto_sell', ${title}, ${body})`;
        await alertUser(user as any, title, body);
      } else if (signal) {
        // No sell — check trailing stop ratchet
        const pnlFrac = (px - avg) / avg;
        const curSL = p.stop_loss != null ? Number(p.stop_loss) : 0.05;
        const newSL = computeTrailingStop(curSL, pnlFrac);
        if (newSL < curSL - 1e-9) {
          await sql`UPDATE positions SET stop_loss=${newSL}
            WHERE user_id=${user.id} AND ticker=${p.ticker}`;
        }
      }
    }

    // Refresh positions list after sells
    if (sellOrders.length > 0) {
      const refreshed = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty > 0`;
      positions = refreshed.rows;
      heldSet = new Set(positions.map((p: any) => p.ticker));
    }
  }

  // ── Equity at MARKET value (honest drawdown needs live prices, not avg cost) ──
  const mv = (p: any): number => {
    const px = heldQuotes[p.ticker]?.price;
    return Number(p.qty) * (px && px > 0 ? px : Number(p.avg_cost));
  };
  let cash = Number(user.cash) + cashChange;
  let positionValue = positions.reduce((sum, p) => sum + mv(p), 0);
  const totalEquity = cash + positionValue;

  // ── Portfolio circuit breaker ───────────────────────────────────────────
  // High-water mark; if equity falls > breakerPct below it, liquidate the
  // SATELLITE (sell all but the core index) and pause new buys for a cooldown.
  // This is the hard floor on losses.
  const prevPeak = Number(user.peak_equity) || 0;
  const peak = Math.max(prevPeak, totalEquity);
  if (peak > prevPeak) await sql`UPDATE users SET peak_equity=${peak} WHERE id=${user.id}`;
  const breakerUntil = user.circuit_breaker_until ? new Date(user.circuit_breaker_until) : null;
  const inCooldown = breakerUntil != null && breakerUntil.getTime() > Date.now();
  const drawdown = peak > 0 ? (totalEquity - peak) / peak : 0;

  if (breakerPct > 0 && drawdown <= -breakerPct && !inCooldown) {
    const liq: any[] = [];
    for (const p of positions) {
      if (coreEnabled && p.ticker === coreTicker) continue;   // keep the core
      const px = heldQuotes[p.ticker]?.price ?? Number(p.avg_cost);
      const qty = Number(p.qty);
      const proceeds = qty * px;
      if (user.alpaca_key && user.alpaca_secret) {
        try { await alpacaSell({ key: user.alpaca_key, secret: user.alpaca_secret }, p.ticker, qty); } catch {}
      }
      try {
        await sql`DELETE FROM positions WHERE user_id=${user.id} AND ticker=${p.ticker}`;
        await sql`UPDATE users SET cash = cash + ${proceeds} WHERE id=${user.id}`;
        await sql`INSERT INTO trades (user_id, ticker, side, qty, price) VALUES (${user.id}, ${p.ticker}, 'SELL', ${qty}, ${px})`;
        liq.push({ ticker: p.ticker, qty, price: px });
      } catch {}
    }
    const cooldownDays = 7;
    const until = new Date(Date.now() + cooldownDays * 86400_000).toISOString();
    await sql`UPDATE users SET circuit_breaker_until=${until} WHERE id=${user.id}`;
    const title = `🛑 Circuit breaker tripped (${(drawdown * 100).toFixed(1)}% drawdown)`;
    const body = `Liquidated ${liq.length} satellite positions, kept ${coreEnabled ? coreTicker + " core" : "nothing"}. New buys paused ${cooldownDays}d.`;
    try {
      await sql`INSERT INTO notifications (user_id, ticker, kind, title, body) VALUES (${user.id}, NULL, 'circuit_breaker', ${title}, ${body})`;
      await alertUser(user as any, title, body);
    } catch {}
    return NextResponse.json({ ok: true, cycled: true, circuitBreaker: true,
      drawdownPct: drawdown * 100, liquidated: liq, sells: sellOrders, msg: `${title}. ${body}` });
  }
  if (inCooldown) {
    return NextResponse.json({ ok: true, cycled: true, skipped: "circuit_breaker_cooldown",
      until: breakerUntil, sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Circuit-breaker cooldown until ${breakerUntil!.toISOString().slice(0, 10)} — no new buys.` });
  }

  // ── Core rebalance: keep the index core at its target weight ──────────────
  let coreNote: string | null = null;
  if (coreEnabled) {
    const coreTarget = totalEquity * corePct;
    const corePos = positions.find((p: any) => p.ticker === coreTicker);
    const coreVal = corePos ? mv(corePos) : 0;
    const shortfall = coreTarget - coreVal;
    if (shortfall > totalEquity * 0.02) {                 // only act if >2% off target
      try {
        const cq = (await getQuotes([coreTicker]))[coreTicker];
        const cpx = cq?.price;
        if (cpx && cpx > 0) {
          const qty = Math.floor(Math.min(shortfall, cash) / cpx);
          if (qty >= 1) {
            const cost = qty * cpx;
            if (user.alpaca_key && user.alpaca_secret) {
              try { await alpacaBuy({ key: user.alpaca_key, secret: user.alpaca_secret }, coreTicker, qty); } catch {}
            }
            const newQty = (corePos ? Number(corePos.qty) : 0) + qty;
            const newAvg = corePos ? ((Number(corePos.qty) * Number(corePos.avg_cost)) + cost) / newQty : cpx;
            await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost) VALUES (${user.id}, ${coreTicker}, ${qty}, ${cpx})
              ON CONFLICT (user_id, ticker) DO UPDATE SET qty=${newQty}, avg_cost=${newAvg}`;
            await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${user.id}`;
            await sql`INSERT INTO trades (user_id, ticker, side, qty, price) VALUES (${user.id}, ${coreTicker}, 'BUY', ${qty}, ${cpx})`;
            cash -= cost;
            coreNote = `Bought ${qty} ${coreTicker} core ($${cost.toFixed(0)})`;
          }
        }
      } catch {}
    }
    const refreshed = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${user.id} AND qty > 0`;
    positions = refreshed.rows;
    heldSet = new Set(positions.map((p: any) => p.ticker));
  }

  // ── Satellite budget: only the non-core sleeve funds model buys ──
  const isSatellite = (t: string) => !(coreEnabled && t === coreTicker);
  const satelliteValue = positions.filter((p: any) => isSatellite(p.ticker)).reduce((s, p) => s + mv(p), 0);
  const satelliteCap = totalEquity * (1 - corePct) * (1 - reservePct);
  const maxDeployable = Math.max(0, satelliteCap - satelliteValue);
  const cashAvailable = Math.min(cash, maxDeployable);
  const openCount = positions.filter((p: any) => isSatellite(p.ticker)).length;  // core doesn't use a slot

  if (openCount >= maxPositions) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "max_positions_reached",
      open: openCount,
      max: maxPositions,
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Already at max positions (${openCount}/${maxPositions}). No new buys.`,
    });
  }
  if (cashAvailable <= 50) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "cash_below_reserve",
      cash, cashAvailable, sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Cash reserve protected.`,
    });
  }

  // ── Market regime: skip new buys in a bear tape ──
  let regime: "bull" | "bear" | "neutral" = "neutral";
  try {
    const spy = await getChart("SPY", "6mo");
    regime = computeMarketRegime(spy);
  } catch {}
  const regimeThreshold = regime === "bull" ? 0.35 : regime === "neutral" ? 0.28 : 0.20;
  if (regime === "bear") {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "bear_regime",
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. SPY in bear regime — pausing new buys.`,
    });
  }

  // ── Build candidate list from curated 60-stock POOL ──
  // (Was full UNIVERSE but Yahoo Finance rate-limits the bulk fetch.
  //  Curated pool covers ~90% of trade-worthy names with reliable response.)
  if (!user.auto_scan_universe) {
    return NextResponse.json({
      ok: true,
      cycled: true,
      skipped: "scan_disabled",
      sells: sellOrders,
      msg: `Sold ${sellOrders.length}. Universe scan is off — toggle it on in Settings.`,
    });
  }

  // Candidate list: if the Python model has scored the universe, rank ALL its
  // names by safety (lowest percentile rank first) and take the top N — this
  // lets the bot pick from 540+ stocks, not just the curated pool. We only
  // fetch quotes/charts for these top names, so it stays within rate limits.
  // Falls back to the curated POOL when no model scores exist.
  let candidates: string[];
  if (mlOverride.size > 0) {
    candidates = [...mlOverride.entries()]
      .filter(([t]) => !heldSet.has(t))
      .sort((a, b) => a[1] - b[1])          // safest first
      .slice(0, ML_RANK_CANDIDATES)
      .map(([t]) => t);
  } else {
    candidates = POOL.filter(t => !heldSet.has(t));
  }

  // Pull quotes for the small pool — fast and reliable
  const quoteMap = await getQuotes(candidates);
  const quotedCandidates = candidates
    .map(t => ({ ticker: t, q: quoteMap[t] }))
    .filter(c => c.q && c.q.price >= 5);

  // ── Score each candidate (chart fetch + signal) with per-fetch timeout ──
  type Scored = {
    ticker: string; price: number; dropProb: number;
    smart?: { stop_loss: number; take_profit: number };
    daysToER: number | null;
    avgCorr?: number;
  };
  const scored: Scored[] = [];
  // Cache candles during scan so the correlation pass doesn't re-fetch
  const candleCache = new Map<string, any[]>();

  // Score every candidate that has a valid (not-clearly-bearish) signal.
  const results = await Promise.allSettled(
    quotedCandidates.map(async c => {
      const candles = await withTimeout(getChart(c.ticker, "3mo"), FETCH_TIMEOUT_MS);
      if (!candles) return null;
      candleCache.set(c.ticker, candles);
      const sig = computeSignal(candles);
      // Prefer the Python model's score; fall back to TA signal.
      const dropProb = dropProbFor(c.ticker, sig);
      if (dropProb == null) return null;
      if (dropProb > 0.55) return null; // skip clearly bearish names
      const smart = computeSmartStops(candles) ?? undefined;
      const daysToER = await withTimeout(daysUntilEarnings(c.ticker), 2000);
      if (daysToER != null && daysToER >= 0 && daysToER <= 14) return null;
      return {
        ticker: c.ticker, price: c.q.price, dropProb,
        smart, daysToER,
      } as Scored;
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) scored.push(r.value);
  }

  // ── Rank by strongest signal (lowest dropProb) and buy top N ──
  scored.sort((a, b) => a.dropProb - b.dropProb);
  const qualified = scored.filter(s => s.dropProb <= regimeThreshold);

  // Re-rank by correlation-adjusted score: prefer low correlation to current holdings
  // Uses cached candles — no extra HTTP fetches.
  if (positions.length > 0) {
    const topHeld = positions.slice(0, 3);
    const heldCandles = await Promise.all(
      topHeld.map(p =>
        candleCache.get(p.ticker)
          ? Promise.resolve(candleCache.get(p.ticker)!)
          : getChart(p.ticker, "3mo").catch(() => [] as any[])
      )
    );
    const heldCloses = heldCandles.map(c => c.map((x: any) => x.c));

    for (const s of qualified) {
      const candles = candleCache.get(s.ticker) ?? [];
      const closes = candles.map((x: any) => x.c);
      const corrs = heldCloses.map(hc => Math.abs(pearsonCorr(closes, hc)));
      s.avgCorr = corrs.length ? corrs.reduce((a, b) => a + b, 0) / corrs.length : 0;
    }
    // Combined rank: 70% signal, 30% diversification
    qualified.sort((a, b) => {
      const scoreA = a.dropProb * 0.7 + (a.avgCorr ?? 0) * 0.3;
      const scoreB = b.dropProb * 0.7 + (b.avgCorr ?? 0) * 0.3;
      return scoreA - scoreB;
    });
  }

  const slotsAvailable = Math.max(0, maxPositions - openCount);
  const buyTarget = Math.min(slotsAvailable, MAX_NEW_BUYS_PER_CYCLE, qualified.length);

  const orders: any[] = [];
  let remainingCash = cashAvailable;
  const boughtSectors = new Set<string>();

  for (let i = 0; i < buyTarget; i++) {
    const pick = qualified[i];
    if (remainingCash < pick.price * 1.01) break;

    const sector = SECTOR[pick.ticker] ?? pick.ticker;
    if (boughtSectors.has(sector)) continue;

    // Position size: conviction-multiplied base, capped by max_pos_pct of total equity
    const baseBudget = (Number(user.auto_buy_size) || 500) * sizingMultiplier(pick.dropProb);
    const maxBudgetForCap = totalEquity * maxPosPct;
    const targetBudget = Math.min(baseBudget, maxBudgetForCap, remainingCash);
    const qty = Math.floor(targetBudget / pick.price);
    if (qty < 1) continue;
    const cost = qty * pick.price;
    if (cost > remainingCash) continue;

    // Stops/targets: smart ATR-based when available, fallback to 5% / 10%
    const sl = pick.smart?.stop_loss ?? 0.05;
    const tp = pick.smart?.take_profit ?? 0.10;

    // Optional Alpaca leg
    let alpacaOrderId: string | undefined, alpacaErr: string | undefined;
    if (user.alpaca_key && user.alpaca_secret) {
      const r = await alpacaBuy(
        { key: user.alpaca_key, secret: user.alpaca_secret }, pick.ticker, qty);
      if (r.ok) alpacaOrderId = r.orderId; else alpacaErr = r.error;
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
    } catch (e: any) {
      orders.push({ ticker: pick.ticker, ok: false, error: e?.message ?? "DB error" });
      continue;
    }

    boughtSectors.add(sector);

    orders.push({
      ticker: pick.ticker, ok: true, qty, price: pick.price,
      cost, dropProb: pick.dropProb,
      mode: alpacaOrderId ? "alpaca" : (alpacaErr ? "paper-only" : "paper"),
      orderId: alpacaOrderId,
    });

    const title = `🤖 Auto-discovered ${qty} ${pick.ticker}`;
    const body = `Signal ${(pick.dropProb * 100).toFixed(0)}% drop-prob (strong buy).` +
      ` Cost $${cost.toFixed(2)}. Smart stops: −${(sl * 100).toFixed(1)}% / +${(tp * 100).toFixed(1)}%.` +
      (alpacaOrderId ? ` Alpaca order ${alpacaOrderId}.` : " (paper-only).");
    await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
      VALUES (${user.id}, ${pick.ticker}, 'auto_discover', ${title}, ${body})`;
    await alertUser(user as any, title, body);
  }

  const boughtCount = orders.filter(o => o.ok).length;
  return NextResponse.json({
    ok: true,
    cycled: true,
    scanned: quotedCandidates.length,
    candidates: qualified.length,
    bought: boughtCount,
    sold: sellOrders.length,
    regime,
    orders,
    sells: sellOrders,
    core: coreEnabled ? { ticker: coreTicker, targetPct: corePct, action: coreNote } : null,
    circuitBreaker: { pct: breakerPct, peak, drawdownPct: drawdown * 100 },
    usedModel: mlOverride.size > 0,
    safetyRails: {
      maxPositions, openBefore: openCount,
      maxPosPct, reservePct,
      maxNewBuys: MAX_NEW_BUYS_PER_CYCLE,
      threshold: STRONG_BUY_THRESHOLD,
    },
    msg: [
      coreNote,
      sellOrders.length > 0 ? `Sold ${sellOrders.length}` : null,
      boughtCount > 0 ? `Bought ${boughtCount}` : (qualified.length ? `${qualified.length} candidates didn't fit sizing rules` : null),
    ].filter(Boolean).join(" · ") || "No actions this cycle.",
  });
  } catch (e: any) {
    // requireSession throws a Response on no/expired session — surface it as a
    // clean, readable message instead of an opaque Next.js 500 with empty body.
    if (e instanceof Response || (e && typeof e.status === "number" && e.status === 401)) {
      return NextResponse.json(
        { ok: false, error: "Not signed in (session expired). Please log out and back in, then retry." },
        { status: 401 });
    }
    console.error("[auto-trade] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: `Auto-trade failed: ${e?.message ?? String(e)}` },
      { status: 500 });
  }
}
