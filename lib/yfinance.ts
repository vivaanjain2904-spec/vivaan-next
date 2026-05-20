import yahooFinance from "yahoo-finance2";

try { (yahooFinance as any).suppressNotices?.(["yahooSurvey", "ripHistorical"]); } catch {}

export type Quote = {
  ticker: string; price: number; pct: number;
  hi52: number; lo52: number; name: string;
  open?: number; high?: number; low?: number;
  vol?: number; avgVol?: number; mcap?: number;
  pe?: number; eps?: number; beta?: number;
};

const _quoteFromRaw = (q: any, tkFallback?: string): Quote => {
  const tk = q.symbol ?? tkFallback ?? "";
  const p = q.regularMarketPrice ?? 0;
  const prev = q.regularMarketPreviousClose ?? p;
  return {
    ticker: tk, price: p,
    pct: prev ? ((p - prev) / prev) * 100 : 0,
    hi52: q.fiftyTwoWeekHigh ?? 0,
    lo52: q.fiftyTwoWeekLow ?? 0,
    name: q.longName ?? q.shortName ?? tk,
    open: q.regularMarketOpen,
    high: q.regularMarketDayHigh,
    low:  q.regularMarketDayLow,
    vol:  q.regularMarketVolume,
    avgVol: q.averageDailyVolume3Month,
    mcap: q.marketCap,
    pe: q.trailingPE, eps: q.epsTrailingTwelveMonths,
    beta: q.beta,
  };
};

export async function getQuote(ticker: string): Promise<Quote | null> {
  try {
    const q = await yahooFinance.quote(ticker);
    return _quoteFromRaw(q, ticker);
  } catch { return null; }
}

export async function getQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  if (!tickers.length) return {};
  try {
    const rs = await yahooFinance.quote(tickers);
    const arr = Array.isArray(rs) ? rs : [rs];
    const out: Record<string, Quote> = {};
    for (const q of arr) {
      const quote = _quoteFromRaw(q);
      out[quote.ticker] = quote;
    }
    return out;
  } catch { return {}; }
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function getChart(ticker: string, range: string = "1mo"): Promise<Candle[]> {
  const ranges: Record<string, { days: number; interval: any }> = {
    "1d":  { days: 1,    interval: "5m"  },
    "5d":  { days: 5,    interval: "30m" },
    "1mo": { days: 31,   interval: "1d"  },
    "3mo": { days: 92,   interval: "1d"  },
    "6mo": { days: 183,  interval: "1d"  },
    "1y":  { days: 366,  interval: "1d"  },
    "2y":  { days: 731,  interval: "1d"  },
    "5y":  { days: 1826, interval: "1wk" },
  };
  const r = ranges[range] ?? ranges["1mo"];
  const period1 = new Date(Date.now() - r.days * 86_400_000);
  const period2 = new Date();

  try {
    const res: any = await yahooFinance.chart(ticker.toUpperCase(), {
      period1, period2, interval: r.interval,
    });
    const quotes = res?.quotes ?? [];
    return quotes
      .map((q: any) => ({
        t: q.date ? Math.floor(new Date(q.date).getTime() / 1000) : 0,
        o: q.open ?? q.close ?? 0,
        h: q.high ?? q.close ?? 0,
        l: q.low  ?? q.close ?? 0,
        c: q.close ?? 0,
        v: q.volume ?? 0,
      }))
      .filter((c: Candle) => c.c > 0 && c.t > 0);
  } catch (e) {
    console.error(`[chart ${ticker}]`, e);
    return [];
  }
}

/** Last N daily closes — for sparklines. */
export async function getSparkline(ticker: string, days = 7): Promise<number[]> {
  try {
    const c = await getChart(ticker, days <= 5 ? "5d" : "1mo");
    return c.slice(-days).map(x => x.c);
  } catch { return []; }
}

export type NewsItem = { title: string; publisher: string; link: string; ts: number; thumb?: string };

export async function getNews(ticker: string, limit = 8): Promise<NewsItem[]> {
  // Try search() — most reliable in newer yahoo-finance2 versions.
  try {
    const res: any = await yahooFinance.search(ticker, {
      newsCount: limit, quotesCount: 0,
    } as any);
    const news = res?.news ?? [];
    if (news.length) {
      return news.slice(0, limit).map((n: any) => ({
        title: n.title ?? "",
        publisher: n.publisher ?? "",
        link: n.link ?? "",
        ts: n.providerPublishTime
          ? (typeof n.providerPublishTime === "number"
              ? (n.providerPublishTime > 1e12 ? n.providerPublishTime / 1000 : n.providerPublishTime)
              : new Date(n.providerPublishTime).getTime() / 1000)
          : 0,
        thumb: (n.thumbnail?.resolutions ?? [])[0]?.url,
      })).filter((n: NewsItem) => n.title);
    }
  } catch (e) { console.error(`[news search ${ticker}]`, e); }

  // Fallback to insights() which also returns news on some accounts.
  try {
    const res: any = await (yahooFinance as any).insights?.(ticker);
    const sigDevs = res?.sigDevs ?? [];
    return sigDevs.slice(0, limit).map((s: any) => ({
      title: s.headline ?? "", publisher: "Yahoo Insights",
      link: `https://finance.yahoo.com/quote/${ticker}`,
      ts: s.date ? new Date(s.date).getTime() / 1000 : 0,
    })).filter((n: NewsItem) => n.title);
  } catch { return []; }
}
