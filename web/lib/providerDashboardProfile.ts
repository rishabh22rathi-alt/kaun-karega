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

let inflightPromise: Promise<DashboardProfileResponse | null> | null = null;
let inflightExpiresAt = 0;

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

export async function fetchProviderDashboardProfile(): Promise<DashboardProfileResponse | null> {
  if (inflightPromise && Date.now() < inflightExpiresAt) {
    return inflightPromise;
  }

  const promise = (async (): Promise<DashboardProfileResponse | null> => {
    try {
      const res = await fetch("/api/provider/dashboard-profile", { cache: "no-store" });
      const text = await res.text();
      let data: DashboardProfileResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as DashboardProfileResponse) : null;
      } catch {
        data = null;
      }

      if (typeof window !== "undefined") {
        if (res.ok && data?.ok && data.provider) {
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
        } else if (res.status === 404) {
          // Provider deleted/missing — clear stale cache and notify listeners.
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
      inflightPromise = null;
      inflightExpiresAt = 0;
    }
  })();

  inflightPromise = promise;
  inflightExpiresAt = Date.now() + INFLIGHT_SAFETY_TTL_MS;

  return promise;
}
