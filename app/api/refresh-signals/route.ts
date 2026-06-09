import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getBarsBulk } from "@/lib/yfinance";
import { computeSignal, computeSmartStops } from "@/lib/signal";
import { insiderBuyingScore } from "@/lib/finnhub";
import { UNIVERSE } from "@/lib/universe";

export const maxDuration = 300;

function authed(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const c = process.env.CRON_SECRET;
  return !!c && auth === `Bearer ${c}`;
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  // CRON_SECRET bearer OR any logged-in user (for manual refresh from the UI)
  if (!authed(req)) {
    try { await requireSession(); } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  await initDb().catch(() => {});

  const tickers = UNIVERSE.map(t => t.toUpperCase());

  // Do NOT overwrite fresh Python-model scores
  let freshPy = new Set<string>();
  try {
    const r = await sql`SELECT ticker FROM ml_signals
      WHERE source = 'py' AND updated_at > NOW() - INTERVAL '24 hours'`;
    freshPy = new Set(r.rows.map((x: any) => x.ticker));
  } catch {}

  const barsMap = await getBarsBulk(tickers, 90);

  let updated = 0, skipped = 0, errors = 0;

  for (const tk of tickers) {
    if (freshPy.has(tk)) { skipped++; continue; }
    const candles = barsMap[tk];
    if (!candles || candles.length < 20) { errors++; continue; }

    try {
      const ibs = await insiderBuyingScore(tk).catch(() => null);
      const sig = computeSignal(candles, { insiderBuyScore: ibs });
      if (!sig) { errors++; continue; }
      const stops = computeSmartStops(candles);
      const lastClose = candles[candles.length - 1].c;
      const mom1m = sig.momentum1m ?? null;

      await sql`INSERT INTO ml_signals
        (ticker, drop_probability, price, rsi, return_1m, stop_loss, take_profit, momentum_1m, source, updated_at)
        VALUES (
          ${tk},
          ${sig.dropProb},
          ${lastClose},
          ${sig.rsi ?? null},
          ${mom1m != null ? mom1m / 100 : null},
          ${stops?.stop_loss ?? null},
          ${stops?.take_profit ?? null},
          ${mom1m},
          ${"live"},
          NOW()
        )
        ON CONFLICT (ticker) DO UPDATE SET
          drop_probability = EXCLUDED.drop_probability,
          price            = EXCLUDED.price,
          rsi              = EXCLUDED.rsi,
          return_1m        = EXCLUDED.return_1m,
          stop_loss        = EXCLUDED.stop_loss,
          take_profit      = EXCLUDED.take_profit,
          momentum_1m      = EXCLUDED.momentum_1m,
          source           = EXCLUDED.source,
          updated_at       = EXCLUDED.updated_at`;
      updated++;
    } catch { errors++; }
  }

  return NextResponse.json({ ok: true, updated, skipped, errors, total: tickers.length });
}
