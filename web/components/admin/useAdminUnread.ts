"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Mirror of the server-side type. We keep a private copy here so the
// dashboard doesn't pull a non-"use client" lib file across the
// boundary; the server route stays canonical for the shape.
type UnreadEntry = {
  hasUnread: boolean;
  count: number;
  lastReadAt: string;
};

export type AdminTabKey =
  | "reports"
  | "chats"
  | "kaam"
  | "category"
  | "users";

export type AdminUnreadMap = Partial<Record<AdminTabKey, UnreadEntry>>;

type UnreadSummaryResponse = {
  ok?: boolean;
  unread?: AdminUnreadMap;
  error?: string;
};

const REFRESH_MS = 45_000;

export type AdminUnreadHook = {
  unread: AdminUnreadMap;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (tabKey: AdminTabKey) => Promise<void>;
};

/**
 * Drives the per-tab unread dots on /admin/dashboard.
 *
 *   - Fetches GET /api/admin/unread-summary on mount, then every
 *     ~45s while the dashboard is open (skipped when the document
 *     is hidden — there's no reason to poll while the tab is in the
 *     background).
 *   - Exposes a `markRead(tabKey)` that POSTs /api/admin/mark-tab-read
 *     and clears the dot optimistically so the UI feels instant.
 *   - Refresh failures are swallowed; the prior `unread` state stays
 *     so a transient network blip never falsely-empties the badges.
 *
 * Auth: both endpoints are admin-gated server-side. If the admin
 * session lapses the GET will 401 and we record the error in
 * `error`; the dashboard still renders without badges.
 */
export function useAdminUnread(): AdminUnreadHook {
  const [unread, setUnread] = useState<AdminUnreadMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which tabs the admin has marked read in this browser
  // lifetime, so a refresh whose response is in-flight when the
  // admin opens a tab can't bring the dot back briefly.
  const readKeysRef = useRef<Set<AdminTabKey>>(new Set());

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/unread-summary", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res
        .json()
        .catch(() => ({}))) as UnreadSummaryResponse;
      if (!res.ok || !json?.ok || !json?.unread) {
        setError(json?.error || `Failed to load (${res.status})`);
        return;
      }
      const remote = json.unread;
      // Apply readKeysRef: if the admin marked a tab read locally
      // since the request started, force that tab to hasUnread:false
      // and count:0 regardless of what the server returned.
      const merged: AdminUnreadMap = { ...remote };
      for (const key of readKeysRef.current) {
        const entry = merged[key];
        if (entry) {
          merged[key] = {
            ...entry,
            hasUnread: false,
            count: 0,
          };
        }
      }
      setUnread(merged);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(
    async (tabKey: AdminTabKey) => {
      // Optimistic local clear so the dot vanishes without waiting
      // for the round-trip. The readKeys set is consulted by the
      // refresh merger above to avoid an in-flight response
      // re-introducing the dot.
      readKeysRef.current.add(tabKey);
      setUnread((prev) => {
        const existing = prev[tabKey];
        if (!existing) return prev;
        return {
          ...prev,
          [tabKey]: { ...existing, hasUnread: false, count: 0 },
        };
      });
      try {
        await fetch("/api/admin/mark-tab-read", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabKey }),
          cache: "no-store",
        });
        // Don't surface failures here — the optimistic clear stays
        // in place. The next successful refresh will rebuild from
        // the server-side last_read_at (which the upsert just bumped
        // when the table exists).
      } catch {
        // swallow
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    void refresh();
    const interval = setInterval(() => {
      if (cancelled) return;
      void refresh();
    }, REFRESH_MS);
    // Re-poll the moment the tab returns to the foreground so an
    // admin who switched away to do something else sees fresh
    // badges immediately instead of waiting up to 45s.
    const visibilityHandler = () => {
      if (typeof document === "undefined") return;
      if (!document.hidden && !cancelled) void refresh();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", visibilityHandler);
    }
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
    };
  }, [refresh]);

  return { unread, loading, error, refresh, markRead };
}
