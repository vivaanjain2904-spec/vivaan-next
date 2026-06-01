/**
 * Yahoo Finance via direct HTTP — no yahoo-finance2 schema-validation pain.
 * The v8/chart endpoint gives us quote + OHLCV in one call without needing a crumb.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function _yfetch<T = any>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`yf ${r.status} ${url.slice(0, 80)}`);
  return r.json() as Promise<T>;
}

export type Quote = {
  ticker: string; price: number; pct: number;
  hi52: number; lo52: number; name: string;
  open?: number; high?: number; low?: number;
  vol?: number; mcap?: number;
};

// Real-time last trade for ONE symbol from Alpaca's free IEX feed.
// Returns {price, prevClose} or null (missing keys / failure → caller uses Yahoo).
async function getAlpacaPrice(tk: string): Promise<{ price: number; prevClose: number } | null> {
  const key = process.env.ALPACA_DATA_KEY || process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_DATA_SECRET || process.env.ALPACA_SECRET;
  if (!key || !secret) return null;
  try {
    const r = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(tk)}/snapshot?feed=iex`,
      { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret }, next: { revalidate: 0 } });
    if (!r.ok) return null;
    const s: any = await r.json();
    const price = Number(s?.latestTrade?.p) ||
      (s?.latestQuote ? (Number(s.latestQuote.ap) + Number(s.latestQuote.bp)) / 2 : 0);
    const prevClose = Number(s?.prevDailyBar?.c) || Number(s?.dailyBar?.o) || 0;
    return price > 0 ? { price, prevClose } : null;
  } catch { return null; }
}

export async function getQuote(ticker: string): Promise<Quote | null> {
  const tk = ticker.toUpperCase();
  try {
    // Yahoo gives name + 52-week range + day OHLC; fetch it for the metadata.
    const [j, rt] = await Promise.all([
      _yfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?interval=1d&range=5d`).catch(() => null),
      getAlpacaPrice(tk),   // real-time price overlay
    ]);
    const r = (j as any)?.chart?.result?.[0];
    if (!r && !rt) return null;
    const m = r?.meta ?? {};
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter(c => c != null) as number[];
    // Prefer Alpaca real-time price; fall back to Yahoo's (delayed) price.
    const yahooPrice = m.regularMarketPrice ?? valid[valid.length - 1] ?? 0;
    const price = rt?.price ?? yahooPrice;
    const prev = rt?.prevClose || m.chartPreviousClose || m.previousClose || valid[valid.length - 2] || price;
    return {
      ticker: tk,
      price,
      pct: prev ? ((price - prev) / prev) * 100 : 0,
      hi52: m.fiftyTwoWeekHigh ?? 0,
      lo52: m.fiftyTwoWeekLow ?? 0,
      name: m.longName ?? m.shortName ?? tk,
      open: r?.indicators?.quote?.[0]?.open?.find((x: any) => x != null),
      high: m.regularMarketDayHigh,
      low:  m.regularMarketDayLow,
      vol:  m.regularMarketVolume,
    };
  } catch (e) {
    console.error(`[quote ${tk}]`, (e as Error).message);
    return null;
  }
}

// Real-time quotes from Alpaca's free IEX snapshot feed (one call, many symbols).
// Uses platform data keys; returns {} on missing keys / failure so callers fall
// back to the delayed Yahoo path.
async function getQuotesAlpaca(tickers: string[]): Promise<Record<string, Quote>> {
  const key = process.env.ALPACA_DATA_KEY || process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_DATA_SECRET || process.env.ALPACA_SECRET;
  const out: Record<string, Quote> = {};
  if (!key || !secret || !tickers.length) return out;
  const syms = tickers.map(t => t.toUpperCase()).join(",");
  try {
    const r = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(syms)}&feed=iex`,
      { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret }, next: { revalidate: 0 } });
    if (!r.ok) return out;
    const j = await r.json();
    const snaps = j?.snapshots ?? j ?? {};
    for (const [sym, s] of Object.entries<any>(snaps)) {
      const last = Number(s?.latestTrade?.p) ||
        (s?.latestQuote ? (Number(s.latestQuote.ap) + Number(s.latestQuote.bp)) / 2 : 0);
      const day = s?.dailyBar ?? {};
      const prev = Number(s?.prevDailyBar?.c) || Number(day.o) || 0;
      if (!last) continue;
      const tk = sym.toUpperCase();
      out[tk] = {
        ticker: tk,
        price: last,
        pct: prev > 0 ? ((last - prev) / prev) * 100 : 0,
        hi52: 0, lo52: 0, name: tk,
        open: Number(day.o) || undefined,
        high: Number(day.h) || undefined,
        low: Number(day.l) || undefined,
        vol: Number(day.v) || undefined,
      };
    }
  } catch {}
  return out;
}

export async function getQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  if (!tickers.length) return {};
  // 1) Real-time via Alpaca where available.
  const out = await getQuotesAlpaca(tickers);
  // 2) Fill gaps with delayed Yahoo for anything Alpaca didn't return.
  const missing = tickers.map(t => t.toUpperCase()).filter(t => !out[t]);
  if (missing.length) {
    const arr = await Promise.all(missing.map(t => getQuote(t)));
    arr.forEach(q => { if (q) out[q.ticker] = q; });
  }
  return out;
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

const INTERVAL: Record<string, string> = {
  "1d": "5m", "5d": "30m", "1mo": "1d", "3mo": "1d",
  "6mo": "1d", "1y": "1d", "2y": "1wk", "5y": "1wk",
};

export async function getChart(ticker: string, range: string = "1mo"): Promise<Candle[]> {
  const tk = ticker.toUpperCase();
  const interval = INTERVAL[range] ?? "1d";
  try {
    const j: any = await _yfetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?interval=${interval}&range=${range}`,
    );
    const r = j?.chart?.result?.[0];
    if (!r) return [];
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i]; if (c == null) continue;
      out.push({
        t: ts[i],
        o: q.open?.[i] ?? c,
        h: q.high?.[i] ?? c,
        l: q.low?.[i]  ?? c,
        c,
        v: q.volume?.[i] ?? 0,
      });
    }
    return out;
  } catch (e) {
    console.error(`[chart ${tk}]`, (e as Error).message);
    return [];
  }
}

export async function getSparkline(ticker: string, days = 7): Promise<number[]> {
  const c = await getChart(ticker, "1mo");
  return c.slice(-days).map(x => x.c);
}

export type NewsItem = { title: string; publisher: string; link: string; ts: number; thumb?: string };

export async function getNews(ticker: string, limit = 8): Promise<NewsItem[]> {
  const tk = ticker.toUpperCase();
  try {
    const j: any = await _yfetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(tk)}&newsCount=${limit}&quotesCount=0`,
    );
    return (j?.news ?? []).slice(0, limit).map((n: any) => ({
      title: n.title ?? "",
      publisher: n.publisher ?? "",
      link: n.link ?? "",
      ts: typeof n.providerPublishTime === "number" ? n.providerPublishTime : 0,
      thumb: (n.thumbnail?.resolutions ?? [])[0]?.url,
    })).filter((n: NewsItem) => n.title);
  } catch (e) {
    console.error(`[news ${tk}]`, (e as Error).message);
    return [];
  }
}

/**
 * Returns the days until the next earnings report (positive = future, negative = past).
 * Returns null if Yahoo Finance has no upcoming earnings date for this ticker.
 * Used by the auto-trader to skip new positions inside the earnings window.
 */
export async function daysUntilEarnings(ticker: string): Promise<number | null> {
  const tk = ticker.toUpperCase();
  try {
    const j: any = await _yfetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tk)}?modules=calendarEvents`,
    );
    const dates: { raw: number }[] = j?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? [];
    if (!dates.length) return null;
    // Pick the earliest future date; fall back to the first listed if all past
    const now = Math.floor(Date.now() / 1000);
    const future = dates.filter(d => d?.raw && d.raw >= now).sort((a, b) => a.raw - b.raw);
    const target = future[0] ?? dates[0];
    if (!target?.raw) return null;
    return Math.floor((target.raw - now) / 86400);
  } catch (e) {
    return null;
  }
}
