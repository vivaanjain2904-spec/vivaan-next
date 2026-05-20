import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { getQuotes } from "@/lib/yfinance";
import { alertUser } from "@/lib/ntfy";

/**
 * Runs every 5 min (vercel.json cron).
 * For each user:
 *   - load positions + watchlist
 *   - fetch live quotes
 *   - evaluate stop/target/above/below/ML breaches against alert_state
 *   - insert notifications for newly-true conditions
 *   - send to each user's ntfy + discord channel
 */
export async function GET(req: Request) {
  // Vercel sets a CRON_SECRET; refuse anonymous hits
  const auth = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await initDb().catch(() => {});

  const usersR = await sql`SELECT id, name, ntfy_topic, discord_webhook,
    ml_alerts, ml_threshold FROM users`;
  if (!usersR.rows.length) return NextResponse.json({ ok: true, msg: "no users" });

  // Collect all tickers
  const allTickers = new Set<string>();
  const userData: any[] = [];
  for (const u of usersR.rows) {
    const [pos, wl] = await Promise.all([
      sql`SELECT ticker, qty, avg_cost, stop_loss, take_profit
          FROM positions WHERE user_id=${u.id} AND qty>0`,
      sql`SELECT ticker, alert_above, alert_below, ml_alert
          FROM watchlist WHERE user_id=${u.id}`,
    ]);
    pos.rows.forEach(p => allTickers.add(p.ticker));
    wl.rows.forEach(w => allTickers.add(w.ticker));
    userData.push({ user: u, positions: pos.rows, watch: wl.rows });
  }

  const quotes = await getQuotes(Array.from(allTickers));
  const mlR = await sql`SELECT ticker, drop_probability FROM ml_signals`;
  const ml: Record<string, number> = {};
  for (const r of mlR.rows) ml[r.ticker] = Number(r.drop_probability);

  // Transition helper (returns true on inactive→active flip)
  async function transition(uid: number, ticker: string, kind: string, nowActive: boolean) {
    const cur = await sql`SELECT active FROM alert_state
      WHERE user_id=${uid} AND ticker=${ticker} AND kind=${kind}`;
    const was = cur.rows[0]?.active ?? false;
    if (cur.rows[0])
      await sql`UPDATE alert_state SET active=${nowActive}
        WHERE user_id=${uid} AND ticker=${ticker} AND kind=${kind}`;
    else
      await sql`INSERT INTO alert_state (user_id, ticker, kind, active)
        VALUES (${uid}, ${ticker}, ${kind}, ${nowActive})`;
    return nowActive && !was;
  }

  let total = 0;
  for (const { user, positions, watch } of userData) {
    const sent: Array<{ title: string; body: string }> = [];

    for (const p of positions) {
      const q = quotes[p.ticker]; if (!q) continue;
      const px = q.price, avg = Number(p.avg_cost);
      const pnl = avg ? ((px - avg) / avg) * 100 : 0;
      const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
      const tp = p.take_profit != null ? Number(p.take_profit) : null;
      const stopHit = sl != null && avg && px <= avg * (1 - sl);
      const tgtHit  = tp != null && avg && px >= avg * (1 + tp);

      if (await transition(user.id, p.ticker, "stop", !!stopHit)) {
        const title = `🔴 ${p.ticker} hit stop-loss`;
        const body  = `${p.ticker} $${px.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs $${avg.toFixed(2)} entry)`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'stop', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
      if (await transition(user.id, p.ticker, "target", !!tgtHit)) {
        const title = `🟢 ${p.ticker} hit take-profit`;
        const body  = `${p.ticker} $${px.toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% vs $${avg.toFixed(2)} entry)`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'target', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
      const prob = ml[p.ticker];
      const mlHit = user.ml_alerts && prob != null && prob >= Number(user.ml_threshold);
      if (await transition(user.id, p.ticker, "ml_hold", !!mlHit)) {
        const title = `⚠️ ${p.ticker} ML sell signal`;
        const body  = `Model: ${(prob * 100).toFixed(0)}% chance of >3% drop (your holding)`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${p.ticker}, 'ml_hold', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
    }

    for (const w of watch) {
      const q = quotes[w.ticker]; if (!q) continue;
      const px = q.price;
      const above = w.alert_above != null ? Number(w.alert_above) : null;
      const below = w.alert_below != null ? Number(w.alert_below) : null;

      if (await transition(user.id, w.ticker, "above", above != null && px >= above)) {
        const title = `🔔 ${w.ticker} crossed above $${above!.toFixed(2)}`;
        const body  = `${w.ticker} is now $${px.toFixed(2)}`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'above', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
      if (await transition(user.id, w.ticker, "below", below != null && px <= below)) {
        const title = `🔔 ${w.ticker} dropped below $${below!.toFixed(2)}`;
        const body  = `${w.ticker} is now $${px.toFixed(2)}`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'below', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
      const prob = ml[w.ticker];
      const mlW  = user.ml_alerts && w.ml_alert && prob != null && prob >= Number(user.ml_threshold);
      if (await transition(user.id, w.ticker, "ml_watch", !!mlW)) {
        const title = `⚠️ ${w.ticker} ML sell signal (watchlist)`;
        const body  = `Model: ${(prob * 100).toFixed(0)}% chance of >3% drop`;
        await sql`INSERT INTO notifications (user_id, ticker, kind, title, body)
          VALUES (${user.id}, ${w.ticker}, 'ml_watch', ${title}, ${body})`;
        sent.push({ title, body }); total++;
      }
    }

    // Push to device channels
    for (const s of sent) await alertUser(user, s.title, s.body);
  }

  return NextResponse.json({ ok: true, sent: total, ts: new Date().toISOString() });
}
