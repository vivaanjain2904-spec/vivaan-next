import yahooFinance from "yahoo-finance2";

// Silence the survey notice on first call
yahooFinance.suppressNotices(["yahooSurvey", "ripHistorical"]);

export type Quote = {
  ticker: string;
  price: number;
  pct: number;            // day change %
  hi52: number;
  lo52: number;
  name: string;
};

export async function getQuote(ticker: string): Promise<Quote | null> {
  try {
    const q = await yahooFinance.quote(ticker);
    const p = q.regularMarketPrice ?? 0;
    const prev = q.regularMarketPreviousClose ?? p;
    return {
      ticker,
      price: p,
      pct: prev ? ((p - prev) / prev) * 100 : 0,
      hi52: q.fiftyTwoWeekHigh ?? 0,
      lo52: q.fiftyTwoWeekLow ?? 0,
      name: q.longName ?? q.shortName ?? ticker,
    };
  } catch {
    return null;
  }
}

/** Batch quotes — much faster than N round-trips. */
export async function getQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  if (!tickers.length) return {};
  try {
    const rs = await yahooFinance.quote(tickers);
    const arr = Array.isArray(rs) ? rs : [rs];
    const out: Record<string, Quote> = {};
    for (const q of arr) {
      const tk = q.symbol;
      const p = q.regularMarketPrice ?? 0;
      const prev = q.regularMarketPreviousClose ?? p;
      out[tk] = {
        ticker: tk,
        price: p,
        pct: prev ? ((p - prev) / prev) * 100 : 0,
        hi52: q.fiftyTwoWeekHigh ?? 0,
        lo52: q.fiftyTwoWeekLow ?? 0,
        name: q.longName ?? q.shortName ?? tk,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function getChart(ticker: string, range: string = "1mo"): Promise<Candle[]> {
  const periodMap: Record<string, number> = {
    "1d": 1, "5d": 5, "1mo": 30, "3mo": 90, "6mo": 180,
    "1y": 365, "2y": 730, "5y": 1825,
  };
  const days = periodMap[range] ?? 30;
  const interval =
    days <= 1 ? "5m" : days <= 5 ? "30m" : days <= 90 ? "1d" : days <= 730 ? "1d" : "1wk";
  const period1 = new Date(Date.now() - days * 24 * 3600 * 1000);
  try {
    const res = await yahooFinance.chart(ticker, {
      period1, interval: interval as any,
    });
    return (res.quotes ?? []).map((q: any) => ({
      t: new Date(q.date).getTime() / 1000,
      o: q.open ?? 0, h: q.high ?? 0, l: q.low ?? 0, c: q.close ?? 0, v: q.volume ?? 0,
    })).filter((q: Candle) => q.c > 0);
  } catch {
    return [];
  }
}

export type NewsItem = { title: string; publisher: string; link: string; ts: number };

export async function getNews(ticker: string, limit = 6): Promise<NewsItem[]> {
  try {
    const res = await yahooFinance.search(ticker, { newsCount: limit, quotesCount: 0 });
    return (res.news ?? []).slice(0, limit).map((n: any) => ({
      title: n.title ?? "",
      publisher: n.publisher ?? "",
      link: n.link ?? "",
      ts: n.providerPublishTime ? new Date(n.providerPublishTime).getTime() / 1000 : 0,
    })).filter((n: NewsItem) => n.title);
  } catch {
    return [];
  }
}
