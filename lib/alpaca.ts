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

export async function alpacaSell(
  c: Creds, symbol: string, qty: number,
): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  try {
    const r = await fetch(`${PAPER_BASE}/v2/orders`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({
        symbol, qty: String(qty), side: "sell",
        type: "market", time_in_force: "day",
      }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.message ?? `HTTP ${r.status}` };
    return { ok: true, orderId: j.id };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

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
