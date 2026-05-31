import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { getQuotes } from "@/lib/yfinance";

export const maxDuration = 60;

/**
 * Records ONE daily point of the factor strategy's live track record vs SPY.
 * Forward-only (no backtest backfill) — both series start at 100 on day one,
 * so the public curve is an honest, dated, out-of-sample record.
 *
 * Method: the strategy's daily return = equal-weight return of the latest
 * factor target's holdings, scaled by its exposure (cash earns 0). SPY's daily
 * return tracks the index. Each is compounded into its NAV.
 *
 * Auth: ADMIN_UPLOAD_SECRET or CRON_SECRET (Bearer). GET = POST (for Vercel cron).
 */
function authed(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const a = process.env.ADMIN_UPLOAD_SECRET, c = process.env.CRON_SECRET;
  return (!!a && auth === `Bearer ${a}`) || (!!c && auth === `Bearer ${c}`);
}

export async function GET(req: Request) { return POST(req); }

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    await initDb().catch(() => {});
    const today = new Date().toISOString().slice(0, 10);

    // Skip if already recorded today (idempotent)
    const existing = await sql`SELECT as_of FROM strategy_nav WHERE as_of=${today}`;
    if (existing.rows.length) {
      return NextResponse.json({ ok: true, skipped: "already recorded today", as_of: today });
    }

    const tgtR = await sql`SELECT regime, exposure, targets FROM factor_targets ORDER BY id DESC LIMIT 1`;
    if (!tgtR.rows.length) return NextResponse.json({ ok: false, error: "no factor target yet" }, { status: 400 });
    const tgt = tgtR.rows[0];
    const targets: Record<string, number> = typeof tgt.targets === "string" ? JSON.parse(tgt.targets) : tgt.targets;
    const tickers = Object.keys(targets);
    const exposure = Number(tgt.exposure);

    // Need prior NAV + we store yesterday's close per ticker to compute daily return.
    const prev = await sql`SELECT strategy_nav, spy_nav FROM strategy_nav ORDER BY as_of DESC LIMIT 1`;
    const prevPx = await sql`SELECT ticker, price FROM nav_prices`;
    const prevMap: Record<string, number> = {};
    for (const r of prevPx.rows) prevMap[r.ticker] = Number(r.price);

    // Current prices for basket + SPY
    const quotes = await getQuotes([...tickers, "SPY"]);
    const curSpy = quotes["SPY"]?.price;

    // First-ever run: seed both NAVs at 100, store today's prices, done.
    if (!prev.rows.length || !Object.keys(prevMap).length) {
      await sql`INSERT INTO strategy_nav (as_of, strategy_nav, spy_nav, regime)
        VALUES (${today}, 100, 100, ${tgt.regime ?? null})`;
      for (const t of tickers) {
        const px = quotes[t]?.price;
        if (px) await sql`INSERT INTO nav_prices (ticker, price) VALUES (${t}, ${px})
          ON CONFLICT (ticker) DO UPDATE SET price=${px}`;
      }
      if (curSpy) await sql`INSERT INTO nav_prices (ticker, price) VALUES ('SPY', ${curSpy})
        ON CONFLICT (ticker) DO UPDATE SET price=${curSpy}`;
      return NextResponse.json({ ok: true, seeded: true, as_of: today, strategy_nav: 100, spy_nav: 100 });
    }

    // Strategy daily return = equal-weight mean of holding returns × exposure
    let sumRet = 0, n = 0;
    for (const t of tickers) {
      const now = quotes[t]?.price, was = prevMap[t];
      if (now && was && was > 0) { sumRet += (now / was - 1); n++; }
    }
    const stratRet = n ? (sumRet / n) * exposure : 0;
    const spyRet = (curSpy && prevMap["SPY"] > 0) ? (curSpy / prevMap["SPY"] - 1) : 0;

    const newStrat = Number(prev.rows[0].strategy_nav) * (1 + stratRet);
    const newSpy = Number(prev.rows[0].spy_nav) * (1 + spyRet);

    await sql`INSERT INTO strategy_nav (as_of, strategy_nav, spy_nav, regime)
      VALUES (${today}, ${newStrat}, ${newSpy}, ${tgt.regime ?? null})`;

    // Update stored prices for next diff
    for (const t of tickers) {
      const px = quotes[t]?.price;
      if (px) await sql`INSERT INTO nav_prices (ticker, price) VALUES (${t}, ${px})
        ON CONFLICT (ticker) DO UPDATE SET price=${px}`;
    }
    if (curSpy) await sql`INSERT INTO nav_prices (ticker, price) VALUES ('SPY', ${curSpy})
      ON CONFLICT (ticker) DO UPDATE SET price=${curSpy}`;

    return NextResponse.json({ ok: true, as_of: today,
      strategy_nav: +newStrat.toFixed(2), spy_nav: +newSpy.toFixed(2),
      strategy_day_pct: +(stratRet * 100).toFixed(2), spy_day_pct: +(spyRet * 100).toFixed(2) });
  } catch (e: any) {
    console.error("[nav-snapshot] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
