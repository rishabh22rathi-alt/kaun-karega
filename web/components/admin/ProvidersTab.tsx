"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

type ProviderStats = {
  total: number;
  verified: number;
};

type CategoryRow = {
  category: string;
  count: number;
};

type UnmappedCategoryRow = CategoryRow & {
  suggestedCategory?: string;
};

type CategoryBreakdownResponse = {
  byCategory: CategoryRow[];
  unmappedCategories?: UnmappedCategoryRow[];
};

type CategoryProviderRow = {
  providerId: string;
  name: string;
  phone: string;
  verified: string;
  status: string;
  // `regions` is the primary display; `areas` is the legacy raw list and
  // only surfaces (muted) when no region could be resolved.
  regions?: string[];
  areas: string[];
};

type CategoryProvidersResponse = {
  category: string;
  providers: CategoryProviderRow[];
};

type SortMode = "countDesc" | "countAsc" | "nameAsc" | "nameDesc";
type ActiveBreakdown = "total" | "verified" | null;

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "countDesc", label: "Providers (high to low)" },
  { value: "countAsc", label: "Providers (low to high)" },
  { value: "nameAsc", label: "Category (A–Z)" },
  { value: "nameDesc", label: "Category (Z–A)" },
];

// Custom DOM event used to bridge the Providers tab drilldown into the
// Category tab's management surface. CategoryTab listens on `window` and
// reacts by opening, switching to "Approved Categories", and scrolling +
// highlighting the matching row (or surfacing a "not found" banner).
// Window-scoped event chosen over context/store to keep both tabs as
// independent siblings on /admin/dashboard.
export const MANAGE_CATEGORY_EVENT = "kk-admin-manage-category";

// Fired by CategoryTab after archive/restore mutates the active category
// set. ProvidersTab listens so the green Verified tile (which is gated
// on "at least one active approved category") refreshes without the
// admin having to close + reopen the section.
export const CATEGORY_CHANGED_EVENT = "kk-admin-category-changed";

function dispatchManageCategory(category: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MANAGE_CATEGORY_EVENT, {
      detail: { category },
    })
  );
}

// Cache key for drilldown results — combines breakdown mode, raw vs.
// approved category, and the normalized category name so a stale entry
// from a different mode can't bleed through.
function drilldownKey(
  mode: Exclude<ActiveBreakdown, null>,
  category: string,
  unmapped: boolean
): string {
  return `${mode}::${unmapped ? "u" : "m"}::${category.trim().toLowerCase()}`;
}

export default function ProvidersTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each tab open + on every CATEGORY_CHANGED_EVENT so the
  // top-level stats useEffect re-runs and refetches /api/admin/provider-stats.
  // Without this, the previous "if (data) return" guard pinned the
  // verified tile to its initial value forever.
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);

  // Two cached datasets — one per breakdown mode. Lazy-loaded on first
  // click of the corresponding tile.
  const [activeBreakdown, setActiveBreakdown] = useState<ActiveBreakdown>(null);
  const [totalRows, setTotalRows] = useState<CategoryRow[] | null>(null);
  const [totalUnmappedRows, setTotalUnmappedRows] = useState<
    UnmappedCategoryRow[] | null
  >(null);
  const [totalLoading, setTotalLoading] = useState(false);
  const [totalError, setTotalError] = useState<string | null>(null);
  const [verifiedRows, setVerifiedRows] = useState<CategoryRow[] | null>(null);
  const [verifiedUnmappedRows, setVerifiedUnmappedRows] = useState<
    UnmappedCategoryRow[] | null
  >(null);
  const [verifiedLoading, setVerifiedLoading] = useState(false);
  const [verifiedError, setVerifiedError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("countDesc");

  // Drilldown state — one expanded row at a time per active mode, but
  // results cache is keyed across modes so toggling Total↔Verified
  // preserves previously fetched data.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [providersByKey, setProvidersByKey] = useState<
    Record<string, CategoryProviderRow[]>
  >({});
  const [drilldownLoading, setDrilldownLoading] = useState<Record<string, true>>(
    {}
  );
  const [drilldownErrors, setDrilldownErrors] = useState<
    Record<string, string>
  >({});
  // Per-(provider, category) flag while a remove-from-category POST is
  // in flight. Disables the row's Remove button so a double-click can't
  // fire two deletes back-to-back.
  const [removalsInProgress, setRemovalsInProgress] = useState<
    Record<string, true>
  >({});
  // Notices surfaced after a removal stripped the provider's last
  // category. Keyed by drilldown key so the message lives next to the
  // panel the admin just acted on.
  const [reregistrationNotices, setReregistrationNotices] = useState<
    Record<string, Array<{ providerId: string; name: string }>>
  >({});

  // Top-level provider stats. Re-runs every time the tab opens or a
  // category mutation fires CATEGORY_CHANGED_EVENT. Including `loading`
  // in the deps array would cancel the in-flight fetch on its own state
  // change and leave the card on "Loading…" — keep this list explicit.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/admin/provider-stats")
      .then((r) => r.json())
      .then((res: { ok?: boolean; data?: ProviderStats; error?: string }) => {
        if (cancelled) return;
        if (res?.ok && res.data) setData(res.data);
        else setError(res?.error || "Failed to load provider stats");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, statsRefreshKey]);

  // Bump statsRefreshKey when the tab transitions to open and on each
  // CATEGORY_CHANGED_EVENT. Together with the effect above this gives
  // "always fresh on tab open" + "fresh after archive/restore".
  useEffect(() => {
    if (!isOpen) return;
    setStatsRefreshKey((prev) => prev + 1);
  }, [isOpen]);

  useEffect(() => {
    function bump() {
      setStatsRefreshKey((prev) => prev + 1);
      // Also drop the breakdown caches so the inline tables re-fetch
      // on next tile open. Both keep the verified card and the
      // verified breakdown reading from the same backend snapshot.
      setTotalRows(null);
      setTotalUnmappedRows(null);
      setVerifiedRows(null);
      setVerifiedUnmappedRows(null);
      setProvidersByKey({});
    }
    window.addEventListener(CATEGORY_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CATEGORY_CHANGED_EVENT, bump);
  }, []);

  // Total breakdown — fetched the first time the user activates the Total tile.
  useEffect(() => {
    if (activeBreakdown !== "total") return;
    if (totalRows) return;
    let cancelled = false;
    setTotalLoading(true);
    setTotalError(null);
    fetch("/api/admin/provider-stats/by-category")
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          data?: CategoryBreakdownResponse;
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && res.data) {
            setTotalRows(res.data.byCategory);
            setTotalUnmappedRows(res.data.unmappedCategories ?? []);
          } else {
            setTotalError(res?.error || "Failed to load category breakdown");
          }
        }
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setTotalError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setTotalLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBreakdown]);

  // Verified breakdown — fetched the first time the user activates the
  // Verified tile. Hits the same route with ?verified=1.
  useEffect(() => {
    if (activeBreakdown !== "verified") return;
    if (verifiedRows) return;
    let cancelled = false;
    setVerifiedLoading(true);
    setVerifiedError(null);
    fetch("/api/admin/provider-stats/by-category?verified=1")
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          data?: CategoryBreakdownResponse;
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && res.data) {
            setVerifiedRows(res.data.byCategory);
            setVerifiedUnmappedRows(res.data.unmappedCategories ?? []);
          } else {
            setVerifiedError(
              res?.error || "Failed to load verified category breakdown"
            );
          }
        }
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setVerifiedError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setVerifiedLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBreakdown]);

  const summary = data
    ? `${data.total.toLocaleString()} total · ${data.verified.toLocaleString()} verified`
    : "Provider import and verification overview";

  const activeRows =
    activeBreakdown === "total"
      ? totalRows
      : activeBreakdown === "verified"
        ? verifiedRows
        : null;
  const activeUnmappedRows =
    activeBreakdown === "total"
      ? totalUnmappedRows
      : activeBreakdown === "verified"
        ? verifiedUnmappedRows
        : null;
  const activeLoading =
    activeBreakdown === "total"
      ? totalLoading
      : activeBreakdown === "verified"
        ? verifiedLoading
        : false;
  const activeError =
    activeBreakdown === "total"
      ? totalError
      : activeBreakdown === "verified"
        ? verifiedError
        : null;
  const activeTitle =
    activeBreakdown === "total"
      ? "Total Providers by Category"
      : "Verified Providers by Category";

  const filteredSortedRows = useMemo(() => {
    if (!activeRows) return [];
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? activeRows.filter((row) =>
          row.category.toLowerCase().includes(query)
        )
      : activeRows;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortMode) {
        case "countAsc":
          return a.count - b.count || a.category.localeCompare(b.category);
        case "nameAsc":
          return a.category.localeCompare(b.category);
        case "nameDesc":
          return b.category.localeCompare(a.category);
        case "countDesc":
        default:
          return b.count - a.count || a.category.localeCompare(b.category);
      }
    });
    return sorted;
  }, [activeRows, searchQuery, sortMode]);

  const toggleTile = (mode: "total" | "verified") => {
    setActiveBreakdown((prev) => (prev === mode ? null : mode));
    // Collapse any open drilldown when the breakdown mode changes — the
    // cache survives but the user starts fresh visually.
    setExpandedKey(null);
  };

  // Remove a wrongly-mapped provider from a category. Optimistically
  // prunes the local cache for the active drilldown, decrements the
  // matching breakdown count, and bumps the stats refresh key so the
  // top tile reflects the changed verified set. The provider row
  // itself is intentionally untouched in the DB (account stays
  // active) — see /api/admin/providers/remove-category.
  const handleRemoveFromCategory = async (
    providerId: string,
    providerName: string,
    category: string,
    mode: Exclude<ActiveBreakdown, null>,
    unmapped: boolean
  ): Promise<void> => {
    const confirmMessage = `Remove this provider from category '${category}'? The provider account will remain active but will no longer appear under this service category.`;
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }
    const key = drilldownKey(mode, category, unmapped);
    const inFlightKey = `${providerId}::${key}`;
    if (removalsInProgress[inFlightKey]) return;
    setRemovalsInProgress((prev) => ({ ...prev, [inFlightKey]: true }));

    try {
      const res = await fetch("/api/admin/providers/remove-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, category }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        removed?: {
          providerStatusUpdated?: boolean;
        };
      };
      if (!res.ok || !json?.ok) {
        setDrilldownErrors((prev) => ({
          ...prev,
          [key]: json?.error || `Remove failed (${res.status})`,
        }));
        return;
      }

      // Optimistic prune of the drilldown cache for this key.
      setProvidersByKey((prev) => {
        const list = prev[key] ?? [];
        return {
          ...prev,
          [key]: list.filter((p) => p.providerId !== providerId),
        };
      });

      // Optimistic decrement of the matching breakdown count.
      const decrementRow = (
        rows: CategoryRow[] | null
      ): CategoryRow[] | null => {
        if (!rows) return rows;
        const targetKey = category.trim().toLowerCase();
        return rows
          .map((row) =>
            row.category.trim().toLowerCase() === targetKey
              ? { ...row, count: Math.max(0, row.count - 1) }
              : row
          )
          .filter((row) => row.count > 0 || !unmapped);
      };
      if (mode === "total") {
        if (unmapped) {
          setTotalUnmappedRows((prev) =>
            decrementRow(prev) as UnmappedCategoryRow[] | null
          );
        } else {
          setTotalRows((prev) => decrementRow(prev));
        }
      } else {
        if (unmapped) {
          setVerifiedUnmappedRows((prev) =>
            decrementRow(prev) as UnmappedCategoryRow[] | null
          );
        } else {
          setVerifiedRows((prev) => decrementRow(prev));
        }
      }

      // Bump stats so the green Verified tile and the grey Total tile
      // re-fetch — removing a provider from their last active category
      // shrinks the verified-with-active-category set.
      setStatsRefreshKey((prev) => prev + 1);

      if (json.removed?.providerStatusUpdated) {
        setReregistrationNotices((prev) => {
          const existing = prev[key] ?? [];
          if (existing.some((p) => p.providerId === providerId)) return prev;
          return {
            ...prev,
            [key]: [...existing, { providerId, name: providerName }],
          };
        });
      }
    } catch (err: unknown) {
      setDrilldownErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Network error",
      }));
    } finally {
      setRemovalsInProgress((prev) => {
        if (!(inFlightKey in prev)) return prev;
        const next = { ...prev };
        delete next[inFlightKey];
        return next;
      });
    }
  };

  const requestDrilldown = (
    mode: Exclude<ActiveBreakdown, null>,
    category: string,
    unmapped: boolean
  ): void => {
    const key = drilldownKey(mode, category, unmapped);
    // Toggle off if already expanded.
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    // Cache hit — nothing more to do.
    if (providersByKey[key]) return;
    if (drilldownLoading[key]) return;

    setDrilldownLoading((prev) => ({ ...prev, [key]: true }));
    setDrilldownErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    const params = new URLSearchParams();
    params.set("category", category);
    if (mode === "verified") params.set("verified", "1");
    if (unmapped) params.set("unmapped", "1");

    fetch(`/api/admin/provider-stats/category-providers?${params.toString()}`)
      .then((r) => r.json())
      .then(
        (res: {
          ok?: boolean;
          data?: CategoryProvidersResponse;
          error?: string;
        }) => {
          if (res?.ok && res.data) {
            setProvidersByKey((prev) => ({
              ...prev,
              [key]: res.data!.providers,
            }));
          } else {
            setDrilldownErrors((prev) => ({
              ...prev,
              [key]: res?.error || "Failed to load providers",
            }));
          }
        }
      )
      .catch((err: unknown) => {
        setDrilldownErrors((prev) => ({
          ...prev,
          [key]: err instanceof Error ? err.message : "Network error",
        }));
      })
      .finally(() => {
        setDrilldownLoading((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      });
  };

  const renderDrilldownPanel = (
    key: string,
    category: string,
    mode: Exclude<ActiveBreakdown, null>,
    unmapped: boolean
  ) => {
    const isLoading = Boolean(drilldownLoading[key]);
    const errorMsg = drilldownErrors[key];
    const providers = providersByKey[key];
    const notices = reregistrationNotices[key] ?? [];
    if (isLoading) {
      return (
        <p className="px-3 py-3 text-xs text-slate-500">Loading providers…</p>
      );
    }
    if (errorMsg) {
      return (
        <p className="px-3 py-3 text-xs text-red-600">Error: {errorMsg}</p>
      );
    }
    if (!providers) {
      return null;
    }
    return (
      <div className="overflow-x-auto bg-slate-50">
        {notices.length > 0 && (
          <div
            data-testid={`reregistration-notice-${category}`}
            className="border-b border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-700"
          >
            {notices.map((n) => (
              <div key={n.providerId}>
                <span className="font-semibold">{n.name || n.providerId}</span>
                <span className="ml-2 inline-block rounded-full bg-orange-100 px-2 py-0.5 font-semibold uppercase tracking-wide">
                  Needs category re-registration
                </span>
              </div>
            ))}
          </div>
        )}
        {providers.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-500">
            No providers in this category.
          </p>
        ) : (
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left font-bold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Verified</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Regions</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => {
                const regions = provider.regions ?? [];
                const removeKey = `${provider.providerId}::${key}`;
                const removing = Boolean(removalsInProgress[removeKey]);
                return (
                  <tr
                    key={provider.providerId}
                    data-testid={`provider-row-${provider.providerId}`}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {provider.name || (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {provider.phone || (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {provider.verified || (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {provider.status || (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {regions.length > 0 ? (
                        // Compact region labels only. Tooltip carries the
                        // raw area list so the underlying data is still
                        // one hover away without cluttering the cell.
                        <span
                          className="font-medium text-slate-800"
                          title={
                            provider.areas.length > 0
                              ? `Areas: ${provider.areas.join(", ")}`
                              : undefined
                          }
                        >
                          {regions.join(", ")}
                        </span>
                      ) : (
                        <span
                          className="italic text-slate-400"
                          title={
                            provider.areas.length > 0
                              ? `Areas: ${provider.areas.join(", ")}`
                              : undefined
                          }
                        >
                          Unmapped Region
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          void handleRemoveFromCategory(
                            provider.providerId,
                            provider.name,
                            category,
                            mode,
                            unmapped
                          )
                        }
                        disabled={removing}
                        data-testid={`remove-provider-category-${provider.providerId}`}
                        title="Remove this provider from the category; the account stays active."
                        className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {removing ? "…" : "Remove from category"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="providers-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">Providers</p>
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
        <div id="providers-tab-body" className="border-t border-slate-200 px-5 py-5">
          {loading && (
            <p className="text-sm text-slate-500">Loading provider data…</p>
          )}
          {error && !loading && (
            <p className="text-sm text-red-600">Error: {error}</p>
          )}
          {data && !loading && !error && data.total === 0 && (
            <p className="text-sm text-slate-500">
              No providers in the system yet.
            </p>
          )}
          {data && !loading && !error && data.total > 0 && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => toggleTile("total")}
                  aria-expanded={activeBreakdown === "total"}
                  aria-controls="providers-breakdown"
                  className={`rounded-xl border px-4 py-3 text-left shadow-sm transition focus:outline-none focus:ring-2 ${
                    activeBreakdown === "total"
                      ? "border-slate-500 bg-slate-100 ring-2 ring-slate-400"
                      : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100 hover:shadow focus:ring-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      Total Providers
                    </p>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                        activeBreakdown === "total" ? "rotate-180" : "rotate-0"
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {data.total.toLocaleString()}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Tap to view breakdown by category
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleTile("verified")}
                  aria-expanded={activeBreakdown === "verified"}
                  aria-controls="providers-breakdown"
                  className={`rounded-xl border px-4 py-3 text-left shadow-sm transition focus:outline-none focus:ring-2 ${
                    activeBreakdown === "verified"
                      ? "border-[#003d20]/60 bg-green-200/70 ring-2 ring-[#003d20]/40"
                      : "border-[#003d20]/30 bg-green-100/70 hover:border-[#003d20]/45 hover:bg-green-100 hover:shadow focus:ring-[#003d20]/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#003d20]">
                      Verified Providers
                    </p>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 text-[#003d20] transition-transform ${
                        activeBreakdown === "verified" ? "rotate-180" : "rotate-0"
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-2xl font-bold text-[#003d20]">
                    {data.verified.toLocaleString()}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Registered + login last 30 days
                  </p>
                </button>
              </div>

              {activeBreakdown && (
                <div id="providers-breakdown" className="mt-5">
                  <p className="text-sm font-semibold text-slate-900">
                    {activeTitle}
                  </p>

                  {activeLoading && (
                    <p className="mt-2 text-sm text-slate-500">
                      Loading categories…
                    </p>
                  )}
                  {activeError && !activeLoading && (
                    <p className="mt-2 text-sm text-red-600">
                      Error: {activeError}
                    </p>
                  )}
                  {activeRows &&
                    !activeLoading &&
                    !activeError &&
                    activeRows.length === 0 && (
                      <p className="mt-2 text-sm text-slate-500">
                        No category mappings found.
                      </p>
                    )}
                  {activeRows &&
                    !activeLoading &&
                    !activeError &&
                    activeRows.length > 0 && (
                      <>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            type="search"
                            value={searchQuery}
                            onChange={(event) =>
                              setSearchQuery(event.target.value)
                            }
                            placeholder="Search categories…"
                            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                          />
                          <select
                            value={sortMode}
                            onChange={(event) =>
                              setSortMode(event.target.value as SortMode)
                            }
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20 sm:w-56"
                          >
                            {SORT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {filteredSortedRows.length === 0 ? (
                          <p className="mt-3 text-sm text-slate-500">
                            No categories match your search.
                          </p>
                        ) : (
                          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                  <th className="px-3 py-2">Category</th>
                                  <th className="px-3 py-2 text-right">
                                    Providers
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredSortedRows.map((row) => {
                                  const key = drilldownKey(
                                    activeBreakdown,
                                    row.category,
                                    false
                                  );
                                  const expanded = expandedKey === key;
                                  return (
                                    <Fragment key={row.category}>
                                      <tr
                                        className={`border-b border-slate-100 last:border-b-0 ${
                                          expanded ? "bg-slate-50" : ""
                                        }`}
                                      >
                                        <td className="px-3 py-2 font-medium text-slate-800">
                                          <div className="flex items-center justify-between gap-3">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                requestDrilldown(
                                                  activeBreakdown,
                                                  row.category,
                                                  false
                                                )
                                              }
                                              aria-expanded={expanded}
                                              aria-controls={`provider-drilldown-${key}`}
                                              className="flex flex-1 min-w-0 items-center gap-2 text-left text-slate-800 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#003d20]/40 rounded"
                                            >
                                              <ChevronDown
                                                aria-hidden="true"
                                                className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                                                  expanded ? "rotate-180" : "rotate-0"
                                                }`}
                                              />
                                              <span className="truncate">{row.category}</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                dispatchManageCategory(row.category)
                                              }
                                              data-testid={`manage-category-${row.category}`}
                                              className="shrink-0 rounded border border-[#003d20]/40 px-2 py-0.5 text-[11px] font-semibold text-[#003d20] hover:bg-[#003d20]/5 focus:outline-none focus:ring-2 focus:ring-[#003d20]/40"
                                            >
                                              Manage category
                                            </button>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                          {row.count.toLocaleString()}
                                        </td>
                                      </tr>
                                      {expanded && (
                                        <tr
                                          data-testid={`provider-drilldown-${row.category}`}
                                          id={`provider-drilldown-${key}`}
                                          className="border-b border-slate-100 last:border-b-0"
                                        >
                                          <td
                                            colSpan={2}
                                            className="bg-slate-50 p-0"
                                          >
                                            {renderDrilldownPanel(
                                              key,
                                              row.category,
                                              activeBreakdown,
                                              false
                                            )}
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  {activeUnmappedRows &&
                    !activeLoading &&
                    !activeError &&
                    activeUnmappedRows.length > 0 && (
                      <div className="mt-5">
                        <p className="text-sm font-semibold text-slate-900">
                          Unmapped Provider Categories
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Raw provider service categories that do not match an active approved category.
                        </p>
                        <div className="mt-3 overflow-x-auto rounded-xl border border-orange-200">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="border-b border-orange-100 bg-orange-50 text-left text-[11px] font-bold uppercase tracking-wider text-orange-700">
                                <th className="px-3 py-2">Raw Category</th>
                                <th className="px-3 py-2 text-right">
                                  Providers
                                </th>
                                <th className="px-3 py-2">
                                  Suggested Match
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeUnmappedRows.map((row) => {
                                const key = drilldownKey(
                                  activeBreakdown,
                                  row.category,
                                  true
                                );
                                const expanded = expandedKey === key;
                                return (
                                  <Fragment key={row.category}>
                                    <tr
                                      className={`border-b border-orange-100 last:border-b-0 ${
                                        expanded ? "bg-orange-50/60" : ""
                                      }`}
                                    >
                                      <td className="px-3 py-2 font-medium text-slate-800">
                                        <div className="flex items-center justify-between gap-3">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              requestDrilldown(
                                                activeBreakdown,
                                                row.category,
                                                true
                                              )
                                            }
                                            aria-expanded={expanded}
                                            aria-controls={`provider-drilldown-${key}`}
                                            className="flex flex-1 min-w-0 items-center gap-2 text-left text-slate-800 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-300 rounded"
                                          >
                                            <ChevronDown
                                              aria-hidden="true"
                                              className={`h-4 w-4 shrink-0 text-orange-500 transition-transform ${
                                                expanded ? "rotate-180" : "rotate-0"
                                              }`}
                                            />
                                            <span className="truncate">{row.category}</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              dispatchManageCategory(row.category)
                                            }
                                            data-testid={`manage-category-${row.category}`}
                                            className="shrink-0 rounded border border-orange-300 px-2 py-0.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-300"
                                          >
                                            Manage category
                                          </button>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                        {row.count.toLocaleString()}
                                      </td>
                                      <td className="px-3 py-2 text-slate-700">
                                        {row.suggestedCategory || (
                                          <span className="text-slate-400">-</span>
                                        )}
                                      </td>
                                    </tr>
                                    {expanded && (
                                      <tr
                                        data-testid={`provider-drilldown-${row.category}`}
                                        id={`provider-drilldown-${key}`}
                                        className="border-b border-orange-100 last:border-b-0"
                                      >
                                        <td
                                          colSpan={3}
                                          className="bg-orange-50/40 p-0"
                                        >
                                          {renderDrilldownPanel(
                                            key,
                                            row.category,
                                            activeBreakdown,
                                            true
                                          )}
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
