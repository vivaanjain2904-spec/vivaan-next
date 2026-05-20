"""
Uploads your latest ai-portfolio-agent screener CSV to Vercel Postgres
so the Next.js dashboard can show ML risk per ticker and fire ML alerts.

Run locally:
    pip install psycopg2-binary pandas python-dotenv
    cp ../vivaan-next/.env.local .env  # need POSTGRES_URL_NON_POOLING
    python upload-screener.py
"""
import os, glob
import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DSN = os.environ["POSTGRES_URL_NON_POOLING"]
SCREEN_DIR = os.path.expanduser("~/ai-portfolio-agent/screener_results")

csvs = sorted(glob.glob(f"{SCREEN_DIR}/*.csv"))
if not csvs:
    raise SystemExit("No screener CSV found.")
df = pd.read_csv(csvs[-1])
print(f"Uploading {len(df)} rows from {csvs[-1]}…")

with psycopg2.connect(DSN) as c, c.cursor() as cur:
    cur.execute("CREATE TABLE IF NOT EXISTS ml_signals ("
                "ticker TEXT PRIMARY KEY, drop_probability DOUBLE PRECISION NOT NULL,"
                "price DOUBLE PRECISION, rsi DOUBLE PRECISION,"
                "return_1m DOUBLE PRECISION,"
                "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
    for _, r in df.iterrows():
        cur.execute(
            "INSERT INTO ml_signals (ticker, drop_probability, price, rsi, return_1m, updated_at) "
            "VALUES (%s,%s,%s,%s,%s, NOW()) "
            "ON CONFLICT (ticker) DO UPDATE SET "
            "  drop_probability=EXCLUDED.drop_probability,"
            "  price=EXCLUDED.price, rsi=EXCLUDED.rsi,"
            "  return_1m=EXCLUDED.return_1m, updated_at=NOW()",
            (str(r["ticker"]).upper(),
             float(r.get("drop_probability") or 0),
             float(r.get("price") or 0),
             float(r.get("rsi") or 0),
             float(r.get("return_1m") or 0)),
        )
print("✓ Done.")
