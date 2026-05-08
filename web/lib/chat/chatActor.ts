/**
 * Centralized chat / need-chat identity binding.
 *
 * Threat model:
 *   - The signed `kk_auth_session` cookie (verified by `getAuthSession`) is
 *     the SOLE source of caller identity for every chat-side action.
 *   - Request-body fields like `UserPhone`, `ProviderPhone`,
 *     `loggedInProviderPhone`, `phone`, `requesterPhone`, `SessionPhone`,
 *     and any `*Phone` variant are no longer trusted for authorization.
 *     Callers may still pass `ActorType` / `ActorRole` as a UI HINT, but
 *     all access checks are performed against this resolved identity.
 *
 * Returned shape:
 *   - `{ ok: true, sessionPhone, provider }` — the verified 10-digit phone
 *     plus an optional provider record (null when the session phone has no
 *     row in `providers`). Callers compare `sessionPhone` against
 *     `chat_threads.user_phone` for user-side access, and `provider.providerId`
 *     against `chat_threads.provider_id` for provider-side access.
 *   - `{ ok: false, status: 401, error }` — no signed session cookie.
 *   - `{ ok: false, status: 403, error }` — session present but lookup failed.
 */

import { adminSupabase } from "../supabase/admin";
import { getAuthSession } from "../auth";

export type ResolvedProvider = {
  providerId: string;
  providerPhone: string; // 10-digit
  providerName: string;
};

export type ChatSessionIdentity = {
  ok: true;
  sessionPhone: string; // 10-digit
  provider: ResolvedProvider | null;
};

export type ChatSessionIdentityFailure = {
  ok: false;
  status: 401 | 403;
  error: string;
};

export type ChatSessionIdentityResult =
  | ChatSessionIdentity
  | ChatSessionIdentityFailure;

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

/**
 * Verify the signed session cookie and (best-effort) hydrate the provider
 * row attached to that phone. Provider hydration is non-fatal: if the
 * lookup errors transiently, the caller still gets a session identity with
 * `provider: null` and provider-side actions will fall through to a clean
 * 403 from `canChatActorAccessThread`.
 */
export async function resolveAuthenticatedChatActor(
  cookieHeader: string
): Promise<ChatSessionIdentityResult> {
  const session = await getAuthSession({ cookie: cookieHeader });
  const sessionPhone = normalizePhone10(session?.phone);
  if (!session || sessionPhone.length !== 10) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const { data: providerRows, error } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name, phone")
    .or(`phone.eq.${sessionPhone},phone.eq.91${sessionPhone}`)
    .limit(5);

  if (error) {
    // Don't leak DB errors to the client. Treat as no-provider-row so the
    // caller can still authenticate as a user-side actor.
    console.warn(
      "[chatActor] provider lookup failed; proceeding as user-only identity",
      error.message
    );
    return { ok: true, sessionPhone, provider: null };
  }

  const provider = (providerRows || []).find(
    (row) =>
      typeof row.provider_id === "string" &&
      row.provider_id.length > 0 &&
      normalizePhone10(row.phone) === sessionPhone
  );

  if (!provider) {
    return { ok: true, sessionPhone, provider: null };
  }

  return {
    ok: true,
    sessionPhone,
    provider: {
      providerId: String(provider.provider_id || "").trim(),
      providerPhone: sessionPhone,
      providerName: String(provider.full_name || "").trim(),
    },
  };
}
