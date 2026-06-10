# Vaelor — Project Memory

> Persistent notes for Claude Code sessions. The remote container is ephemeral,
> so anything worth keeping lives here, committed to the repo.

## What Vaelor is

A Next.js 14 (App Router) + TypeScript full-stack paper-trading dashboard with an
autonomous trading bot. Deployed to Vercel, live at **vaelor.dev**.

- **DB:** Vercel Postgres (Neon), schema in `lib/db.ts` (`initDb()`)
- **Auth:** bcryptjs + jose JWT cookie (`lib/auth.ts`), session cookie `vv_session`
- **Market data:** Alpaca free **IEX feed** = real-time quotes (primary);
  Yahoo Finance v8 = delayed fallback for metadata + historical charts (`lib/yfinance.ts`)
- **Signals:** `lib/signal.ts` computes a heuristic `dropProb` (0..1, higher = bearish);
  a Python model can override via the `ml_signals` table
- **No test suite / no ESLint.** Verify with `npx next build` (needs `npm install` first;
  `next` is not on PATH by default in fresh containers)

## Working branch & workflow

- Develop on branch **`claude/sharp-darwin-29quql`**
- Push with `git push -u origin claude/sharp-darwin-29quql`, then open a **draft PR**
- GitHub repo scope for MCP tools: `vivaanjain2904-spec/vaelor`
- Model identity must never appear in commits/PRs/code — chat only
- **Multiple sessions can push to this branch.** Other (parallel/earlier) sessions
  may have force-pushed new commits the local container doesn't have yet.
  **At the start of any task that touches code** (and before assuming a feature
  is "missing"), run `git fetch origin claude/sharp-darwin-29quql` and check
  `git log HEAD..origin/claude/sharp-darwin-29quql` — if origin is ahead,
  `git reset --hard origin/claude/sharp-darwin-29quql` before doing anything else.

## Owner preferences (important)

- Goal stated repeatedly: **"max profit, min risk, beat SPY/hedge funds."**
- Wants aggressive improvement but I've advised: **"perfect prediction" is impossible**
  and chasing it causes overfitting. Real target = fast accurate data + calibrated
  edge + tight risk control.
- Admin login is account **"Vivaan"** (the factor-strategy account, excluded from
  the TA auto-trader). `FACTOR_ACCOUNT_NAME` env defaults to "Vivaan".

---

## Session history

### PR #1 (merged) — `f3cd81a` — 11 diagnostic bug fixes
- **CRON_SECRET bypass** (cron/auto-trade, cron/check-alerts): flipped guard to
  deny-by-default when env var unset
- **Phantom cash loss**: `ON CONFLICT DO NOTHING` → `DO UPDATE` (adds shares,
  recomputes avg_cost) at all 3 auto-buy sites so cash deduction always matches shares
- **Partial-fill DELETE**: `tryAutoSell` now respects Alpaca `filledQty` instead of
  deleting the full position row
- **MACD signal line**: EMA over full `macdSeries`, not just last 9 points
- **Factor rebalance stale equity**: recompute equity after sell pass
- **Admin check**: `requireAdmin()` instead of hardcoded `name === "Vivaan"`
- **PATCH /api/trade**: only update stop_loss/take_profit fields explicitly provided
  (was zeroing them via `Number(null)=0`)
- **Performance baseline**: fall back to `currentEquity` not hardcoded $100k
- **JWT_SECRET**: log CRITICAL in production when unset
- **NaN signals**: Python-override tickers return `0` not `NaN` for rsi/momentum
- **Screener route**: removed `revalidate=300` that conflicted with `force-dynamic`

### PR #2 (merged) — `db662dd` — max-profit improvements
- **Earnings filter 3 → 14 days** (auto-trade/run + cron/auto-trade)
- **Sector cap**: `SECTOR` map + `boughtSectors` set — max 1 buy per sector per cycle
- **Regime-adjusted entry threshold**: bull 0.35 / neutral 0.28 / bear 0.20
- **Continuous trailing stop**: replaced step-wise ladder in `computeTrailingStop`
- **Time-based exit**: trim 25% if position sideways 90+ days with weakening signal
- **Correlation filter**: `pearsonCorr` re-ranks buys 70% signal + 30% diversification
- **Expanded POOL 60 → ~150** stocks (mid-caps, more semis/health/growth) in both files

---

## Model audit findings (NOT yet implemented)

From deep audit of `lib/signal.ts`, `lib/backtest.ts`, `lib/yfinance.ts`, etc:

**Critical**
- `dropProb` is a **heuristic, not a calibrated probability** (starts at 0.4, arbitrary
  point additions). Buy ≤0.35 / sell ≥0.65 thresholds are guesses. Needs decile
  calibration against realized forward returns.
- **Stale ML signal**: auto-trade reads `ml_signals` with **no freshness check** — uses
  week-old Python scores as if fresh. Fix: `WHERE updated_at > NOW() - interval '24h'`.
- **Factor weights all hardcoded** (RSI ±0.22, MACD ±0.08, etc.) — never validated.
  Needs walk-forward optimization.

**Medium**
- `lib/sentiment.ts` is a word-list scorer, **unvalidated**; -0.4 sell threshold is a guess
- RSI cold-start returns neutral 50 for <15 bars (should return null)
- No VIX/volatility regime; thresholds constant across calm/panic markets
- No mean-reversion/bounce detector (only momentum)
- Potential survivorship bias in any large-universe backtest (delisted names vanish)

## Feature-truth audit (the disconnect to fix)

- **Trade tab "Recommended Setup"** (`api/recommend/[ticker]` → `computeRecommendation`):
  GOOD — real ATR stops, shows real $ prices, "Apply Recommendation" works.
- **Top Picks** (`app/(app)/screener/page.tsx:83-126`): **OVERSELLS.** UI claims
  "multi-factor RSI·MACD·Bollinger·Volume·MA·momentum, ATR-based stops" but actually
  uses hardcoded `rsi:50`, `momentum_1m:0`, fixed `sl=0.05/tp=0.10`, and ranks only by
  52-week-range position + day %. The fake was introduced to dodge Yahoo rate limits.
- **Screener "Buy ≤ / Sell @"** (`screener/page.tsx:454-458`): "Buy ≤" is a made-up
  `price × (1 - stop_loss × 0.5)`, not a real entry signal.

---

## NEXT TASK (paused mid-design — pick up here)

**Build a server-side batch signal pipeline so Top Picks + Screener use REAL data.**
Root cause of all the fakery: there's no batch that computes the real signal for the
whole universe, so the UI fakes it (Top Picks) or fetches 1-at-a-time and rate-limits.

Plan agreed with owner:
1. **Add `getBarsBulk(tickers, days)` to `lib/yfinance.ts`** using Alpaca's free
   multi-symbol bars endpoint `GET https://data.alpaca.markets/v2/stocks/bars?symbols=A,B,C&timeframe=1Day&start=...&feed=iex`
   (paginate via `page_token`). This replaces per-ticker Yahoo `getChart` for batch jobs.
2. **Extend `ml_signals` table** (in `lib/db.ts` initDb, use `ADD COLUMN IF NOT EXISTS`):
   add `stop_loss`, `take_profit`, `momentum_1m`, `source TEXT` ('py' | 'live').
3. **New endpoint `app/api/refresh-signals/route.ts`** (CRON_SECRET-protected, same
   deny-by-default pattern as other crons; also allow logged-in manual trigger):
   - load `UNIVERSE` (lib/universe.ts, ~546 tickers)
   - bulk-fetch daily bars via `getBarsBulk`
   - run `computeSignal` + `computeSmartStops` per ticker
   - upsert into `ml_signals` with real drop_probability, rsi, return_1m, stop_loss,
     take_profit, source='live'
   - **Do NOT clobber fresh Python scores** (source='py') — only write 'live' rows where
     no fresh 'py' row exists
   - schedule it (vercel.json cron or GitHub Action, like the other crons)
4. **Wire `/api/screener`** to also SELECT the new ml_signals columns.
5. **Wire Top Picks** (`screener/page.tsx`) to use real rsi/momentum_1m/stop_loss/
   take_profit from ml_signals instead of hardcoded 50/0/0.05/0.10.
6. **Wire Screener Buy≤/Sell@** to real ATR stops from ml_signals.
7. Verify `npx next build`, commit, push, open draft PR.

Also queued by owner (after the batch pipeline):
- Add stale-signal freshness check to auto-trade (quick, high value)
- Niche-market idea (owner leaning toward, from my list): **insider-buying clusters
  (SEC Form 4) + post-earnings drift (PEAD)** — both free data, plug into signal,
  underexploited at his portfolio size. (Owner said: perfect the model first, then niche.)

---

## Full Feature Inventory (audited 2026-06-09)

### Pages (`app/`)
| Route | File | Status | Notes |
|-------|------|--------|-------|
| `/` | `app/page.tsx` | ✅ | Landing page (shown to everyone, no auto-redirect) |
| `/welcome` | `app/welcome/page.tsx` | ✅ | Onboarding/welcome screen |
| `/login` | `app/(auth)/login/page.tsx` | ✅ | JWT cookie auth |
| `/register` | `app/(auth)/register/page.tsx` | ✅ | Creates user + email field |
| `/founder` | `app/founder/page.tsx` | ✅ | About/founder credibility page |
| `/brand` | `app/brand/page.tsx` | ✅ | Brand assets page |
| `/track-record` | `app/track-record/page.tsx` | ✅ | Public strategy vs SPY chart (forward-only, no backfill) |
| `/suggestions` | `app/suggestions/page.tsx` | ✅ | Suggest-mode: recommended trades for user approval (no auto-exec) |
| `/overview` | `app/(app)/overview/page.tsx` | ✅ | Dashboard — portfolio summary, ML status row, quick-start tiles |
| `/screener` | `app/(app)/screener/page.tsx` | ⚠️ PARTIAL | Gainers/Losers/Active tabs = real. **Top Picks = FAKE** (hardcoded rsi:50, sl:0.05; Buy≤ not real entry). Fix: batch pipeline (see NEXT TASK) |
| `/trade` | `app/(app)/trade/page.tsx` | ✅ | Manual buy/sell; "Recommended Setup" = REAL ATR stops via `api/recommend/[ticker]` |
| `/charts` | `app/(app)/charts/page.tsx` | ✅ | OHLCV charts via Yahoo Finance v8 |
| `/news` | `app/(app)/news/page.tsx` | ✅ | Ticker news feed via Yahoo Finance search API |
| `/watchlist` | `app/(app)/watchlist/page.tsx` | ✅ | Price alerts (above/below) + ML alert toggle |
| `/performance` | `app/(app)/performance/page.tsx` | ✅ | P&L, win rate, SPY benchmark, equity curve; starting cash derived from first trade |
| `/backtest` | `app/(app)/backtest/page.tsx` | ✅ | Per-ticker backtest via `api/backtest/[ticker]` → `lib/backtest.ts` |
| `/settings` | `app/(app)/settings/page.tsx` | ✅ | Alpaca keys, ntfy/Discord/email alerts, autonomous mode knobs, strategy toggle |
| `/admin` | `app/(app)/admin/page.tsx` | ✅ | Admin-only: user list, stats, trade counts |

### API Routes (`app/api/`)

**Market Data**
| Endpoint | File | Notes |
|----------|------|-------|
| `GET /api/quote/[ticker]` | `app/api/quote/[ticker]/route.ts` | Single real-time quote (Alpaca → Yahoo fallback) |
| `GET /api/chart/[ticker]` | `app/api/chart/[ticker]/route.ts` | OHLCV candles (Yahoo v8) |
| `GET /api/news/[ticker]` | `app/api/news/[ticker]/route.ts` | Headline feed (Yahoo search) |
| `GET /api/recommend/[ticker]` | `app/api/recommend/[ticker]/route.ts` | ✅ Real ATR stops + entry target via `computeRecommendation` |
| `GET /api/smart-stops/[ticker]` | `app/api/smart-stops/[ticker]/route.ts` | ATR-based stop_loss/take_profit fractions |
| `GET /api/backtest/[ticker]` | `app/api/backtest/[ticker]/route.ts` | Walk-forward backtest via `lib/backtest.ts` |

**Screener / Signals**
| Endpoint | File | Notes |
|----------|------|-------|
| `GET /api/screener` | `app/api/screener/route.ts` | Full 546-ticker universe: gainers/losers/active + ml_signals join. `force-dynamic`. |
| `GET /api/picks` | `app/api/picks/route.ts` | ⚠️ 20-stock hardcoded POOL; prefers ml_signals, falls back to live scan. Feeds Top Picks when screener data absent. |
| `POST /api/signals` | `app/api/signals/route.ts` | Compute dropProb for arbitrary tickers; checks ml_signals overrides first |
| `GET /api/universe` | `app/api/universe/route.ts` | Returns full UNIVERSE ticker list (~546) |

**Trading**
| Endpoint | File | Notes |
|----------|------|-------|
| `GET/POST/PATCH/DELETE /api/trade` | `app/api/trade/route.ts` | Manual buy/sell/update positions. PATCH only updates provided stop/tp fields (bug fixed PR#1). |
| `GET /api/portfolio` | `app/api/portfolio/route.ts` | Positions + watchlist + real-time quotes + ml_signals signals |
| `POST /api/auto-trade/run` | `app/api/auto-trade/run/route.ts` | Manual trigger: full TA buy+sell cycle. 150-stock POOL. Regime-adjusted thresholds, sector cap, correlation filter, earnings filter 14d. |
| `POST /api/run-alerts-self` | `app/api/run-alerts-self/route.ts` | Self-trigger alert check for logged-in user (no cron secret needed) |
| `GET/POST /api/suggestions` | `app/api/suggestions/route.ts` | Suggest-mode: recommended factor-rebalance trades for user approval |
| `POST /api/factor-rebalance/run` | `app/api/factor-rebalance/run/route.ts` | Execute factor rebalance toward latest factor_targets row. 1.5% no-trade band. Scoped to factor-strategy accounts only. |

**Crons (GitHub Actions + Vercel cron)**
| Endpoint | Schedule | Notes |
|----------|----------|-------|
| `POST /api/cron/auto-trade` | GitHub Action 14:30 UTC weekdays | Full TA discovery+buy cycle for all `autonomous_mode` users (excl. factor accounts). 150-stock POOL. |
| `POST /api/cron/check-alerts` | GitHub Action every 15min 13-21 UTC weekdays | Sell/buy triggers, trailing stop ratchet, ML alerts. Respects Alpaca filledQty. |
| `GET/POST /api/admin/reconcile` | Vercel cron 22:00 UTC weekdays | DB vs Alpaca position drift check; sends alerts on mismatch |
| `GET/POST /api/admin/nav-snapshot` | Vercel cron 21:05 UTC weekdays | Records daily factor strategy NAV vs SPY into `strategy_nav` table |

**Admin**
| Endpoint | File | Notes |
|----------|------|-------|
| `GET /api/admin/stats` | `app/api/admin/stats/route.ts` | User count, recent signups, top watchlist tickers. `requireAdmin()` protected. |
| `GET/PUT /api/admin/user/[id]` | `app/api/admin/user/[id]/route.ts` | Edit user (admin only) |
| `GET /api/admin/users` | `app/api/admin/users/route.ts` | List all users (admin only) |
| `POST /api/admin/factor-target` | `app/api/admin/factor-target/route.ts` | Upload daily factor portfolio from Python pipeline (ADMIN_UPLOAD_SECRET) |
| `GET /api/public/performance` | `app/api/public/performance/route.ts` | Public track record (no auth). Uses `strategy_nav` table. |

**Auth / Settings**
| Endpoint | Notes |
|----------|-------|
| `POST /api/auth/login` | Issues JWT `vv_session` cookie |
| `POST /api/auth/register` | Creates user, collects email |
| `GET /api/auth/me` | Session info |
| `POST /api/auth/logout` | Clears cookie |
| `POST /api/settings` | All user settings: Alpaca keys, notification channels, trading knobs, strategy toggle |
| `POST /api/alpaca-ping` | Test Alpaca connectivity |
| `POST /api/seed-demo` | Seeds 10-stock starter portfolio at current prices (~$2500 each) |
| `GET/POST /api/watchlist` | Add/remove/update watchlist entries |
| `GET /api/notifications` | Undelivered in-app notifications; marks delivered on fetch |
| `POST /api/test-notify` | Test notification delivery |
| `POST /api/setup` | One-time setup wizard |

### Library Modules (`lib/`)
| File | Purpose | Known Issues |
|------|---------|-------------|
| `lib/signal.ts` | `computeSignal`, `computeSmartStops`, `computeTrailingStop`, `computeRecommendation`, `computeMarketRegime`, `sizingMultiplier` | `dropProb` is a heuristic (not calibrated). Factor weights hardcoded. RSI returns 50 for <15 bars. |
| `lib/yfinance.ts` | `getQuote`, `getQuotes` (Alpaca bulk), `getChart`, `getSparkline`, `getNews`, `daysUntilEarnings` | No batch bars endpoint yet. `getChart` = per-ticker Yahoo (rate-limit risk for bulk jobs). |
| `lib/alpaca.ts` | `alpacaBuy`, `alpacaSell`, `alpacaPositions`, `alpacaPing` | Paper-trading only |
| `lib/db.ts` | `sql`, `initDb` (schema with idempotent ADD COLUMN) | `ml_signals` missing `stop_loss`, `take_profit`, `momentum_1m`, `source` columns (needed for batch pipeline) |
| `lib/auth.ts` | `requireSession`, `requireAdmin`, `hashPassword`, `getUserSettings` | JWT_SECRET warning in production ✅ |
| `lib/signal.ts` | See above | |
| `lib/sentiment.ts` | Word-list headline scorer | Unvalidated; -0.4 sell threshold is a guess |
| `lib/backtest.ts` | Walk-forward signal backtest | Survivorship bias risk (delisted names absent) |
| `lib/universe.ts` | ~546 ticker UNIVERSE + `SECTOR` map | Used for screener full scan |
| `lib/ntfy.ts` | Push notifications: ntfy.sh, Discord webhook, email | |
| `lib/format.ts` | Number/currency formatting helpers | |

### DB Tables
| Table | Purpose |
|-------|---------|
| `users` | Auth + all settings columns (via ADD COLUMN IF NOT EXISTS) |
| `positions` | Holdings: qty, avg_cost, stop_loss, take_profit, review_at |
| `trades` | Trade history log |
| `watchlist` | Price/ML alert config per ticker |
| `notifications` | In-app + external notification queue |
| `alert_state` | Dedup guard for repeated alerts |
| `ml_signals` | Signal store: drop_probability, price, rsi, return_1m, updated_at. **Missing**: stop_loss, take_profit, momentum_1m, source |
| `factor_targets` | Uploaded daily factor portfolio (JSON weights + regime + exposure) |
| `strategy_nav` | Daily factor strategy NAV vs SPY (public track record) |
| `nav_prices` | Last-seen close prices for NAV computation |
