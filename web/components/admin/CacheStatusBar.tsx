"use client";

import { useEffect, useState } from "react";

import {
  ADMIN_CACHE_INTERVAL_OPTIONS,
  type AdminCacheInterval,
} from "@/lib/admin/adminCachePreferences";

// Shared "Last updated • Auto refresh • Refresh" bar shown above each
// admin tab that reads from a cached snapshot. The first caller was
// ProvidersTab; the same bar is now reused across AreaTab, CategoryTab,
// KaamTab, UsersTab, ReportsTab, PushAnalyticsTab, and SystemHealthTab.
//
// Contract:
//   • Parent owns the cache metadata (passed via `cache`).
//   • Parent owns the refresh action (passed via `onRefresh`).
//   • Parent owns the interval preference (via `interval` + `onIntervalChange`).
//   • Component is presentational — it does no fetching itself.
//
// `cache === null` means "no cache metadata available right now"
// (parent hasn't loaded yet, or the response 500'd). The bar renders
// the Refresh button + interval dropdown without the "Last updated"
// line in that case so the user can still trigger a fetch.
//
// The interval dropdown is hidden when `interval`/`onIntervalChange`
// are not supplied — keeps the bar usable as the simpler "Last
// updated + Refresh" widget too.

export type CacheStatusBarMetadata = {
  cached: boolean;
  last_updated_at: string | null;
  expires_at: string | null;
  ttl_seconds: number | null;
  refresh_available?: boolean;
  computed_by?: string | null;
  computed_duration_ms?: number | null;
};

export type CacheStatusBarProps = {
  cache: CacheStatusBarMetadata | null;
  refreshing: boolean;
  onRefresh: () => void;
  // Optional interval controls. When both are present the dropdown
  // renders inline. When omitted the bar collapses to its original
  // two-element layout (Last updated + Refresh).
  interval?: AdminCacheInterval;
  onIntervalChange?: (next: AdminCacheInterval) => void;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(fromIso: string, now: number): string {
  const ts = Date.parse(fromIso);
  if (Number.isNaN(ts)) return fromIso;
  const delta = now - ts;
  if (delta < 30 * SECOND) return "just now";
  if (delta < MINUTE) return "a few seconds ago";
  if (delta < 2 * MINUTE) return "1 minute ago";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} minutes ago`;
  if (delta < 2 * HOUR) return "1 hour ago";
  if (delta < DAY) return `${Math.floor(delta / HOUR)} hours ago`;
  const days = Math.floor(delta / DAY);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function formatServerTtl(ttlSeconds: number): string {
  if (ttlSeconds <= 0) return "live";
  if (ttlSeconds < MINUTE / SECOND) return `${ttlSeconds}s`;
  if (ttlSeconds < HOUR / SECOND) {
    const m = Math.round(ttlSeconds / 60);
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  const h = Math.round(ttlSeconds / 3600);
  return h === 1 ? "1 hour" : `${h} hours`;
}

export default function CacheStatusBar({
  cache,
  refreshing,
  onRefresh,
  interval,
  onIntervalChange,
}: CacheStatusBarProps) {
  // Re-render every 30 s so "5 minutes ago" advances to "6 minutes
  // ago" without forcing the parent to bump state. The lazy
  // initializer for `now` runs once at mount (not on every render),
  // which satisfies React 19's purity rule — the render body itself
  // never calls Date.now(). Interval updates the value in place.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30 * SECOND);
    return () => window.clearInterval(id);
  }, []);

  const hasMeta = cache !== null && cache.last_updated_at;
  const updatedRelative =
    hasMeta && cache?.last_updated_at
      ? formatRelative(cache.last_updated_at, now)
      : null;
  const serverTtlLabel =
    cache?.ttl_seconds != null && cache.ttl_seconds > 0
      ? formatServerTtl(cache.ttl_seconds)
      : null;
  const refreshDisabled = refreshing || cache?.refresh_available === false;
  const showIntervalSelect =
    typeof interval === "string" && typeof onIntervalChange === "function";

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {updatedRelative ? (
          <span>
            Last updated{" "}
            <span className="font-medium text-slate-800">
              {updatedRelative}
            </span>
            {cache?.cached === false ? (
              <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                fresh
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-slate-500">Not loaded yet</span>
        )}
        {serverTtlLabel ? (
          <span className="text-slate-500" title="Server-side cache TTL">
            Server cache: {serverTtlLabel}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showIntervalSelect ? (
          <label className="flex items-center gap-1 text-[11px] text-slate-600">
            <span>Auto refresh:</span>
            <select
              value={interval}
              onChange={(e) =>
                onIntervalChange?.(e.target.value as AdminCacheInterval)
              }
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              aria-label="Auto-refresh interval"
            >
              {ADMIN_CACHE_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            refreshDisabled
              ? "Refresh in progress…"
              : "Recompute now (bypasses cache)"
          }
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
