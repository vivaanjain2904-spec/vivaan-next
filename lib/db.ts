import { sql } from "@vercel/postgres";

export { sql };

/** Run once (called from scripts/init-db.ts or first cron tick). */
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
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
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
