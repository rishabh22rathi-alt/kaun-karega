import { adminSupabase } from "@/lib/supabase/admin";

// Permanent failure codes from Firebase Cloud Messaging that indicate the
// token is no longer reachable. Per Firebase docs:
//   - registration-token-not-registered: app uninstalled or token expired
//   - invalid-registration-token: malformed/never-valid token
//   - invalid-argument: paired with an otherwise valid payload, means token
//     is rejected by FCM (treat as dead)
// Transient codes (quota-exceeded, unavailable, internal-error) are NOT in
// this set — we leave those tokens active and let the next send retry them.
// `mismatched-credential` is also excluded — that means our service account
// is wrong, not the token, and should NEVER cascade into deactivations.
const PERMANENT_INVALID_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export function isInvalidTokenError(errorCode: string): boolean {
  return PERMANENT_INVALID_CODES.has(errorCode);
}

export async function deactivateInvalidTokens(
  tokens: string[]
): Promise<{ deactivated: number; error: string | null }> {
  const cleaned = Array.from(
    new Set(tokens.filter((t) => typeof t === "string" && t.length >= 20))
  );
  if (cleaned.length === 0) {
    return { deactivated: 0, error: null };
  }

  const now = new Date().toISOString();
  // Soft-deactivate only. We keep rows so the audit trail (when a token
  // died, on what error) remains queryable. Mirrors the /devices/deactivate
  // route shape.
  const { data, error } = await adminSupabase
    .from("native_push_devices")
    .update({
      active: false,
      revoked_at: now,
      updated_at: now,
    })
    .in("fcm_token", cleaned)
    .eq("active", true)
    .select("id");

  if (error) {
    console.error("[push/invalidateTokens] update failed", {
      code: error.code,
      message: error.message,
    });
    return { deactivated: 0, error: error.message };
  }

  return { deactivated: data?.length ?? 0, error: null };
}
