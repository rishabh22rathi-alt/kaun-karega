import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Client-facing session probe.
 *
 * Returns 200 with `{ ok: true, phone }` when the caller's signed
 * `kk_auth_session` cookie is valid AND, when versioned, still matches
 * `profiles.session_version`.
 *
 * Returns 401 with `{ ok: false, reason }` when the cookie is missing,
 * malformed, expired, or has been invalidated by a newer login on
 * another device. Client guards (see lib/useSessionGuard.ts) use the
 * 401 to clear UI-hint cookies and redirect to /login.
 *
 * `reason: "stale"` is set specifically when the cookie was valid by
 * signature/expiry but failed the version check — gives the client a
 * way to log a useful diagnostic ("kicked out by new device") instead
 * of a generic logout.
 */
export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";

  // First pass: signature + expiry only. Lets us distinguish "no cookie"
  // from "cookie was valid but is now stale" for the response body.
  const rawSession = await getAuthSession({
    cookie: cookieHeader,
    validateVersion: false,
  });
  if (!rawSession?.phone) {
    return NextResponse.json({ ok: false, reason: "no-session" }, { status: 401 });
  }

  // Second pass: enforce version. If the cookie has no sver (legacy),
  // this still returns the session — caller stays logged in until they
  // re-authenticate.
  const validated = await getAuthSession({
    cookie: cookieHeader,
    validateVersion: true,
  });
  if (!validated?.phone) {
    return NextResponse.json({ ok: false, reason: "stale" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    phone: validated.phone,
    sver: validated.sver ?? null,
  });
}
