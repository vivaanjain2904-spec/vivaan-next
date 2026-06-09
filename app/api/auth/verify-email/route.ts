import { NextResponse } from "next/server";
import { sql, initDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=invalid-token", req.url));
  }
  await initDb().catch(() => {});
  const r = await sql`
    SELECT id, name FROM users
    WHERE email_verify_token = ${token} AND email_verified = FALSE
    LIMIT 1
  `;
  const u = r.rows[0];
  if (!u) {
    return NextResponse.redirect(new URL("/login?error=invalid-token", req.url));
  }
  await sql`
    UPDATE users SET email_verified = TRUE, email_verify_token = NULL
    WHERE id = ${u.id}
  `;
  const res = NextResponse.redirect(new URL("/overview", req.url));
  // Log them in automatically
  await setSessionCookie({ uid: u.id, name: u.name });
  return res;
}
