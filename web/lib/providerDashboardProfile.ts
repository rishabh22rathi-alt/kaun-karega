/**
 * Shared client-side fetcher for /api/provider/dashboard-profile.
 *
 * Two consumers — the Sidebar (header chip) and the provider dashboard page
 * (full payload) — used to call this endpoint independently and pay for two
 * full Supabase round-trips on first load. This module:
 *
 *   1. De-dupes concurrent in-flight requests by returning the same Promise
 *      to all callers within an inflight window. The Sidebar and dashboard
 *      page both mount in the same tick, so this collapses the two
 *      simultaneous requests into a single network call.
 *   2. Persists the response to localStorage["kk_provider_profile"] and
 *      broadcasts the existing PROVIDER_PROFILE_UPDATED_EVENT so any other
 *      component can refresh from the cached snapshot.
 *   3. Exposes a `readCachedProviderProfile(phone)` helper for synchronous
 *      first-paint hydration on the dashboard page — only returns a hit
 *      when the cached `Phone` matches the current auth phone, so a
 *      previous-session cache for a different provider is ignored.
 *
 * Response shape is unchanged. API route behavior is unchanged.
 */

import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";

const STORAGE_KEY = "kk_provider_profile";
// Safety bound on the inflight Promise — clear after 30 s in case the
// fetch hangs and never resolves, so future callers can retry.
const INFLIGHT_SAFETY_TTL_MS = 30_000;

export type DashboardProfileProvider = {
  ProviderID?: string;
  ProviderName?: string;
  Name?: string;
  Phone?: string;
  Verified?: string;
  OtpVerified?: string;
  OtpVerifiedAt?: string;
  LastLoginAt?: string;
  PendingApproval?: string;
  Status?: string;
  DuplicateNameReviewStatus?: string;
  Services?: { Category: string; Status?: string }[];
  Areas?: { Area: string }[];
  AreaCoverage?: unknown;
  Analytics?: unknown;
};

export type DashboardProfileResponse = {
  ok?: boolean;
  provider?: DashboardProfileProvider;
  error?: string;
  message?: string;
  debug?: unknown;
};

// In-flight dedupe is keyed by range so concurrent calls for different
// ranges (e.g. Sidebar's all-time fetch + dashboard's 7d fetch) do not
// share a Promise and end up returning each other's data.
const inflightByRange = new Map<
  string,
  { promise: Promise<DashboardProfileResponse | null>; expiresAt: number }
>();

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

export function readCachedProviderProfile(
  expectedPhone?: string
): DashboardProfileProvider | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardProfileProvider | null;
    if (!parsed) return null;
    if (expectedPhone) {
      const cachedPhone = normalizePhone10(parsed.Phone);
      const expected = normalizePhone10(expectedPhone);
      if (!cachedPhone || cachedPhone !== expected) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type DashboardMetricsRange = "today" | "7d" | "30d" | "6m" | "1y" | "all";

export async function fetchProviderDashboardProfile(
  range?: DashboardMetricsRange
): Promise<DashboardProfileResponse | null> {
  // Treat undefined as "all" for cache-key and URL purposes. The endpoint
  // already defaults missing `range` to "all", so the URL stays clean when
  // the caller doesn't care about the range filter.
  const rangeKey: DashboardMetricsRange = range ?? "all";
  const isDefaultRange = rangeKey === "all";

  const existing = inflightByRange.get(rangeKey);
  if (existing && Date.now() < existing.expiresAt) {
    return existing.promise;
  }

  const promise = (async (): Promise<DashboardProfileResponse | null> => {
    try {
      const url = isDefaultRange
        ? "/api/provider/dashboard-profile"
        : `/api/provider/dashboard-profile?range=${encodeURIComponent(rangeKey)}`;
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();
      let data: DashboardProfileResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as DashboardProfileResponse) : null;
      } catch {
        data = null;
      }

      if (typeof window !== "undefined") {
        // Only the all-time fetch writes to localStorage. The Sidebar reads
        // this cache for the header chip and expects all-time Metrics; a
        // range-filtered response would corrupt that snapshot.
        if (res.ok && data?.ok && data.provider && isDefaultRange) {
          try {
            // Persist with `Name` normalized from `ProviderName`. The Sidebar's
            // cache check at Sidebar.tsx ~244 requires a non-empty `Name` field
            // to hydrate from cache; the API returns `ProviderName` so we
            // canonicalize at write time. Matches the legacy Sidebar fetch
            // behavior this helper replaced.
            const provider = data.provider;
            const persisted = {
              ...provider,
              Name: provider.Name ?? provider.ProviderName,
            };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
            window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
          } catch {
            // localStorage may be unavailable (private mode / quota) — non-fatal.
          }
        } else if (res.status === 404 && isDefaultRange) {
          // Provider deleted/missing — clear stale cache and notify listeners.
          // Only act on the default-range fetch so a transient 404 from a
          // bad range param can't wipe a valid cache.
          try {
            window.localStorage.removeItem(STORAGE_KEY);
            window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
          } catch {
            // ignore
          }
        }
      }

      return data;
    } finally {
      inflightByRange.delete(rangeKey);
    }
  })();

  inflightByRange.set(rangeKey, {
    promise,
    expiresAt: Date.now() + INFLIGHT_SAFETY_TTL_MS,
  });

  return promise;
}
