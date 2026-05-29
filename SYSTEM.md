# Vaelor — Autonomous Trader: System Architecture

A paper-trading platform whose autonomous bot trades a **validated cross-sectional
ML model** inside a **risk-managed core-satellite structure** with a hard
drawdown circuit breaker. Built to pursue upside *without* betting the whole
portfolio on an unproven signal.

> **Design philosophy:** the model's edge is real but small (~0.55 ROC-AUC).
> So the architecture never lets the model risk the whole portfolio — it tilts
> around a market-tracking core, with hard floors on losses. "Max realistic
> profit without losing everything."

---

## Two repos, one system

| Repo | Role |
|---|---|
| `vivaan-next` (this app) | Next.js 14 + Neon Postgres. UI, auth, paper-trade engine, autonomous trader, Alpaca mirror. Deployed on Vercel → vaelor.dev |
| `ai-portfolio-agent` (Python) | The research + model. Builds the cross-sectional panel, trains the model, walk-forward backtests, and **uploads daily scores** into this app's `ml_signals` table. |

The bridge: `ai-portfolio-agent/upload_signals.py` writes percentile-rank drop
probabilities to `ml_signals`; the trader reads them as a "Python override."

---

## Capital structure (per cycle)

```
                 ┌─────────────────────────────────────────┐
   Total equity  │  CORE 60%   │  SATELLITE ~25%  │ CASH 15%│
                 │  (VOO)      │  (model picks)   │ reserve │
                 └─────────────────────────────────────────┘
                   never sold     model trades      dry powder
                   by the model   up to 40 names
```

- **Core** (`core_ticker`, `core_pct`): an index ETF held at target weight, never
  sold by the model. Guarantees the portfolio roughly tracks the market — fixing
  the backtests' main failure (a stock-picking-only strategy underperformed SPY).
- **Satellite**: the model's stock picks, funded only from the non-core sleeve.
  It can tilt returns up or down but can't sink the whole ship.
- **Cash reserve** (`cash_reserve_pct`): always kept uninvested.

---

## The trade cycle (`/api/auto-trade/run`)

1. **Load model overrides** — pull `ml_signals` into a map. When a ticker has a
   score, the bot trades on it; otherwise it falls back to its own TA signal.
2. **SELL pass** (every held position except the core):
   - stop-loss hit · take-profit hit · model says risky (`dropProb >= ml_threshold`)
   - **news risk overlay** — borderline holdings (`dropProb >= 0.50`) with strongly
     negative headlines (sentiment ≤ −0.4) are exited. Sell-side only.
   - trailing-stop ratchet on survivors
3. **Mark to market** at live prices.
4. **Circuit breaker** — if equity is more than `circuit_breaker_pct` below its
   high-water mark: liquidate the satellite, keep the core, pause new buys 7 days.
5. **Cooldown gate** — if in a post-breach cooldown, stop here.
6. **Core rebalance** — top the core back up toward `core_pct` if it has drifted.
7. **Bear-regime gate** — skip new buys if SPY is in a bear tape.
8. **BUY pass** — rank the full ~540-name universe by the model (safest first),
   score the top 25, buy the best up to `MAX_NEW_BUYS_PER_CYCLE`, sized by
   conviction and capped by `max_pos_pct`. Smart ATR stops/targets attached.

---

## Every knob (all on the `users` row)

| Setting | Current | What it does | Tune toward… |
|---|---|---|---|
| `core_pct` | 0.60 | Fraction held in the index core | ↑ = safer / closer to market · ↓ = bigger model bet |
| `core_ticker` | VOO | The core index ETF | any broad ETF (SPY/VOO/VTI) |
| `circuit_breaker_pct` | 0.20 | Drawdown that triggers liquidation | ↓ = tighter loss floor (more whipsaw) |
| `max_positions` | 40 | Max satellite holdings | ↑ = more diversification |
| `max_pos_pct` | 0.08 | Max weight per single name | ↓ = less concentration risk |
| `auto_buy_size` | $2,000 | Base $ per new buy | ↑ = deploys capital faster |
| `cash_reserve_pct` | 0.15 | Cash always kept | ↑ = more dry powder |
| `ml_threshold` | 0.65 | Model rank above which a held name is sold | ↓ = sells sooner |
| `autonomous_mode` | on | Master switch for the bot | — |
| `auto_scan_universe` | on | Allow scanning beyond held names | — |
| `auto_trade` | **off** | Mirror to real Alpaca (off = paper only) | leave OFF until proven |

Code-level constants (in `app/api/auto-trade/run/route.ts`):
`MAX_NEW_BUYS_PER_CYCLE = 5`, `ML_RANK_CANDIDATES = 25`.

---

## The model (ai-portfolio-agent)

- **Cross-sectional**: one global HistGradientBoosting trained on a 540-ticker
  panel (~645k rows), ranking every stock's drop probability *relative to the
  universe each day*.
- **Features**: per-ticker TA (RSI, MACD, Bollinger, vol, momentum) + market
  context (VIX, yield curve, credit spread, sector breadth) + cross-sectional
  ranks.
- **Validation**: strict walk-forward. Out-of-sample AUC **0.547** (drop) /
  **0.585** (upside). Real but small edge — hence the defensive architecture.
- **Honest result**: in the 2023–2026 bull market no variant beat SPY on
  risk-adjusted return. Defensive strategies cut drawdown at the cost of return.
  Full log in `ai-portfolio-agent/RESULTS.md`.

---

## Daily automation

`ai-portfolio-agent` runs a macOS LaunchAgent (`com.vaelor.dailyrefresh`,
weekdays 5:30 AM): rebuild panel → retrain model → upload fresh `ml_signals`.
So the live bot always trades on current scores. Logs: `daily_refresh.log`.

---

## Operating notes

- **Reverting the model**: clear the `ml_signals` table → the bot falls back to
  its own TA signal.
- **Pausing the bot**: set `autonomous_mode = false`.
- **Pausing daily refresh**: `launchctl unload ~/Library/LaunchAgents/com.vaelor.dailyrefresh.plist`
- **Before real money**: keep `auto_trade = off` for 6+ months of paper; only
  flip it after live results track the backtest. See `ai-portfolio-agent/deploy.md`.

## Honest limitations

15-min delayed free data · no fundamental/alt data · daily horizon only · news
sentiment is a risk flag, not validated alpha · the edge is small and may not
persist. This is a disciplined, well-hedged learning system — not a money machine.
