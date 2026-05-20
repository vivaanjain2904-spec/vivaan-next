/**
 * One-time DB init. Run AFTER you've added Vercel Postgres:
 *   1) vercel link        (link to your project)
 *   2) vercel env pull    (pulls POSTGRES_URL into .env.local)
 *   3) npm run db:init    (creates tables + seeds a demo user)
 */
import { sql, initDb } from "../lib/db";
import { hashPassword } from "../lib/auth";

async function main() {
  console.log("Creating tables…");
  await initDb();
  const r = await sql`SELECT COUNT(*)::int AS n FROM users`;
  if ((r.rows[0] as any).n === 0) {
    console.log("Seeding demo user 'Vivaan' / 'vivaan'…");
    const hash = await hashPassword("vivaan");
    await sql`INSERT INTO users (name, pw_hash, cash) VALUES ('Vivaan', ${hash}, 100000)`;
  }
  console.log("✓ Done.");
}
main().catch(e => { console.error(e); process.exit(1); });
