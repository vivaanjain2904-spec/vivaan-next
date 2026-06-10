/**
 * Thin Alpaca REST wrapper — supports paper and live trading.
 * Docs: https://docs.alpaca.markets/reference/postorder
 */
const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE  = "https://api.alpaca.markets";

export type AlpacaMode = "paper" | "live";

type Creds = { key: string; secret: string; mode?: AlpacaMode };

function base(c: Creds) {
  return c.mode === "live" ? LIVE_BASE : PAPER_BASE;
}

function headers(c: Creds) {
  return {
    "APCA-API-KEY-ID":     c.key,
    "APCA-API-SECRET-KEY": c.secret,
    "Content-Type":        "application/json",
  };
}

export type OrderResult = {
  ok: boolean; orderId?: string; error?: string;
  status?: string; filledQty?: number; filledAvgPrice?: number; partial?: boolean;
};

/** Latest trade price for marketable-limit pricing. */
async function _lastPrice(c: Creds, symbol: string): Promise<number | null> {
  const key = process.env.ALPACA_DATA_KEY || c.key;
  const secret = process.env.ALPACA_DATA_SECRET || c.secret;
  try {
    const r = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest?feed=iex`,
      { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret } });
    if (!r.ok) return null;
    const j = await r.json();
    const p = Number(j?.trade?.p);
    return p > 0 ? p : null;
  } catch { return null; }
}

async function _getOrder(c: Creds, id: string) {
  const r = await fetch(`${base(c)}/v2/orders/${id}`, { headers: headers(c) });
  if (!r.ok) return null;
  return r.json();
}

/**
 * Robust order: a MARKETABLE LIMIT (limit set a small buffer through the last
 * price) instead of a blind market order — caps slippage on thin names while
 * still filling immediately in normal conditions. Then polls briefly to confirm
 * the fill and reports partial/failed status so callers can reconcile honestly.
 *
 * SLIP_BUFFER: how far through last price we set the limit (buys above / sells
 * below). Wide enough to fill in normal liquidity, tight enough to reject a
 * runaway gap. Falls back to a market order only if no price is available.
 */
const SLIP_BUFFER = 0.005;   // 0.5%
const POLL_MS = 700, POLL_TRIES = 4;

async function _order(c: Creds, symbol: string, qty: number, side: "buy" | "sell"): Promise<OrderResult> {
  try {
    const last = await _lastPrice(c, symbol);
    const body: any = { symbol, qty: String(qty), side, time_in_force: "day" };
    if (last) {
      const lim = side === "buy" ? last * (1 + SLIP_BUFFER) : last * (1 - SLIP_BUFFER);
      body.type = "limit";
      body.limit_price = lim.toFixed(2);
    } else {
      body.type = "market";   // no price feed → fall back
    }

    // Submit with one retry on transient (5xx / network) failures.
    let j: any = null, submitted = false;
    for (let attempt = 0; attempt < 2 && !submitted; attempt++) {
      try {
        const r = await fetch(`${base(c)}/v2/orders`, { method: "POST", headers: headers(c), body: JSON.stringify(body) });
        j = await r.json();
        if (r.ok) { submitted = true; break; }
        // 4xx (e.g. insufficient buying power) → don't retry, it'll just fail again
        if (r.status < 500) return { ok: false, error: j.message ?? `HTTP ${r.status}` };
      } catch (e: any) {
        j = { _err: String(e?.message ?? e) };
      }
      if (attempt === 0) await new Promise(res => setTimeout(res, 500));
    }
    if (!submitted) return { ok: false, error: j?.message ?? j?._err ?? "order submit failed after retry" };

    const id = j.id as string;
    // Poll for fill confirmation
    let last_status = j.status;
    let filledQty = Number(j.filled_qty ?? 0);
    let filledAvg = Number(j.filled_avg_price ?? 0);
    for (let i = 0; i < POLL_TRIES; i++) {
      if (last_status === "filled") break;
      await new Promise(res => setTimeout(res, POLL_MS));
      const o = await _getOrder(c, id);
      if (o) { last_status = o.status; filledQty = Number(o.filled_qty ?? 0); filledAvg = Number(o.filled_avg_price ?? 0); }
    }
    const partial = filledQty > 0 && filledQty < qty;
    return {
      ok: filledQty > 0,          // ok only if SOMETHING filled
      orderId: id, status: last_status,
      filledQty, filledAvgPrice: filledAvg || undefined, partial,
      error: filledQty === 0 ? `not filled (status: ${last_status})` : undefined,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export const alpacaSell = (c: Creds, symbol: string, qty: number) =>
  _order(c, symbol, qty, "sell");

export const alpacaBuy = (c: Creds, symbol: string, qty: number) =>
  _order(c, symbol, qty, "buy");

/** Cancel a still-open order (e.g. a limit that didn't fill). */
export async function alpacaCancel(c: Creds, orderId: string): Promise<boolean> {
  try {
    const r = await fetch(`${base(c)}/v2/orders/${orderId}`, { method: "DELETE", headers: headers(c) });
    return r.ok || r.status === 404;
  } catch { return false; }
}

export async function alpacaPing(c: Creds): Promise<{ ok: boolean; account?: any; error?: string }> {
  try {
    const r = await fetch(`${base(c)}/v2/account`, { headers: headers(c) });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.message ?? `HTTP ${r.status}` };
    return { ok: true, account: { cash: j.cash, status: j.status, equity: j.equity } };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Open (unfilled) order quantity per ticker, split by side. Used to make broker sync idempotent before fills. */
export async function alpacaOpenOrderQty(c: Creds): Promise<{ ok: boolean; pendingBuy?: Record<string, number>; pendingSell?: Record<string, number>; error?: string }> {
  try {
    const r = await fetch(`${base(c)}/v2/orders?status=open&limit=500`, { headers: headers(c) });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.message ?? `HTTP ${r.status}` };
    const pendingBuy: Record<string, number> = {};
    const pendingSell: Record<string, number> = {};
    for (const o of j) {
      const sym = String(o.symbol).toUpperCase();
      const remaining = Number(o.qty ?? 0) - Number(o.filled_qty ?? 0);
      if (remaining <= 0) continue;
      const target = o.side === "buy" ? pendingBuy : pendingSell;
      target[sym] = (target[sym] ?? 0) + remaining;
    }
    return { ok: true, pendingBuy, pendingSell };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Look up an asset's tradability on Alpaca. Used to give a clearer error when an order is rejected as "not found". */
export async function alpacaAssetInfo(c: Creds, symbol: string): Promise<{ ok: boolean; found: boolean; tradable?: boolean; status?: string; exchange?: string; error?: string }> {
  try {
    const r = await fetch(`${base(c)}/v2/assets/${encodeURIComponent(symbol)}`, { headers: headers(c) });
    if (r.status === 404) return { ok: true, found: false };
    const j = await r.json();
    if (!r.ok) return { ok: false, found: false, error: j.message ?? `HTTP ${r.status}` };
    return { ok: true, found: true, tradable: !!j.tradable, status: j.status, exchange: j.exchange };
  } catch (e: any) {
    return { ok: false, found: false, error: String(e?.message ?? e) };
  }
}

/** Live broker positions, keyed by ticker → qty. Used for reconciliation. */
export async function alpacaPositions(c: Creds): Promise<{ ok: boolean; positions?: Record<string, number>; error?: string }> {
  try {
    const r = await fetch(`${base(c)}/v2/positions`, { headers: headers(c) });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.message ?? `HTTP ${r.status}` };
    const positions: Record<string, number> = {};
    for (const p of j) positions[String(p.symbol).toUpperCase()] = Number(p.qty);
    return { ok: true, positions };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
