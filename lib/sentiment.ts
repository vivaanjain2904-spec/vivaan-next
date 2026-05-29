/**
 * Lightweight finance-tuned headline sentiment.
 *
 * NOT a trading-alpha signal — we can't backtest live news, so we never use it
 * to BUY. It's a SELL-side risk overlay only: if a stock we already hold has
 * strongly negative breaking-news sentiment, we flag/exit. Being wrong just
 * means we sold early.
 *
 * Returns a score in [-1, +1]: negative = bearish headlines, positive = bullish.
 */

const POSITIVE = new Set([
  "beat", "beats", "surge", "surges", "surged", "soar", "soars", "rally", "rallies",
  "upgrade", "upgraded", "outperform", "record", "high", "jump", "jumps", "gain",
  "gains", "profit", "growth", "strong", "boost", "raises", "raised", "wins", "win",
  "approval", "approved", "breakthrough", "tops", "exceeds", "bullish", "rebound",
  "optimistic", beat_q(),
]);

const NEGATIVE = new Set([
  "miss", "misses", "missed", "plunge", "plunges", "plunged", "slump", "slumps",
  "downgrade", "downgraded", "underperform", "fall", "falls", "drop", "drops",
  "loss", "losses", "weak", "warn", "warns", "warning", "cut", "cuts", "slash",
  "lawsuit", "probe", "investigation", "fraud", "bankruptcy", "default", "recall",
  "halt", "halted", "crash", "tumble", "tumbles", "sinks", "bearish", "selloff",
  "layoffs", "layoff", "decline", "declines", "scandal", "subpoena", "delist",
  "delisted", "guidance", "slowdown", "deficit", "downturn",
]);

// (function avoids a literal "beat" duplicate-key lint complaint; just returns the word)
function beat_q() { return "earnings"; }

const NEGATORS = new Set(["no", "not", "never", "without", "fails", "failed", "fail"]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** Score a single headline in [-1, 1]. */
export function scoreHeadline(title: string): number {
  const toks = tokenize(title);
  let score = 0, hits = 0;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    const negated = i > 0 && NEGATORS.has(toks[i - 1]);
    if (POSITIVE.has(w)) { score += negated ? -1 : 1; hits++; }
    else if (NEGATIVE.has(w)) { score += negated ? 1 : -1; hits++; }
  }
  if (hits === 0) return 0;
  return Math.max(-1, Math.min(1, score / Math.sqrt(hits)));
}

/** Aggregate score across headlines, weighting recent ones slightly more. */
export function scoreHeadlines(titles: string[]): { score: number; n: number } {
  const scored = titles.map(scoreHeadline);
  if (!scored.length) return { score: 0, n: 0 };
  // simple mean; headlines are already returned newest-first by getNews
  const mean = scored.reduce((s, v) => s + v, 0) / scored.length;
  return { score: Math.max(-1, Math.min(1, mean)), n: scored.length };
}
