/**
 * Server-only session version helpers.
 *
 * Backed by `profiles.session_version` (see migration
 * 20260514130000_session_version.sql) and the `bump_session_version`
 * Postgres RPC.
 *
 * Lifecycle:
 *   - On successful OTP verify, the route handler calls
 *     `bumpSessionVersion(phone)` AFTER upserting the profile. The
 *     returned integer is embedded in the signed kk_auth_session cookie
 *     as `sver`.
 *   - On every protected request, `getAuthSession({ cookie })` in
 *     lib/auth.ts dynamically imports `validateSessionVersion` and
 *     rejects the cookie when its `sver` is stale.
 *   - Logout DOES NOT bump — clearing the calling browser's cookies is
 *     enough for that single device. The user's other authorised devices
 *     remain valid until a different device performs a fresh login.
 *
 * Caching:
 *   - The module-scoped cache is currently DISABLED (TTL = 0). A
 *     per-isolate cache cannot be invalidated when another isolate
 *     processes the bump, so any nonzero TTL creates a window where
 *     the old device can keep working on a different isolate after
 *     a fresh login on this one. Correctness > the cost of one
 *     indexed `select session_version from profiles where phone = $1`
 *     per protected request.
 *   - The Map and helpers are kept in place because `bumpSessionVersion`
 *     still writes-through and tests / future cross-isolate cache
 *     infrastructure can flip the TTL back on without code churn.
 *
 * Edge-runtime note:
 *   - The Next.js middleware runs in the Edge runtime. supabase-js works
 *     there (it uses fetch). With caching off, every middleware
 *     invocation does one fetch to PostgREST; Supabase handles that
 *     volume comfortably for indexed PK lookups.
 */

import { adminSupabase } from "@/lib/supabase/admin";
import type { AuthSession } from "@/lib/auth";

// TTL = 0 disables the cache: every readCurrentSessionVersion() hits
// the DB. See the module header for the cross-isolate rationale. Flip
// this back to a small positive value (e.g. 2_000) only once we have
// cross-isolate invalidation infrastructure (Redis pub/sub, etc.).
const VERSION_CACHE_TTL_MS = 0;

type CacheEntry = {
  version: number;
  expiresAt: number;
};

const versionCache = new Map<string, CacheEntry>();

function cacheGet(phone: string): number | null {
  const entry = versionCache.get(phone);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    versionCache.delete(phone);
    return null;
  }
  return entry.version;
}

function cacheSet(phone: string, version: number): void {
  versionCache.set(phone, {
    version,
    expiresAt: Date.now() + VERSION_CACHE_TTL_MS,
  });
}

export function invalidateSessionVersionCache(phone: string): void {
  if (phone) versionCache.delete(phone);
}

/**
 * Reads the current session_version for a phone, with a small TTL cache
 * to keep page-load bursts cheap. Returns null on DB error so the caller
 * can fail closed.
 */
export async function readCurrentSessionVersion(
  phone: string
): Promise<number | null> {
  if (!phone) return null;
  const cached = cacheGet(phone);
  if (cached !== null) return cached;

  const { data, error } = await adminSupabase
    .from("profiles")
    .select("session_version")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.warn("[sessionVersion] read error", error.message);
    return null;
  }
  if (!data) {
    // No profile row yet. Treat as version 0 so cookies without `sver`
    // remain valid for pre-existing users until they re-authenticate.
    cacheSet(phone, 0);
    return 0;
  }
  const v =
    typeof data.session_version === "number" ? data.session_version : 0;
  cacheSet(phone, v);
  return v;
}

/**
 * Centralised stale-session check.
 *
 * Rules:
 *   - Cookie carries `sver`: it's valid iff `sver` equals the current
 *     `profiles.session_version`.
 *   - Cookie has no `sver` (issued before this feature shipped): it's
 *     valid ONLY while the DB row is still at the migration default of
 *     `0`. The moment any login for this phone bumps the row above 0,
 *     that login by definition supersedes every cookie minted earlier
 *     for the same phone — including the un-versioned legacy ones —
 *     so they must be rejected. This is what enforces the single-
 *     active-session guarantee for the rollout cohort instead of
 *     letting legacy cookies coast for 30 days.
 *
 * Either way, a DB read failure returns false (fail closed) so a
 * transient outage doesn't silently re-enable multi-device sessions.
 */
export async function validateSessionVersion(
  session: AuthSession
): Promise<boolean> {
  const current = await readCurrentSessionVersion(session.phone);
  if (current === null) {
    // DB read failed. Fail closed.
    return false;
  }
  if (typeof session.sver !== "number") {
    // Legacy cookie. Valid only while no post-deploy login has bumped
    // the row — once it's > 0, this cookie is older than the most
    // recent login and is therefore stale.
    return current === 0;
  }
  return session.sver === current;
}

/**
 * Atomically bumps the session_version for a phone and returns the new
 * value. Used by /api/verify-otp (and its alias) immediately before
 * setting the cookie, so the cookie carries the freshest version.
 *
 * Writes through the cache so the just-issued cookie is not flagged as
 * stale by a racing request that read the old version into the cache
 * milliseconds earlier.
 *
 * Returns null on failure so the caller can refuse to mint a session
 * cookie that the validator would reject.
 */
export async function bumpSessionVersion(
  phone: string
): Promise<number | null> {
  if (!phone) return null;
  const { data, error } = await adminSupabase.rpc("bump_session_version", {
    p_phone: phone,
  });
  if (error) {
    console.error("[sessionVersion] bump RPC error", error.message);
    return null;
  }
  // The RPC returns an integer. supabase-js returns scalar RPC results
  // as-is for postgres `integer` return types.
  const next =
    typeof data === "number"
      ? data
      : typeof data === "string"
      ? Number.parseInt(data, 10)
      : Array.isArray(data) && data.length > 0
      ? Number(data[0]?.bump_session_version ?? data[0])
      : null;
  if (next === null || !Number.isFinite(next)) {
    console.error("[sessionVersion] bump RPC returned unexpected value", data);
    return null;
  }
  cacheSet(phone, next);
  return next;
}
