import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { sql } from "./db";

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error("[auth] CRITICAL: JWT_SECRET is not set — sessions use a hardcoded secret and are forgeable");
}
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-me-please-please-please",
);
const COOKIE = "vv_session";

export type Session = { uid: number; name: string };

export async function signSession(s: Session): Promise<string> {
  return await new SignJWT(s as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SECRET);
}

export async function readSession(): Promise<Session | null> {
  const tok = cookies().get(COOKIE)?.value;
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, SECRET);
    return { uid: Number(payload.uid), name: String(payload.name) };
  } catch {
    return null;
  }
}

export async function setSessionCookie(s: Session) {
  const token = await signSession(s);
  cookies().set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax",
    path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE);
}

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 10); }
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

/** Throws 401 if not signed in. Use in API routes. */
export async function requireSession(): Promise<Session> {
  const s = await readSession();
  if (!s) throw new Response("Unauthorized", { status: 401 });
  return s;
}

/** Throws 403 if signed-in user is not an admin. */
export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  const r = await sql`SELECT is_admin FROM users WHERE id=${s.uid}`;
  if (!r.rows[0]?.is_admin) throw new Response("Forbidden", { status: 403 });
  return s;
}

/** Look up user with notification settings + Alpaca + admin flag. */
export async function getUserSettings(uid: number) {
  const r = await sql`SELECT id, name, cash, ml_alerts, ml_threshold,
    ntfy_topic, discord_webhook, email, alpaca_key, alpaca_secret, auto_trade,
    smart_stops, auto_buy_size,
    autonomous_mode, auto_scan_universe, max_positions, max_pos_pct, cash_reserve_pct,
    strategy, is_admin
    FROM users WHERE id=${uid}`;
  return r.rows[0] ?? null;
}
