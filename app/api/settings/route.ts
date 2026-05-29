import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { requireSession, hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const s = await requireSession();
  await initDb().catch(() => {}); // ensures new columns (email, etc.) exist before write
  const {
    ntfy_topic, discord_webhook, email, ml_alerts, ml_threshold,
    alpaca_key, alpaca_secret, auto_trade, smart_stops, auto_buy_size,
    autonomous_mode, auto_scan_universe, max_positions, max_pos_pct, cash_reserve_pct,
    strategy,
  } = await req.json();
  const strat = strategy === "factor" ? "factor" : "ta";
  await sql`UPDATE users SET
    strategy           = ${strat},
    ntfy_topic      = ${ntfy_topic ? String(ntfy_topic).trim() : null},
    discord_webhook = ${discord_webhook ? String(discord_webhook).trim() : null},
    email           = ${email ? String(email).trim().toLowerCase() : null},
    ml_alerts       = ${!!ml_alerts},
    ml_threshold    = ${Number(ml_threshold) || 0.65},
    alpaca_key      = ${alpaca_key    ? String(alpaca_key).trim()    : null},
    alpaca_secret   = ${alpaca_secret ? String(alpaca_secret).trim() : null},
    auto_trade      = ${!!auto_trade},
    smart_stops     = ${!!smart_stops},
    auto_buy_size   = ${Math.max(1, Number(auto_buy_size) || 500)},
    autonomous_mode    = ${!!autonomous_mode},
    auto_scan_universe = ${!!auto_scan_universe},
    max_positions      = ${Math.max(1, Math.min(60, Math.floor(Number(max_positions) || 15)))},
    max_pos_pct        = ${Math.max(0.01, Math.min(0.30, Number(max_pos_pct) || 0.08))},
    cash_reserve_pct   = ${Math.max(0, Math.min(0.50, Number(cash_reserve_pct) || 0.15))}
    WHERE id=${s.uid}`;
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const s = await requireSession();
  const { password } = await req.json();
  if (!password || password.length < 4)
    return NextResponse.json({ error: "Password must be ≥4 chars" }, { status: 400 });
  await sql`UPDATE users SET pw_hash=${await hashPassword(password)} WHERE id=${s.uid}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await requireSession();
  const cash = Number(new URL(req.url).searchParams.get("cash")) || 100000;
  await sql`DELETE FROM positions WHERE user_id=${s.uid}`;
  await sql`DELETE FROM trades    WHERE user_id=${s.uid}`;
  await sql`DELETE FROM alert_state WHERE user_id=${s.uid}`;
  await sql`UPDATE users SET cash=${cash} WHERE id=${s.uid}`;
  return NextResponse.json({ ok: true });
}
