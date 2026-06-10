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

**Critical — NOT yet implemented**
- `dropProb` is a **heuristic, not a calibrated probability** (starts at 0.4, arbitrary
  point additions). Buy ≤0.35 / sell ≥0.65 thresholds are guesses. Needs decile
  calibration against realized forward returns.
- **Factor weights all hardcoded** (RSI ±0.22, MACD ±0.08, etc.) — never validated.
  Needs walk-forward optimization.

**Medium — NOT yet implemented**
- `lib/sentiment.ts` is a word-list scorer, **unvalidated**; -0.4 sell threshold is a guess
- RSI cold-start returns neutral 50 for <15 bars (should return null) — low impact since
  `computeSignal` already requires >=26 bars before calling it
- No VIX/volatility regime; thresholds constant across calm/panic markets
- No mean-reversion/bounce detector (only momentum)
- Potential survivorship bias in any large-universe backtest (delisted names vanish)

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
**done** — see "Done" above and the Feature Inventory below.

Remaining high-value work, roughly in priority order:

1. **VIX/volatility-regime-aware thresholds** (Medium audit finding, well-scoped):
   `computeMarketRegime` already classifies bull/bear/neutral from SPY's 50-day MA.
   Extend with a volatility regime (e.g. SPY's recent realized volatility vs its own
   trailing average, or ATR-based) and widen/tighten buy thresholds + stop distances
   in calm vs panic markets. No new data source needed — SPY chart is already fetched.
2. **Mean-reversion/bounce detector** (Medium): a short-term oversold-bounce signal
   (e.g. RSI<25 + positive volume divergence) as a separate factor from the existing
   momentum-only model.
3. **Critical items (calibration, factor-weight validation)**: these need a
   walk-forward backtest harness comparing `dropProb` deciles to realized forward
   returns across the universe. `lib/backtest.ts` exists per-ticker; would need to
   be extended to run across `UNIVERSE` and aggregate — a bigger project, likely
   worth a dedicated session/plan.

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
