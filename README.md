# Vivaan.io — AI Portfolio Agent (Next.js / Vercel)

Multi-user paper-trading dashboard with ML signals and device push notifications.

**Live data:** Yahoo Finance · **DB:** Vercel Postgres · **Push:** ntfy.sh + Discord + browser Web Push · **Alerts:** Vercel Cron every 5 min

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- `@vercel/postgres` (Neon under the hood)
- `yahoo-finance2` for live quotes / charts / news
- `bcryptjs` + `jose` JWT for auth
- `lightweight-charts` for stock charts
- Web Notifications API + ntfy.sh for phone push

## Pages

| Route | What it does |
|---|---|
| `/overview` | Portfolio KPIs, alerts, holdings table |
| `/trade` | Browse 600+ stocks → paper buy/sell + watchlist add |
| `/watchlist` | Manage watchlist with price thresholds + ML alerts |
| `/charts` | Candlestick chart for any of the 600 tickers |
| `/news` | News for portfolio + watchlist stocks |
| `/settings` | ntfy/Discord setup, ML threshold, password, reset |

## Deploy (5 minutes)

```bash
# 1. Install deps
cd vivaan-next && npm install

# 2. Create a GitHub repo for this folder and push
git init && git add . && git commit -m "init" && gh repo create --public --source=. --push

# 3. Deploy to Vercel
npx vercel
# … answer prompts. After first deploy:

# 4. Add Vercel Postgres
# In Vercel dashboard → Storage → Create Database → Postgres → Connect to project
# (Vercel auto-injects POSTGRES_URL into your env)

# 5. Add JWT secret env var (Vercel dashboard → Settings → Environment Variables)
JWT_SECRET=$(openssl rand -hex 32)

# 6. Init DB tables and seed Vivaan user
vercel env pull .env.local
npm run db:init

# 7. Redeploy so cron picks up the new env
vercel --prod
```

You now have a public URL like `vivaan-next.vercel.app`. Share it.

Login as `Vivaan` / `vivaan` or create new accounts. Each user has their own cash, positions, watchlist, and notification settings.

## ML signals (optional)

The full ML training/screener stays local (Python, scikit-learn, .pkl files). To get ML risk scores into the Vercel app:

```bash
# In your existing ai-portfolio-agent folder
source venv/bin/activate
python train_all.py        # train models
python screener.py         # produces CSV

# Then upload to Postgres so Vercel can read it:
cd ../vivaan-next/scripts
pip install psycopg2-binary pandas python-dotenv
cp ../.env.local .env
python upload-screener.py  # uploads to ml_signals table
```

Schedule this as a cron on your laptop / Raspberry Pi to keep ML risk scores fresh — the Vercel app and the alert cron pick them up automatically.

## How phone push works

1. User opens **Settings** → picks a unique ntfy topic like `vivaan-stocks-xyz123`
2. They install **ntfy** app (free, ntfy.sh) and subscribe to that topic
3. They hit "Send Test" — instant phone notification confirms it works
4. Vercel Cron runs `/api/cron/check-alerts` every 5 min — when any threshold trips, ntfy fires a push to their phone (and the browser, if the app is open)

## Local dev

```bash
npm install
cp .env.example .env.local   # fill POSTGRES_URL + JWT_SECRET (use a free Neon DB)
npm run db:init
npm run dev                  # → http://localhost:3000
```

## Files

```
app/
  (auth)/login, register     # public auth pages
  (app)/overview, trade,
        watchlist, charts,
        news, settings        # logged-in pages
  api/
    auth/{login,register,
          logout,me}          # JWT cookie auth
    quote, chart, news        # yahoo-finance2 wrappers
    portfolio                 # KPIs + positions + quotes + ML in one call
    trade                     # paper buy/sell/update targets/history
    watchlist                 # CRUD
    notifications             # in-app polling + auto-mark-delivered
    settings                  # ntfy/discord + password + reset
    test-notify               # phone push test
    cron/check-alerts         # Vercel cron (every 5 min)
    universe                  # 546-stock universe
lib/
  db, auth, yfinance, ntfy,
  universe, format            # shared utilities
components/
  Header, Nav, Kpi, Chart,
  StockSearch                 # reusable UI
```
