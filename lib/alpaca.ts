/**
 * Thin Alpaca REST wrapper — PAPER trading only (forced for safety).
 * Docs: https://docs.alpaca.markets/reference/postorder
 */
const PAPER_BASE = "https://paper-api.alpaca.markets";

type Creds = { key: string; secret: string };

function headers(c: Creds) {
  return {
    "APCA-API-KEY-ID":     c.key,
    "APCA-API-SECRET-KEY": c.secret,
    "Content-Type":        "application/json",
  };
}

async function _order(c: Creds, symbol: string, qty: number, side: "buy" | "sell") {
  try {
    const r = await fetch(`${PAPER_BASE}/v2/orders`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({
        symbol, qty: String(qty), side,
        type: "market", time_in_force: "day",
      }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false as const, error: j.message ?? `HTTP ${r.status}` };
    return { ok: true as const, orderId: j.id as string };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
}

export const alpacaSell = (c: Creds, symbol: string, qty: number) =>
  _order(c, symbol, qty, "sell");

export const alpacaBuy = (c: Creds, symbol: string, qty: number) =>
  _order(c, symbol, qty, "buy");

export async function alpacaPing(c: Creds): Promise<{ ok: boolean; account?: any; error?: string }> {
  try {
    const r = await fetch(`${PAPER_BASE}/v2/account`, { headers: headers(c) });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.message ?? `HTTP ${r.status}` };
    return { ok: true, account: { cash: j.cash, status: j.status, equity: j.equity } };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
