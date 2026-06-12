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

### PR #28 (open, draft) — `eb0cb2d` — circuit breaker coverage + diagnostic audit
- **Circuit breaker cooldown** (`ef96a9e`): `circuit_breaker_until` (tripped in
  `/api/auto-trade/run` on a drawdown breach) was only checked there. Both
  `/api/cron/auto-trade` (daily discovery) and `/api/cron/check-alerts`
  (watchlist ML auto-buy) now select it and skip new buys during the cooldown.
- **Dead time-based exit fixed** (`eb0cb2d`): `positions.created_at` was never
  persisted or selected, so the documented "trim after 90 days sideways"
  exit in `auto-trade/run` could never fire (`ageInDays` was always 0). Added
  the column (idempotent `ALTER TABLE` in `lib/db.ts`) and select it.
- **Factor-rebalance circuit breaker** (`eb0cb2d`): `/api/factor-rebalance/run`
  (the unattended factor/"Vivaan" account path) had zero drawdown protection —
  never checked `peak_equity`/`circuit_breaker_pct`. Now tracks the
  high-water mark, liquidates to cash + 7-day cooldown on a breach, and skips
  rebalancing during an active cooldown — mirrors the TA breaker.
- **Watchlist auto-buy safety rails** (`eb0cb2d`): `cron/check-alerts`'
  ML auto-buy ignored `cash_reserve_pct`, `max_pos_pct`, and `max_positions`
  (the other two buy paths enforce all three). Now sizes against
  reserve-aware available cash, caps each buy at `max_pos_pct` of equity,
  stops once `max_positions` is hit, and wraps `daysUntilEarnings` in the
  same 2s timeout used elsewhere (was unbounded, risking the whole 60s cron
  function on a slow Yahoo fetch).

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

### PR #16 (open, draft) — `b950701` — pending-order tracking
- Auto-trade buy/sell sites now capture `alpacaOrderId` for accepted-but-unfilled
  orders (status "new"), not just immediate fills — surfaced as "(pending fill)"
  in notifications. Sites: `cron/check-alerts` (sell + watchlist buy),
  `cron/auto-trade` (discovery buy), `auto-trade/run` (stop/target/ML/time-exit
  sell, new-pick buy).

### PR #2 (merged) — `db662dd` — max-profit improvements
- **Earnings filter 3 → 14 days** (auto-trade/run + cron/auto-trade)
- **Sector cap**: `SECTOR` map + `boughtSectors` set — max 1 buy per sector per cycle
- **Regime-adjusted entry threshold**: bull 0.35 / neutral 0.28 / bear 0.20
- **Continuous trailing stop**: replaced step-wise ladder in `computeTrailingStop`
- **Time-based exit**: trim 25% if position sideways 90+ days with weakening signal
- **Correlation filter**: `pearsonCorr` re-ranks buys 70% signal + 30% diversification
- **Expanded POOL 60 → ~150** stocks (mid-caps, more semis/health/growth) in both files

---

## Model audit findings

From deep audit of `lib/signal.ts`, `lib/backtest.ts`, `lib/yfinance.ts`, etc:

**Done**
- ~~Stale ML signal freshness check~~ — `auto-trade/run` and `cron/check-alerts` now
  filter `ml_signals` with `WHERE updated_at > NOW() - interval '24 hours'`.
- ~~Insider-buying clusters (SEC Form 4) + PEAD~~ — `lib/finnhub.ts`
  `insiderBuyingScore` / `peadScore`, wired into `computeSignal` hints.
- ~~No VIX/volatility regime~~ — `computeVolRegime()` (SPY 10d vs 60d realized
  vol) tightens entry thresholds in panic regimes, both auto-trade paths.
- ~~No mean-reversion/bounce detector~~ — `computeSignal` now has an oversold
  reversal-day + volume-confirmation factor (RSI<30, today's close > prior
  close, volZ>0.5 → drop -= 0.06).

**Done**
- ~~Factor-weight validation~~ — `lib/walkforward.ts` + `GET /api/admin/walkforward`
  runs a 730d/445-ticker/60-40 train-test grid search over the bearish/bullish
  factor scales. Found the original (1,1) weights had ~no out-of-sample
  calibration (test Spearman +0.086, i.e. wrong sign); `{bearish: 0.5, bullish: 1.5}`
  generalizes (test Spearman -0.900 vs -0.829 train, correct sign — higher dropProb
  → lower forward returns) and is now `DEFAULT_SCALES` in `lib/signal.ts`.

- ~~Per-factor weight validation~~ — `lib/signal.ts` exposes
  `computeSignalContributions` (named per-factor contributions, see
  `FACTOR_NAMES`) and `computeSignal(..., factorWeights?)`. `GET
  /api/admin/walkforward-factors` (`walkForwardValidatePerFactor` in
  `lib/walkforward.ts`) does a coordinate-ascent grid search (2 passes,
  weights ∈ {0,0.5,1,1.5,2}) over each factor's weight on top of the
  bearish/bullish DEFAULT_SCALES.
  **Run 2026-06-11** (730d/445 tickers/23,040 train/15,508 test samples):
  found `{rsi: 2, ma50: 0.5}` improved train Spearman only marginally
  (-0.829 → -0.893) but **collapsed test Spearman from -0.900 to -0.429** —
  classic overfitting. Verdict: current per-factor weights (all 1) hold up;
  **no change applied**. This run *re-confirms* the existing -0.900
  out-of-sample calibration on a fresh sample — the bearish/bullish scales
  are about as good as this coarse-grid approach can find. Further gains
  would need a different method (e.g. regularized regression), not more
  grid-search tweaking of these 10 factors.

**~~Critical~~ — threshold calibration DONE (run 2026-06-11, change applied)**
- `lib/thresholds.ts` `calibrateThresholds()` + `GET /api/admin/threshold-calibration`
  (same params/auth as the walk-forward routes): EV scan of buy cutoffs
  0.20–0.45 / sell 0.50–0.75 on a chronological train window with a
  5%-coverage floor, validated on a held-out test window.
  **Run 2026-06-11** (730d/445 tickers/23,040 train/15,508 test):
  - **Buy 0.30 beats 0.35 out-of-sample**: +1.019% edge/trade vs +0.362%
    (coverage 7.4% vs 27.4% — pickier, fewer trades). Generalizes (train
    +1.263 → test +1.019). **Applied**: cron/auto-trade qualified filter
    0.35→0.30 (auto-trade/run already used bull 0.30/neutral 0.25/bear 0.20),
    `lib/signal.ts` recommendation BUY label 0.35→0.30, signals route override
    label 0.35→0.30.
  - **Sell ≥0.65 trigger is INERT**: dropProb never exceeded 0.575 across all
    38,548 samples (the validated bearish×0.5 scale compresses the top end).
    Lowering it would be wrong — the 0.50–0.575 band has POSITIVE forward
    returns (oversold bounces). Exits are correctly handled by ATR/trailing
    stops + time-exits, not the dropProb SELL label. Left at 0.65 (label only).

**Medium — addressed/closed (2026-06-11)**
- `lib/sentiment.ts` word-list scorer remains **unvalidated** (no historical
  headline archive to backtest against) — but it was already scoped correctly:
  alert-only ("review this holding"), never auto-sells, comment in
  `auto-trade/run` already says so. No marketing claim should rely on it;
  it's a risk overlay, not part of the validated edge.
- RSI cold-start (`computeRSI` returns 50 for <15 bars): confirmed **dead
  code** — its only caller (`computeSignalContributions`) requires >=26 bars,
  always above the 15-bar floor. Documented with a comment; no behavior change
  needed.
- Survivorship bias in `UNIVERSE`-based backtests/calibration: **can't be
  fixed** (no delisted-ticker historical data source available), but now
  explicitly surfaced — `lib/universe.ts` exports `SURVIVORSHIP_BIAS_NOTE`,
  included as `caveats` in `calibrate()`, `walkForwardValidate()`, and
  `walkForwardValidatePerFactor()` results. Anyone citing the -0.900 Spearman
  number externally should pair it with this caveat.

## Feature-truth audit

- **Trade tab "Recommended Setup"** (`api/recommend/[ticker]` → `computeRecommendation`):
  GOOD — real ATR stops, shows real $ prices, "Apply Recommendation" works.
- **Top Picks** (`app/(app)/screener/page.tsx`): FIXED — now sourced from `ml_signals`
  (real rsi/momentum_1m/ATR stops via the batch `refresh-signals` pipeline), falling
  back to live per-ticker compute only when no `ml_signals` row exists.
- **Screener "Buy ≤ / Sell @"**: FIXED — uses real ATR stops from `ml_signals` when
  present, falling back to per-ticker smart-stops fetch.

---

## NEXT TASK (pick up here)

The batch signal pipeline (real Top Picks/Screener data, `getBarsBulk`,
`refresh-signals` cron, insider/PEAD signals, stale-signal freshness check) is
**done** — see "Done" above and the Feature Inventory below. Both the
aggregate (`/api/admin/walkforward`) and per-factor (`/api/admin/walkforward-factors`)
walk-forward calibrations are **done and have run** — see "Done" under Model
audit findings. The current `dropProb` weights are validated at -0.900
out-of-sample Spearman and the per-factor search found no generalizing
improvement (overfit on the only attempt tried).

Remaining high-value work:

1. `lib/sentiment.ts` validation, RSI cold-start null-return, survivorship bias
   in backtests — smaller Medium items, see audit findings above.

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
| `/screener` | `app/(app)/screener/page.tsx` | ✅ | Gainers/Losers/Active/Top Picks all real, sourced from `ml_signals` batch pipeline; Buy≤/Sell@ use real ATR stops |
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
| `lib/yfinance.ts` | `getQuote`, `getQuotes` (Alpaca bulk), `getChart`, `getBarsBulk` (Alpaca bulk bars), `getSparkline`, `getNews`, `daysUntilEarnings` | `getChart` = per-ticker Yahoo (rate-limit risk for bulk jobs); use `getBarsBulk` for batch jobs. |
| `lib/alpaca.ts` | `alpacaBuy`, `alpacaSell`, `alpacaPositions`, `alpacaPing` | Paper-trading only |
| `lib/db.ts` | `sql`, `initDb` (schema with idempotent ADD COLUMN) | |
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
| `ml_signals` | Signal store: drop_probability, price, rsi, return_1m, stop_loss, take_profit, momentum_1m, source ('py'\|'live'), updated_at |
| `factor_targets` | Uploaded daily factor portfolio (JSON weights + regime + exposure) |
| `strategy_nav` | Daily factor strategy NAV vs SPY (public track record) |
| `nav_prices` | Last-seen close prices for NAV computation |
