"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

type ProviderStats = {
  total: number;
  verified: number;
};

type CategoryRow = {
  category: string;
  count: number;
};

type SortMode = "countDesc" | "countAsc" | "nameAsc" | "nameDesc";
type ActiveBreakdown = "total" | "verified" | null;

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "countDesc", label: "Providers (high to low)" },
  { value: "countAsc", label: "Providers (low to high)" },
  { value: "nameAsc", label: "Category (A–Z)" },
  { value: "nameDesc", label: "Category (Z–A)" },
];

export default function ProvidersTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Two cached datasets — one per breakdown mode. Lazy-loaded on first
  // click of the corresponding tile.
  const [activeBreakdown, setActiveBreakdown] = useState<ActiveBreakdown>(null);
  const [totalRows, setTotalRows] = useState<CategoryRow[] | null>(null);
  const [totalLoading, setTotalLoading] = useState(false);
  const [totalError, setTotalError] = useState<string | null>(null);
  const [verifiedRows, setVerifiedRows] = useState<CategoryRow[] | null>(null);
  const [verifiedLoading, setVerifiedLoading] = useState(false);
  const [verifiedError, setVerifiedError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("countDesc");

  // Top-level provider stats. Deps intentionally only [isOpen] — including
  // `loading` here would re-run the cleanup on the in-flight fetch and the
  // card would stay stuck on "Loading…" forever.
  useEffect(() => {
    if (!isOpen) return;
    if (data) return;
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
  }, [isOpen]);

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
          data?: { byCategory: CategoryRow[] };
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && res.data) setTotalRows(res.data.byCategory);
          else setTotalError(res?.error || "Failed to load category breakdown");
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
          data?: { byCategory: CategoryRow[] };
          error?: string;
        }) => {
          if (cancelled) return;
          if (res?.ok && res.data) setVerifiedRows(res.data.byCategory);
          else
            setVerifiedError(
              res?.error || "Failed to load verified category breakdown"
            );
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
                                {filteredSortedRows.map((row) => (
                                  <tr
                                    key={row.category}
                                    className="border-b border-slate-100 last:border-b-0"
                                  >
                                    <td className="px-3 py-2 font-medium text-slate-800">
                                      {row.category}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                      {row.count.toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
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
