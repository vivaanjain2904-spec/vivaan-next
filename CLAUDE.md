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
