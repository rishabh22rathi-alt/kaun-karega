import { getAuthSession } from "./auth";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";

export type AdminSession = {
  phone: string;
  name?: string;
  role?: string;
  permissions?: string[];
};

/**
 * Checks whether a given phone belongs to an active admin by calling
 * GAS admin_verify. Phone should be in the format already stored in
 * the session (e.g. "91XXXXXXXXXX").
 *
 * Safe to call from any server context where the phone is already known.
 * Never throws — returns { ok: false } on any error.
 */
export async function checkAdminByPhone(
  phone: string
): Promise<{ ok: true; admin: AdminSession } | { ok: false }> {
  if (!phone || !APPS_SCRIPT_URL) return { ok: false };

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_verify", phone }),
      cache: "no-store",
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (data?.ok && data?.admin) {
      return { ok: true, admin: data.admin as AdminSession };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Server-side admin guard for Next.js route handlers.
 *
 * 1. Reads the kk_auth_session cookie from the request.
 * 2. Extracts the phone from the session.
 * 3. Delegates to checkAdminByPhone to confirm active admin status via GAS.
 *
 * Returns { ok: true, admin } on success, { ok: false } when unauthenticated
 * or when the phone is not an admin.
 */
export async function requireAdminSession(
  request: Request
): Promise<{ ok: true; admin: AdminSession } | { ok: false }> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const session = getAuthSession({ cookie: cookieHeader });
  if (!session?.phone) return { ok: false };
  return checkAdminByPhone(session.phone);
}
