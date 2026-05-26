import { neon } from "@neondatabase/serverless";

// Lazy-init the neon client so module import succeeds at build time even when
// POSTGRES_URL is not yet set (Vercel Postgres injects it after first deploy).
let _sql: any = null;
function _client() {
  if (_sql) return _sql;
  const URL =
    process.env.POSTGRES_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    process.env.STORAGE_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!URL) throw new Error("POSTGRES_URL not set — connect Vercel Postgres in Storage tab");
  _sql = neon(URL);
  return _sql;
}

// Tagged-template SQL helper. Usage: await sql`SELECT ... ${value}`
export const sql = async (strings: TemplateStringsArray, ...values: any[]) => {
  const rows = await _client()(strings as any, ...values);
  return { rows: rows as any[] };
};

/** Run once (auto-called on first register/login/cron tick). */
export async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT UNIQUE NOT NULL,
    pw_hash       TEXT NOT NULL,
    cash          DOUBLE PRECISION NOT NULL DEFAULT 100000,
    ml_alerts     BOOLEAN NOT NULL DEFAULT TRUE,
    ml_threshold  DOUBLE PRECISION NOT NULL DEFAULT 0.65,
    ntfy_topic    TEXT,
    discord_webhook TEXT,
    alpaca_key    TEXT,
    alpaca_secret TEXT,
    auto_trade    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  // Idempotent column adds (for DBs created before these existed)
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS alpaca_key TEXT`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS alpaca_secret TEXT`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_trade BOOLEAN NOT NULL DEFAULT FALSE`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS smart_stops BOOLEAN NOT NULL DEFAULT FALSE`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_buy_size DOUBLE PRECISION NOT NULL DEFAULT 500`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`; } catch {}
  try { await sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS review_at TIMESTAMPTZ`; } catch {}
  // Autonomous trader settings
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS autonomous_mode BOOLEAN NOT NULL DEFAULT FALSE`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_scan_universe BOOLEAN NOT NULL DEFAULT FALSE`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_positions INTEGER NOT NULL DEFAULT 15`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_pos_pct DOUBLE PRECISION NOT NULL DEFAULT 0.08`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_reserve_pct DOUBLE PRECISION NOT NULL DEFAULT 0.15`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS positions (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ticker  TEXT NOT NULL,
    qty     DOUBLE PRECISION NOT NULL,
    avg_cost DOUBLE PRECISION NOT NULL,
    stop_loss   DOUBLE PRECISION,
    take_profit DOUBLE PRECISION,
    PRIMARY KEY (user_id, ticker)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, side TEXT NOT NULL,
    qty DOUBLE PRECISION NOT NULL, price DOUBLE PRECISION NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS watchlist (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    alert_above DOUBLE PRECISION,
    alert_below DOUBLE PRECISION,
    ml_alert BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, ticker)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT, kind TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT FALSE,
    agent_sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS alert_state (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL, kind TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, ticker, kind)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ml_signals (
    ticker TEXT PRIMARY KEY,
    drop_probability DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION,
    rsi DOUBLE PRECISION,
    return_1m DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
