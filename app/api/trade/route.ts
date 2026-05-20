import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getQuote } from "@/lib/yfinance";

/** POST /api/trade { side:'BUY'|'SELL', ticker, qty, stop_loss?, take_profit? }
 *  Paper buy/sell at current live price.
 */
export async function POST(req: Request) {
  const s = await requireSession();
  const { side, ticker, qty, stop_loss, take_profit } = await req.json();
  const tk = String(ticker || "").trim().toUpperCase();
  const q = Number(qty);
  if (!tk || !q || q <= 0) return NextResponse.json({ error: "Bad input" }, { status: 400 });
  if (side !== "BUY" && side !== "SELL")
    return NextResponse.json({ error: "side must be BUY or SELL" }, { status: 400 });

  const quote = await getQuote(tk);
  if (!quote || !quote.price) return NextResponse.json({ error: "No price" }, { status: 502 });
  const price = quote.price;

  if (side === "BUY") {
    const cost = q * price;
    const ur = await sql`SELECT cash FROM users WHERE id=${s.uid}`;
    const cash = Number(ur.rows[0]?.cash ?? 0);
    if (cost > cash + 1e-6)
      return NextResponse.json({ error: `Need $${cost.toFixed(2)}, have $${cash.toFixed(2)}` }, { status: 400 });

    await sql`UPDATE users SET cash = cash - ${cost} WHERE id=${s.uid}`;
    const ex = await sql`SELECT qty, avg_cost FROM positions WHERE user_id=${s.uid} AND ticker=${tk}`;
    if (ex.rows[0]) {
      const oq = Number(ex.rows[0].qty), oc = Number(ex.rows[0].avg_cost);
      const nq = oq + q;
      const nc = (oq * oc + q * price) / nq;
      await sql`UPDATE positions SET qty=${nq}, avg_cost=${nc} WHERE user_id=${s.uid} AND ticker=${tk}`;
    } else {
      await sql`INSERT INTO positions (user_id, ticker, qty, avg_cost, stop_loss, take_profit)
        VALUES (${s.uid}, ${tk}, ${q}, ${price},
                ${stop_loss != null ? Number(stop_loss) : 0.05},
                ${take_profit != null ? Number(take_profit) : 0.10})`;
    }
    await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
      VALUES (${s.uid}, ${tk}, 'BUY', ${q}, ${price})`;
    return NextResponse.json({ ok: true, msg: `Bought ${q} ${tk} @ $${price.toFixed(2)}` });
  }

  // SELL
  const pr = await sql`SELECT qty FROM positions WHERE user_id=${s.uid} AND ticker=${tk}`;
  const held = Number(pr.rows[0]?.qty ?? 0);
  if (q > held + 1e-6) return NextResponse.json({ error: `Hold only ${held} ${tk}` }, { status: 400 });

  const proceeds = q * price;
  await sql`UPDATE users SET cash = cash + ${proceeds} WHERE id=${s.uid}`;
  const remaining = held - q;
  if (remaining <= 1e-6) {
    await sql`DELETE FROM positions WHERE user_id=${s.uid} AND ticker=${tk}`;
  } else {
    await sql`UPDATE positions SET qty=${remaining} WHERE user_id=${s.uid} AND ticker=${tk}`;
  }
  await sql`INSERT INTO trades (user_id, ticker, side, qty, price)
    VALUES (${s.uid}, ${tk}, 'SELL', ${q}, ${price})`;
  return NextResponse.json({ ok: true, msg: `Sold ${q} ${tk} @ $${price.toFixed(2)}` });
}

/** PATCH /api/trade { ticker, stop_loss, take_profit } */
export async function PATCH(req: Request) {
  const s = await requireSession();
  const { ticker, stop_loss, take_profit } = await req.json();
  await sql`UPDATE positions SET stop_loss=${Number(stop_loss)}, take_profit=${Number(take_profit)}
    WHERE user_id=${s.uid} AND ticker=${String(ticker).toUpperCase()}`;
  return NextResponse.json({ ok: true });
}

/** GET /api/trade - trade history */
export async function GET() {
  const s = await requireSession();
  const r = await sql`SELECT ticker, side, qty, price, ts FROM trades
    WHERE user_id=${s.uid} ORDER BY id DESC LIMIT 100`;
  return NextResponse.json({ trades: r.rows });
}
