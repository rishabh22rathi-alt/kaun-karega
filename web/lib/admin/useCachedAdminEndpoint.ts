"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CacheStatusBarMetadata } from "@/components/admin/CacheStatusBar";
import {
  type AdminCacheInterval,
  getAdminCacheInterval,
  msUntilNextAutoRefresh,
  setAdminCacheInterval,
} from "@/lib/admin/adminCachePreferences";

// Single hook every cache-aware admin tab uses. Owns the fetch +
// cache metadata + manual refresh + interval-driven auto refresh
// pattern that previously lived inline in ProvidersTab.
//
// Contract / invariants:
//   • Fetch fires only while `enabled` is true (the tab is open).
//   • Manual refresh is always allowed via the returned `refresh` fn.
//   • Auto refresh is scheduled with a single setTimeout — never a
//     polling interval — based on the admin's chosen interval and
//     the snapshot's last_updated_at. Re-armed on tab open, on a
//     successful refresh, and on interval change.
//   • Interval preference is persisted via adminCachePreferences
//     (localStorage), keyed by `intervalStorageKey`.
//   • Soft-fail: a fetch error sets `error` and clears `cacheMeta`
//     so the UI can still offer Refresh; it never throws.

export type UseCachedAdminEndpointOpts = {
  // Stable URL of the cached GET endpoint. Query params (e.g.
  // ?status=all) are honored — pass them as part of the URL.
  url: string;
  // Whether the tab/section is currently open. When false, the
  // hook performs no fetches and tears down any pending timer.
  enabled: boolean;
  // localStorage key for the interval preference. Use a stable
  // identifier per endpoint (e.g. "area_stats", "categories.list").
  intervalStorageKey: string;
  // Default interval if the admin hasn't chosen one yet.
  defaultInterval: AdminCacheInterval;
  // Optional: bump this number to force a fresh fetch even though
  // the URL hasn't changed (used by tab-open + category-changed
  // events).
  refreshKey?: number;
};

export type UseCachedAdminEndpointResult<T> = {
  data: T | null;
  cacheMeta: CacheStatusBarMetadata | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  interval: AdminCacheInterval;
  setInterval: (next: AdminCacheInterval) => void;
  // Manual refresh — fires ?refresh=1, updates state, never throws.
  refresh: () => void;
};

export function useCachedAdminEndpoint<T>(
  opts: UseCachedAdminEndpointOpts
): UseCachedAdminEndpointResult<T> {
  const { url, enabled, intervalStorageKey, defaultInterval, refreshKey } =
    opts;

  const [data, setData] = useState<T | null>(null);
  const [cacheMeta, setCacheMeta] =
    useState<CacheStatusBarMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalState] = useState<AdminCacheInterval>(
    () => getAdminCacheInterval(intervalStorageKey, defaultInterval)
  );

  // Auto-refresh timer handle. We keep it in a ref (not state) so
  // re-renders don't accidentally cancel the scheduled timer.
  const autoTimerRef = useRef<number | null>(null);
  const cancelAutoTimer = useCallback(() => {
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  // Latest-only: a stale fetch must not overwrite a fresher result.
  // Each fetch captures its own seq; only the most recent is allowed
  // to write into state.
  const fetchSeqRef = useRef(0);

  const doFetch = useCallback(
    async (force: boolean): Promise<void> => {
      const mySeq = ++fetchSeqRef.current;
      const fullUrl = force
        ? url + (url.includes("?") ? "&" : "?") + "refresh=1"
        : url;
      if (force) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await fetch(fullUrl, { cache: "no-store" });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: T;
          cache?: CacheStatusBarMetadata;
          error?: string;
        };
        if (mySeq !== fetchSeqRef.current) return;
        if (!res.ok || !json?.ok) {
          throw new Error(
            json?.error || `Request failed (HTTP ${res.status})`
          );
        }
        // data may legitimately be undefined for endpoints that
        // return only metadata — preserve whatever the route ships.
        setData((json.data ?? null) as T | null);
        setCacheMeta(json.cache ?? null);
      } catch (err: unknown) {
        if (mySeq !== fetchSeqRef.current) return;
        setError(err instanceof Error ? err.message : "Network error");
        // Don't blank cacheMeta on a manual refresh failure — the
        // user might still want to see the previously cached time.
        if (!force) setCacheMeta(null);
      } finally {
        if (mySeq !== fetchSeqRef.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [url]
  );

  // Initial fetch on enable / URL change / explicit refreshKey bump.
  // Stale-fetch guard above means a rapid enable→disable→enable
  // toggle never produces a torn update.
  useEffect(() => {
    if (!enabled) return;
    void doFetch(false);
    // doFetch is captured fresh per render and is stable across
    // identical url/enabled — adding it to deps would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, url, refreshKey]);

  // Schedule a single auto-refresh timer whenever:
  //   • the tab is enabled (open),
  //   • we have a cache.last_updated_at,
  //   • the interval is not "manual".
  // Re-arms on every cacheMeta update so a refresh push the next
  // alarm forward. Cleared on unmount / tab close / interval change.
  useEffect(() => {
    cancelAutoTimer();
    if (!enabled) return;
    if (interval === "manual") return;
    const remaining = msUntilNextAutoRefresh(cacheMeta, interval, Date.now());
    if (remaining === null) return;
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = null;
      void doFetch(true);
    }, remaining);
    return () => {
      cancelAutoTimer();
    };
  }, [enabled, interval, cacheMeta, cancelAutoTimer, doFetch]);

  const setInterval = useCallback(
    (next: AdminCacheInterval) => {
      setIntervalState(next);
      setAdminCacheInterval(intervalStorageKey, next);
    },
    [intervalStorageKey]
  );

  const refresh = useCallback(() => {
    if (refreshing) return;
    void doFetch(true);
  }, [doFetch, refreshing]);

  return {
    data,
    cacheMeta,
    loading,
    refreshing,
    error,
    interval,
    setInterval,
    refresh,
  };
}
