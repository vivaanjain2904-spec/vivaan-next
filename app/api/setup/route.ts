import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/**
 * One-click setup: hit this URL once after first deploy.
 * Creates all tables + seeds the demo "Vivaan / vivaan" account.
 * Safe to re-run (idempotent).
 */
export async function GET() {
  try {
    await initDb();
    const r = await sql`SELECT COUNT(*)::int AS n FROM users`;
    const userCount = (r.rows[0] as any).n;
    if (userCount === 0) {
      const hash = await hashPassword("vivaan");
      await sql`INSERT INTO users (name, pw_hash, cash, is_admin)
        VALUES ('Vivaan', ${hash}, 100000, TRUE)`;
    } else {
      // Ensure Vivaan (or the first user) is admin even on existing DBs
      await sql`UPDATE users SET is_admin = TRUE
        WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)`;
    }
    return NextResponse.json({
      ok: true,
      tables_created: true,
      seeded_demo_user: userCount === 0,
      message: userCount === 0
        ? "Setup complete! Sign in with Vivaan / vivaan, or create your own account."
        : "Tables already initialised. Go sign in.",
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message ?? e),
      hint: "Did you connect Vercel Postgres in the dashboard?",
    }, { status: 500 });
  }
}
