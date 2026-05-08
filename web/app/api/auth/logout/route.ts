import { NextResponse } from "next/server";
import { clearAuthSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Server-side logout. Clears the signed `kk_auth_session` HttpOnly cookie
 * (which client JS cannot delete on its own), the `kk_session_user` UI hint,
 * and the `kk_admin` UI hint. Always responds 200 — logout is idempotent
 * and we never leak whether a session was present.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearAuthSessionCookie(response);
  return response;
}

export async function GET() {
  return POST();
}
