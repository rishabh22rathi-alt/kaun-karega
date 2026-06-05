"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import UnreadBadge, { type UnreadIndicator } from "./UnreadBadge";

import CacheStatusBar, {
  type CacheStatusBarMetadata,
} from "@/components/admin/CacheStatusBar";
import {
  type AdminCacheInterval,
  getAdminCacheInterval,
  msUntilNextAutoRefresh,
  setAdminCacheInterval,
} from "@/lib/admin/adminCachePreferences";

type UsersTabProps = {
  unread?: UnreadIndicator | null;
  onMarkRead?: () => void;
};

// Users accordion for /admin/dashboard.
//
// Reads:   GET /api/admin/users
// Mutates: none — admin-only read surface, no mutations.
//
// Mirrors the open/close/loading/error UX of ProvidersTab / CategoryTab /
// AreaTab so the four cards feel like one component family.

type UserRow = {
  phone: string;
  name: string | null;
  created_at: string | null;
  totalRequests: number;
  latestRequestAt: string | null;
};

type LoadResponse = {
  success?: boolean;
  totalUsers?: number;
  users?: UserRow[];
  error?: string;
  cache?: CacheStatusBarMetadata;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export default function UsersTab({
  unread,
  onMarkRead,
}: UsersTabProps = {}) {
  const markReadFiredRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      markReadFiredRef.current = false;
      return;
    }
    if (markReadFiredRef.current) return;
    markReadFiredRef.current = true;
    onMarkRead?.();
  }, [isOpen, onMarkRead]);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  // Snapshot cache state. Manual Refresh sets forceRefreshOnce; the
  // fetch effect appends ?refresh=1 on the next call and resets the
  // flag. Auto-refresh is scheduled via a single setTimeout based on
  // the chosen interval — no polling.
  const [cacheMeta, setCacheMeta] =
    useState<CacheStatusBarMetadata | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [forceRefreshOnce, setForceRefreshOnce] = useState(false);
  const [autoInterval, setAutoIntervalState] = useState<AdminCacheInterval>(
    () => getAdminCacheInterval("users.admin", "manual")
  );
  const setAutoInterval = useCallback((next: AdminCacheInterval) => {
    setAutoIntervalState(next);
    setAdminCacheInterval("users.admin", next);
  }, []);
  const autoTimerRef = useRef<number | null>(null);

  // Normalize search input by stripping non-digits. Matching is then a
  // simple substring check against each user phone's last-10-digit form
  // (the canonical comparison key used by the backend / submit-request).
  const searchDigits = useMemo(
    () => searchInput.replace(/\D/g, "").slice(0, 15),
    [searchInput]
  );

  const filteredUsers = useMemo(() => {
    if (!users) return null;
    if (!searchDigits) return users;
    return users.filter((u) => {
      const phone10 = String(u.phone).replace(/\D/g, "").slice(-10);
      return phone10.includes(searchDigits);
    });
  }, [users, searchDigits]);

  // Recently Registered Users — latest 10 by created_at. Independent of
  // the phone search above. The API now orders the profiles window by
  // created_at DESC, but the payload is re-sorted by activity, so we
  // re-sort here by created_at to get a true registration recency view.
  // Rows with a null created_at sort last.
  const recentUsers = useMemo(() => {
    if (!users) return [];
    return [...users]
      .sort((a, b) => {
        const aCreated = a.created_at ?? "";
        const bCreated = b.created_at ?? "";
        if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
        return 0;
      })
      .slice(0, 10);
  }, [users]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const force = forceRefreshOnce;
    // Synchronous setState on mount-of-effect is intentional — same
    // lazy-load pattern other admin tabs use so the loading spinner
    // appears before the fetch starts. React 19 lints this loudly;
    // suppression here mirrors the existing pattern in ProvidersTab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (force) setRefreshing(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    const url = force ? "/api/admin/users?refresh=1" : "/api/admin/users";
    fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as LoadResponse;
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(json?.error || `Failed to load users (${res.status})`);
          setUsers([]);
          setTotalUsers(0);
          if (!force) setCacheMeta(null);
          return;
        }
        setUsers(Array.isArray(json.users) ? json.users : []);
        setTotalUsers(
          typeof json.totalUsers === "number" ? json.totalUsers : 0
        );
        setCacheMeta(json.cache ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setUsers([]);
        setTotalUsers(0);
        if (!force) setCacheMeta(null);
      })
      .finally(() => {
        if (cancelled) return;
        if (force) {
          setRefreshing(false);
          setForceRefreshOnce(false);
        } else {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, forceRefreshOnce]);

  const handleManualRefresh = useCallback(() => {
    if (refreshing) return;
    setForceRefreshOnce(true);
  }, [refreshing]);

  // Auto refresh scheduled by a single setTimeout. Re-armed when the
  // tab opens, the interval changes, or cacheMeta updates. Cleared on
  // close / unmount.
  useEffect(() => {
    const cancelTimer = () => {
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
    cancelTimer();
    if (!isOpen) return;
    if (autoInterval === "manual") return;
    const remaining = msUntilNextAutoRefresh(
      cacheMeta,
      autoInterval,
      Date.now()
    );
    if (remaining === null) return;
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = null;
      setForceRefreshOnce(true);
    }, remaining);
    return cancelTimer;
  }, [isOpen, autoInterval, cacheMeta]);

  const summary =
    totalUsers !== null
      ? `${totalUsers} registered user${totalUsers === 1 ? "" : "s"}`
      : "Registered users and request activity";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="users-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="flex items-center text-base font-semibold text-slate-900">
            Users
            <UnreadBadge unread={unread} testId="users-unread-badge" />
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{summary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div id="users-tab-body" className="border-t border-slate-200 px-5 py-5">
          {/* Snapshot cache status — 6-hour TTL server-side; this bar
              exposes Last updated, interval dropdown (persisted in
              localStorage), and a manual Refresh that bypasses the
              cache via ?refresh=1. */}
          <CacheStatusBar
            cache={cacheMeta}
            refreshing={refreshing || loading}
            onRefresh={handleManualRefresh}
            interval={autoInterval}
            onIntervalChange={setAutoInterval}
          />
          {/* Recently Registered Users — latest 10 by created_at, from
              the same users payload. Sits above the summary + search so
              the freshest signups are the first thing the admin sees. */}
          {recentUsers.length > 0 && (
            <div data-testid="kk-admin-recent-users" className="mb-4">
              <p className="text-sm font-semibold text-slate-900">
                Recently Registered Users
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Latest {recentUsers.length} user
                {recentUsers.length === 1 ? "" : "s"} by registration time.
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Phone</th>
                      <th className="px-4 py-2.5">Registered</th>
                      <th className="px-4 py-2.5 text-right">Requests</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {recentUsers.map((u) => (
                      <tr
                        key={`recent-${u.phone}`}
                        data-testid={`kk-admin-recent-user-${u.phone}`}
                      >
                        <td className="px-4 py-2.5 text-slate-700">
                          {u.name && u.name.trim() ? u.name : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-900">
                          {u.phone}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                          {formatDate(u.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-900">
                          {u.totalRequests}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              Registered Users:{" "}
              <span className="font-bold text-[#003d20]">
                {totalUsers !== null ? totalUsers : "—"}
              </span>
            </p>
            {users && users.length > 0 && searchDigits && filteredUsers && (
              <p className="text-xs text-slate-600">
                Showing {filteredUsers.length} of {users.length} users
              </p>
            )}
          </div>

          <div className="mb-4">
            <div className="relative">
              <input
                type="search"
                inputMode="numeric"
                autoComplete="off"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search phone number..."
                aria-label="Search users by phone number"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#003d20] focus:outline-none focus:ring-1 focus:ring-[#003d20]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Search by full or partial phone number.
            </p>
          </div>

          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading && !users && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              Loading users…
            </p>
          )}

          {!loading && users && users.length === 0 && !error && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              No registered users found yet.
            </p>
          )}

          {users &&
            users.length > 0 &&
            filteredUsers &&
            filteredUsers.length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
                No users found for this phone number.
              </p>
            )}

          {users && users.length > 0 && filteredUsers && filteredUsers.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table
                data-testid="kk-admin-users-table"
                className="min-w-full divide-y divide-slate-200 text-sm"
              >
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Phone
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Requests Generated
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Latest Request
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredUsers.map((u) => (
                    <tr key={u.phone}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-900">
                        {u.phone}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {u.name && u.name.trim() ? u.name : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-900">
                        {u.totalRequests}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                        {formatDate(u.latestRequestAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
