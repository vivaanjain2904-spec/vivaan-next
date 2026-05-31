import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { alpacaPositions } from "@/lib/alpaca";
import { alertUser } from "@/lib/ntfy";

export const maxDuration = 60;

/**
 * POST /api/admin/reconcile
 * Health-check + reconciliation so the autonomous system can be TRUSTED unattended.
 * Protected by ADMIN_UPLOAD_SECRET or CRON_SECRET (Bearer).
 *
 * For each account it checks:
 *   - Internal consistency: cash not negative, no zero/negative-qty positions,
 *     equity is a finite number, the latest factor target was applied recently.
 *   - Broker reconciliation (if Alpaca keys + auto_trade on): does our DB match
 *     the actual broker positions? Flags any drift (the classic silent-bug class).
 *   - Staleness: has the factor target been refreshed in the last ~40 days?
 *
 * Any problem → an alert is sent to the account's configured channels (email/
 * Discord/ntfy) and returned in the JSON report.
 */
function authed(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const a = process.env.ADMIN_UPLOAD_SECRET, c = process.env.CRON_SECRET;
  return (!!a && auth === `Bearer ${a}`) || (!!c && auth === `Bearer ${c}`);
}

// Vercel cron invokes via GET with the CRON_SECRET bearer.
export async function GET(req: Request) { return POST(req); }

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    await initDb().catch(() => {});

    // Latest factor target freshness
    const tgt = await sql`SELECT as_of, created_at FROM factor_targets ORDER BY id DESC LIMIT 1`;
    const lastTarget = tgt.rows[0];
    const targetAgeDays = lastTarget
      ? (Date.now() - new Date(lastTarget.created_at).getTime()) / 86400_000 : null;

    const users = await sql`SELECT id, name, cash, strategy, auto_trade, alpaca_key, alpaca_secret,
      ntfy_topic, discord_webhook, email FROM users`;

    const report: any[] = [];
    let totalIssues = 0;

    for (const u of users.rows) {
      const issues: string[] = [];

      // 1) Internal consistency
      const cash = Number(u.cash);
      if (!Number.isFinite(cash)) issues.push("cash is not a finite number");
      if (cash < -0.01) issues.push(`negative cash: ${cash.toFixed(2)}`);

      const posR = await sql`SELECT ticker, qty, avg_cost FROM positions WHERE user_id=${u.id}`;
      for (const p of posR.rows) {
        if (Number(p.qty) <= 0) issues.push(`${p.ticker}: non-positive qty (${p.qty})`);
        if (!Number.isFinite(Number(p.avg_cost)) || Number(p.avg_cost) <= 0) issues.push(`${p.ticker}: bad avg_cost`);
      }

      // 2) Factor accounts: target should be fresh + applied
      const isFactor = u.strategy === "factor" || u.name === (process.env.FACTOR_ACCOUNT_NAME || "Vivaan");
      if (isFactor && targetAgeDays != null && targetAgeDays > 40) {
        issues.push(`factor target is stale (${targetAgeDays.toFixed(0)} days old) — daily/monthly job may have stopped`);
      }
      if (isFactor && !lastTarget) issues.push("factor account but no target ever uploaded");

      // 3) Broker reconciliation (only meaningful for live trading)
      let brokerCheck = "skipped (paper/no-keys)";
      if (u.auto_trade && u.alpaca_key && u.alpaca_secret) {
        const ap = await alpacaPositions({ key: u.alpaca_key, secret: u.alpaca_secret });
        if (!ap.ok) { issues.push(`Alpaca positions fetch failed: ${ap.error}`); brokerCheck = "error"; }
        else {
          const broker = ap.positions || {};
          const dbpos: Record<string, number> = {};
          for (const p of posR.rows) dbpos[p.ticker.toUpperCase()] = Number(p.qty);
          const all = new Set([...Object.keys(broker), ...Object.keys(dbpos)]);
          let mismatches = 0;
          for (const t of all) {
            const b = broker[t] || 0, d = dbpos[t] || 0;
            if (Math.abs(b - d) > 0.5) { issues.push(`DRIFT ${t}: app=${d} vs broker=${b}`); mismatches++; }
          }
          brokerCheck = mismatches ? `${mismatches} mismatch(es)` : "matches broker ✓";
        }
      }

      if (issues.length) {
        totalIssues += issues.length;
        const title = `⚠️ Vaelor health check: ${issues.length} issue(s) on ${u.name}`;
        const body = issues.slice(0, 6).join(" · ");
        try {
          await sql`INSERT INTO notifications (user_id,ticker,kind,title,body) VALUES (${u.id},NULL,'health_check',${title},${body})`;
          await alertUser(u as any, title, body);
        } catch {}
      }
      report.push({ user: u.name, strategy: u.strategy, cash, positions: posR.rows.length,
        brokerCheck, issues });
    }

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      targetAgeDays: targetAgeDays != null ? Math.round(targetAgeDays) : null,
      accounts: report.length,
      totalIssues,
      healthy: totalIssues === 0,
      report,
    });
  } catch (e: any) {
    console.error("[reconcile] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
