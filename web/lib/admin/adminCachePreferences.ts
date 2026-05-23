// Per-admin, per-tab auto-refresh interval preferences. Persisted to
// localStorage so the choice survives reloads without a DB round-trip
// and stays isolated per browser (different admins on the same box
// don't fight over the value).
//
// The interval is the GAP between auto-refreshes triggered by the
// client. It does NOT change the server-side TTL on the snapshot
// cache (that's set per-endpoint in the route file). When the
// interval has elapsed since cache.last_updated_at, the client
// kicks a single ?refresh=1 to recompute.
//
// "manual" means "never auto-refresh" — the Refresh button is the
// only way to recompute beyond whatever the server cache hands back.

export type AdminCacheInterval =
  | "manual"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "6h";

export type AdminCacheIntervalOption = {
  value: AdminCacheInterval;
  label: string;
  // Milliseconds the client should wait between auto-refreshes. 0
  // for "manual" — callers must check before scheduling a timer.
  ms: number;
};

export const ADMIN_CACHE_INTERVAL_OPTIONS: AdminCacheIntervalOption[] = [
  { value: "manual", label: "Manual only", ms: 0 },
  { value: "5m", label: "5 minutes", ms: 5 * 60 * 1000 },
  { value: "15m", label: "15 minutes", ms: 15 * 60 * 1000 },
  { value: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { value: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { value: "6h", label: "6 hours", ms: 6 * 60 * 60 * 1000 },
];

const LS_PREFIX = "kk_admin_cache_interval_";

function isValidInterval(v: unknown): v is AdminCacheInterval {
  return (
    typeof v === "string" &&
    ADMIN_CACHE_INTERVAL_OPTIONS.some((o) => o.value === v)
  );
}

function safeStorage(): Storage | null {
  // Defensive — SSR has no window; private-mode Safari sometimes
  // throws on access. Never let storage failures break a tab.
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Read the interval the admin previously chose for `key`. Falls back
// to `defaultValue` when no entry exists, the entry is corrupt, or
// localStorage is unavailable.
export function getAdminCacheInterval(
  key: string,
  defaultValue: AdminCacheInterval
): AdminCacheInterval {
  const storage = safeStorage();
  if (!storage) return defaultValue;
  try {
    const raw = storage.getItem(LS_PREFIX + key);
    if (raw === null) return defaultValue;
    return isValidInterval(raw) ? raw : defaultValue;
  } catch {
    return defaultValue;
  }
}

// Persist the choice. Soft-fail: write errors are silent so a
// browser-quota issue never breaks the tab.
export function setAdminCacheInterval(
  key: string,
  value: AdminCacheInterval
): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(LS_PREFIX + key, value);
  } catch {
    // ignore
  }
}

// Decision function used by the shared hook (and any custom caller):
// given a cache.last_updated_at timestamp and the admin's chosen
// interval, should we kick off a background ?refresh=1 right now?
//
// Returns true only when:
//   • interval is not "manual"
//   • cacheMeta has a valid last_updated_at
//   • (now - last_updated_at) >= interval_ms
//
// Note: this is a "now" decision, not a scheduling primitive. The
// hook calls this on tab-open, then sets a single setTimeout for
// the remaining gap so we don't poll.
export function shouldAutoRefresh(
  cacheMeta: { last_updated_at?: string | null } | null,
  interval: AdminCacheInterval,
  now: number
): boolean {
  if (interval === "manual") return false;
  const optMs = ADMIN_CACHE_INTERVAL_OPTIONS.find(
    (o) => o.value === interval
  )?.ms;
  if (!optMs || optMs <= 0) return false;
  const isoTs = cacheMeta?.last_updated_at;
  if (!isoTs) return false;
  const ts = Date.parse(isoTs);
  if (Number.isNaN(ts)) return false;
  return now - ts >= optMs;
}

// Milliseconds remaining until the next auto-refresh given the
// current last_updated_at and chosen interval. Returns null for
// "manual" or when input is malformed. Callers schedule a single
// setTimeout(_, remainingMs) — no polling loops.
export function msUntilNextAutoRefresh(
  cacheMeta: { last_updated_at?: string | null } | null,
  interval: AdminCacheInterval,
  now: number
): number | null {
  if (interval === "manual") return null;
  const optMs = ADMIN_CACHE_INTERVAL_OPTIONS.find(
    (o) => o.value === interval
  )?.ms;
  if (!optMs || optMs <= 0) return null;
  const isoTs = cacheMeta?.last_updated_at;
  if (!isoTs) return null;
  const ts = Date.parse(isoTs);
  if (Number.isNaN(ts)) return null;
  const delta = optMs - (now - ts);
  return Math.max(0, delta);
}
