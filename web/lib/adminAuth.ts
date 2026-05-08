import { getAuthSession } from "./auth";
import { verifyAdminByPhone } from "./admin/adminVerifier";

// Re-export so existing callers importing AdminSession from here don't break.
export type { AdminSession } from "./admin/adminVerifier";

/**
 * Checks whether a given phone belongs to an active admin.
 * Phone should be in the format stored in the session (e.g. "91XXXXXXXXXX").
 *
 * Delegates to verifyAdminByPhone() — see lib/admin/adminVerifier.ts for the
 * current backend and the TODO marking where GAS will be replaced.
 *
 * Never throws — returns { ok: false } on any error.
 */
export async function checkAdminByPhone(
  phone: string
): Promise<{ ok: true; admin: import("./admin/adminVerifier").AdminSession } | { ok: false }> {
  if (!phone) return { ok: false };
  return verifyAdminByPhone(phone);
}

/**
 * Server-side admin guard for Next.js route handlers.
 *
 * 1. Reads the kk_auth_session cookie from the request.
 * 2. Extracts the phone from the session.
 * 3. Delegates to checkAdminByPhone to confirm active admin status.
 *
 * Returns { ok: true, admin } on success, { ok: false } when unauthenticated
 * or when the phone is not an admin.
 */
export async function requireAdminSession(
  request: Request
): Promise<{ ok: true; admin: import("./admin/adminVerifier").AdminSession } | { ok: false }> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const session = await getAuthSession({ cookie: cookieHeader });
  if (!session?.phone) return { ok: false };
  return checkAdminByPhone(session.phone);
}
