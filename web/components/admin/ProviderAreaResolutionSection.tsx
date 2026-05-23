"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";

// Admin Provider Area Resolution Center — UI section.
//
// Reads /api/admin/provider-regions/unresolved which classifies every
// provider_areas row (city='JOD', region_code IS NULL) into one of:
//
//   • autoResolvable — resolver returns resolved=true. Admin can click
//     "Allocate" per row OR "Allocate all auto-resolved" to bulk
//     populate region_code without any catalog change.
//
//   • needsReview — resolver returns unresolved OR ambiguous. Admin
//     must Map-as-alias / Create-canonical / Ignore.
//
// Resolved + bulk allocation calls /api/admin/provider-regions/resolve-area
// (action: "allocate") and /api/admin/provider-regions/allocate?dryRun=false
// respectively. Per-row review calls /api/admin/provider-regions/resolve-area
// with action alias|canonical|ignore. After any successful response, the
// row is removed locally and the parent AreaTab is refreshed via the
// onResolved prop.

type RegionLite = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
};

type AreaLite = {
  canonical_area: string;
  region_code: string;
  active: boolean;
};

type AutoResolvableRow = {
  area: string;
  normalized_key: string;
  count: number;
  region_code: string;
  canonical_area: string;
  match_type: "canonical" | "alias";
  sample_provider_ids: string[];
};

type NeedsReviewRow = {
  area: string;
  normalized_key: string;
  count: number;
  reason: "unresolved" | "ambiguous";
  sample_provider_ids: string[];
};

type Summary = {
  totalNullRows: number;
  autoResolvableRows: number;
  reviewNeededRows: number;
  ambiguousRows: number;
  ignoredRows: number;
  distinctAutoResolvableAreas: number;
  distinctNeedsReviewAreas: number;
};

type RowStatus = {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
};

type Props = {
  regions: RegionLite[];
  areas: AreaLite[];
  onResolved?: () => void;
};

type FetchResponse = {
  ok?: boolean;
  autoResolvable?: AutoResolvableRow[];
  needsReview?: NeedsReviewRow[];
  summary?: Summary;
  error?: string;
  detail?: string;
};

type ResolveResponse = {
  ok?: boolean;
  action?: "alias" | "canonical" | "ignore" | "allocate";
  alias_code?: string | null;
  area_code?: string;
  canonical_area?: string;
  region_code?: string;
  match_type?: "canonical" | "alias";
  updatedRows?: number;
  queueResolved?: number;
  matchedRawAreas?: number;
  error?: string;
  detail?: string;
};

type BulkAllocateResponse = {
  ok?: boolean;
  updatedRows?: number;
  resolvedRows?: number;
  unresolvedRows?: number;
  ambiguousRows?: number;
  alreadyAllocatedRows?: number;
  regions?: Array<{
    region_code: string;
    resolvedRows: number;
    distinctProviders: number;
  }>;
  error?: string;
  detail?: string;
};

export default function ProviderAreaResolutionSection({
  regions,
  areas,
  onResolved,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [autoResolvable, setAutoResolvable] = useState<
    AutoResolvableRow[] | null
  >(null);
  const [needsReview, setNeedsReview] = useState<NeedsReviewRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Sub-section expand toggles. Default: expand auto if it has items,
  // always expand review (its absence is also informative).
  const [autoExpanded, setAutoExpanded] = useState(true);
  const [reviewExpanded, setReviewExpanded] = useState(true);

  const [bulkStatus, setBulkStatus] = useState<RowStatus>({ state: "idle" });

  // Per-row state — keyed by normalized_key (server returns one row per
  // distinct key in each bucket).
  const [statusByKey, setStatusByKey] = useState<Record<string, RowStatus>>({});
  const [regionByKey, setRegionByKey] = useState<Record<string, string>>({});
  const [canonicalByKey, setCanonicalByKey] = useState<Record<string, string>>(
    {}
  );

  const activeRegions = useMemo(
    () =>
      regions
        .filter((r) => r.active !== false)
        .map((r) => ({
          region_code: r.region_code,
          region_name: r.region_name ?? "",
        }))
        .sort((a, b) => a.region_code.localeCompare(b.region_code)),
    [regions]
  );

  const canonicalsByRegion = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of areas) {
      if (a.active === false) continue;
      if (!a.canonical_area || !a.region_code) continue;
      const list = map.get(a.region_code) ?? [];
      if (!list.includes(a.canonical_area)) list.push(a.canonical_area);
      map.set(a.region_code, list);
    }
    for (const list of map.values()) {
      list.sort((x, y) => x.localeCompare(y));
    }
    return map;
  }, [areas]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/provider-regions/unresolved", {
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json()) as FetchResponse;
      if (!res.ok || !json?.ok) {
        const message =
          json?.detail || json?.error || `Load failed (HTTP ${res.status})`;
        setLoadError(message);
        return;
      }
      setAutoResolvable(
        Array.isArray(json.autoResolvable) ? json.autoResolvable : []
      );
      setNeedsReview(Array.isArray(json.needsReview) ? json.needsReview : []);
      setSummary(json.summary ?? null);
      // Re-derive default sub-section expansion when fresh data lands.
      if (json.summary && json.summary.distinctAutoResolvableAreas === 0) {
        setAutoExpanded(false);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      expanded &&
      autoResolvable === null &&
      needsReview === null &&
      !loading
    ) {
      void loadList();
    }
  }, [expanded, autoResolvable, needsReview, loading, loadList]);

  const setStatus = useCallback((key: string, status: RowStatus) => {
    setStatusByKey((prev) => ({ ...prev, [key]: status }));
  }, []);

  const removeAutoRowLocal = useCallback((key: string) => {
    setAutoResolvable((prev) =>
      prev ? prev.filter((r) => r.normalized_key !== key) : prev
    );
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            distinctAutoResolvableAreas: Math.max(
              0,
              prev.distinctAutoResolvableAreas - 1
            ),
          }
        : prev
    );
  }, []);

  const removeReviewRowLocal = useCallback((key: string) => {
    setNeedsReview((prev) =>
      prev ? prev.filter((r) => r.normalized_key !== key) : prev
    );
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            distinctNeedsReviewAreas: Math.max(
              0,
              prev.distinctNeedsReviewAreas - 1
            ),
          }
        : prev
    );
    setRegionByKey((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCanonicalByKey((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Per-row allocate (auto-resolvable section).
  const submitAllocate = useCallback(
    async (row: AutoResolvableRow): Promise<void> => {
      setStatus(row.normalized_key, { state: "saving" });
      try {
        const res = await fetch("/api/admin/provider-regions/resolve-area", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw_area: row.area, action: "allocate" }),
        });
        const json = (await res.json()) as ResolveResponse;
        if (!res.ok || !json?.ok) {
          setStatus(row.normalized_key, {
            state: "error",
            message:
              json?.detail || json?.error || `Allocate failed (HTTP ${res.status})`,
          });
          return;
        }
        setStatus(row.normalized_key, {
          state: "saved",
          message: `Allocated → ${json.region_code}; ${json.updatedRows ?? 0} provider rows updated`,
        });
        removeAutoRowLocal(row.normalized_key);
        if (onResolved) onResolved();
      } catch (err) {
        setStatus(row.normalized_key, {
          state: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    },
    [setStatus, removeAutoRowLocal, onResolved]
  );

  // Bulk "Allocate all auto-resolved" — reuses the existing allocator
  // commit endpoint. After response, reload the list so both buckets
  // reflect the new state and the summary updates accurately.
  const submitBulkAllocate = useCallback(async (): Promise<void> => {
    setBulkStatus({ state: "saving" });
    try {
      const res = await fetch(
        "/api/admin/provider-regions/allocate?dryRun=false",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: false }),
        }
      );
      const json = (await res.json()) as BulkAllocateResponse;
      if (!res.ok || !json?.ok) {
        setBulkStatus({
          state: "error",
          message:
            json?.detail || json?.error || `Bulk allocate failed (HTTP ${res.status})`,
        });
        return;
      }
      setBulkStatus({
        state: "saved",
        message: `Bulk allocated ${json.updatedRows ?? 0} provider rows across ${(json.regions ?? []).length} regions.`,
      });
      // Reload the list to reflect the new state.
      await loadList();
      if (onResolved) onResolved();
    } catch (err) {
      setBulkStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [loadList, onResolved]);

  // Per-row review actions (needsReview section).
  const submitReview = useCallback(
    async (
      row: NeedsReviewRow,
      action: "alias" | "canonical" | "ignore"
    ): Promise<void> => {
      const region = (regionByKey[row.normalized_key] ?? "").trim();
      const canonical = (canonicalByKey[row.normalized_key] ?? "").trim();

      if (action === "alias") {
        if (!region) {
          setStatus(row.normalized_key, {
            state: "error",
            message: "Pick a region first.",
          });
          return;
        }
        if (!canonical) {
          setStatus(row.normalized_key, {
            state: "error",
            message: "Pick a canonical area in that region.",
          });
          return;
        }
      } else if (action === "canonical") {
        if (!region) {
          setStatus(row.normalized_key, {
            state: "error",
            message: "Pick a region first.",
          });
          return;
        }
      }

      setStatus(row.normalized_key, { state: "saving" });
      try {
        const body: Record<string, unknown> = {
          raw_area: row.area,
          action,
        };
        if (action !== "ignore") body.region_code = region;
        if (action === "alias") body.canonical_area = canonical;

        const res = await fetch("/api/admin/provider-regions/resolve-area", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as ResolveResponse;
        if (!res.ok || !json?.ok) {
          setStatus(row.normalized_key, {
            state: "error",
            message:
              json?.detail || json?.error || `Resolve failed (HTTP ${res.status})`,
          });
          return;
        }
        if (action === "ignore") {
          setStatus(row.normalized_key, {
            state: "saved",
            message: "Marked as ignored",
          });
        } else if (action === "alias") {
          setStatus(row.normalized_key, {
            state: "saved",
            message: `Alias added → ${json.canonical_area} (${json.region_code}); ${json.updatedRows ?? 0} provider rows updated`,
          });
        } else {
          setStatus(row.normalized_key, {
            state: "saved",
            message: `Created canonical ${json.area_code} under ${json.region_code}; ${json.updatedRows ?? 0} provider rows updated`,
          });
        }
        removeReviewRowLocal(row.normalized_key);
        if (onResolved) onResolved();
      } catch (err) {
        setStatus(row.normalized_key, {
          state: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    },
    [
      regionByKey,
      canonicalByKey,
      setStatus,
      removeReviewRowLocal,
      onResolved,
    ]
  );

  const filteredAuto = useMemo(() => {
    if (!autoResolvable) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return autoResolvable;
    return autoResolvable.filter(
      (r) =>
        r.area.toLowerCase().includes(needle) ||
        r.canonical_area.toLowerCase().includes(needle) ||
        r.region_code.toLowerCase().includes(needle)
    );
  }, [autoResolvable, search]);

  const filteredReview = useMemo(() => {
    if (!needsReview) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return needsReview;
    return needsReview.filter((r) => r.area.toLowerCase().includes(needle));
  }, [needsReview, search]);

  // Header summary text: concise, mirrors the AreaTab card style.
  const headerSummary = summary
    ? `${summary.distinctAutoResolvableAreas} auto-resolvable · ${summary.distinctNeedsReviewAreas} needs review · ${summary.ignoredRows} ignored rows`
    : "Triage unresolved provider areas → JOD regions.";

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="provider-area-resolution-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-amber-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            Provider Area Resolution
          </p>
          <p className="mt-0.5 text-xs text-slate-600">{headerSummary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${
            expanded ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {expanded && (
        <div
          id="provider-area-resolution-body"
          className="border-t border-amber-200 bg-white px-5 py-5"
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by area / canonical / region…"
              aria-label="Filter resolution rows"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20 sm:max-w-sm"
            />
            <button
              type="button"
              onClick={() => void loadList()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw
                aria-hidden="true"
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {loadError && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadError}
            </p>
          )}

          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <SummaryStat
                label="Total NULL rows"
                value={summary.totalNullRows}
              />
              <SummaryStat
                label="Auto-resolvable"
                value={summary.autoResolvableRows}
                tone="emerald"
              />
              <SummaryStat
                label="Needs review"
                value={summary.reviewNeededRows}
                tone="amber"
              />
              <SummaryStat
                label="Ambiguous"
                value={summary.ambiguousRows}
                tone="rose"
              />
              <SummaryStat label="Ignored" value={summary.ignoredRows} />
            </div>
          )}

          {/* ── Auto-resolvable section ─────────────────────────────── */}
          {autoResolvable !== null && (
            <section className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/30">
              <button
                type="button"
                onClick={() => setAutoExpanded((v) => !v)}
                aria-expanded={autoExpanded}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-emerald-50/60"
              >
                <div>
                  <p className="text-sm font-semibold text-emerald-900">
                    Auto-resolvable ({filteredAuto.length})
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/80">
                    These can be allocated automatically because they already
                    match active areas / aliases. No catalog change needed.
                  </p>
                </div>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-emerald-700 transition-transform ${
                    autoExpanded ? "rotate-180" : "rotate-0"
                  }`}
                />
              </button>

              {autoExpanded && (
                <div className="border-t border-emerald-200 bg-white px-4 py-3">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-slate-600">
                      Click <strong>Allocate this area</strong> to update one
                      area at a time, or use the bulk button to populate every
                      auto-resolvable row in one shot.
                    </p>
                    <button
                      type="button"
                      onClick={() => void submitBulkAllocate()}
                      disabled={
                        bulkStatus.state === "saving" ||
                        (autoResolvable !== null &&
                          autoResolvable.length === 0)
                      }
                      className="inline-flex items-center gap-1.5 self-start rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {bulkStatus.state === "saving"
                        ? "Allocating…"
                        : "Allocate all auto-resolved"}
                    </button>
                  </div>

                  {bulkStatus.state !== "idle" && bulkStatus.message && (
                    <p
                      className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                        bulkStatus.state === "error"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {bulkStatus.message}
                    </p>
                  )}

                  {filteredAuto.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      {autoResolvable.length === 0
                        ? "Nothing auto-resolvable right now. Either everything is allocated or the unresolved set is purely admin-review work."
                        : "No auto-resolvable rows match the current filter."}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {filteredAuto.map((row) => {
                        const status: RowStatus = statusByKey[
                          row.normalized_key
                        ] ?? { state: "idle" };
                        return (
                          <li
                            key={row.normalized_key}
                            className="rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                                {row.count.toLocaleString()}{" "}
                                {row.count === 1 ? "row" : "rows"}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {row.area}
                              </span>
                              <span className="text-xs text-slate-500">
                                → {row.region_code} · {row.canonical_area} ·{" "}
                                {row.match_type}
                              </span>
                              {row.sample_provider_ids.length > 0 && (
                                <span className="text-xs text-slate-400">
                                  e.g.{" "}
                                  {row.sample_provider_ids.slice(0, 3).join(", ")}
                                  {row.sample_provider_ids.length > 3
                                    ? "…"
                                    : ""}
                                </span>
                              )}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void submitAllocate(row)}
                                disabled={status.state === "saving"}
                                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {status.state === "saving"
                                  ? "Allocating…"
                                  : "Allocate this area"}
                              </button>
                              {status.state !== "idle" && status.message && (
                                <span
                                  className={`text-xs ${
                                    status.state === "error"
                                      ? "text-red-700"
                                      : status.state === "saved"
                                        ? "text-emerald-700"
                                        : "text-slate-500"
                                  }`}
                                >
                                  {status.message}
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Needs admin review section ─────────────────────────── */}
          {needsReview !== null && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/30">
              <button
                type="button"
                onClick={() => setReviewExpanded((v) => !v)}
                aria-expanded={reviewExpanded}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-amber-50/60"
              >
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Needs admin review ({filteredReview.length})
                  </p>
                  <p className="mt-0.5 text-xs text-amber-800/80">
                    Map as alias to an existing canonical, create as a new
                    canonical area, or mark as outside service area.
                  </p>
                </div>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-amber-700 transition-transform ${
                    reviewExpanded ? "rotate-180" : "rotate-0"
                  }`}
                />
              </button>

              {reviewExpanded && (
                <div className="border-t border-amber-200 bg-white px-4 py-3">
                  {filteredReview.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      {needsReview.length === 0
                        ? "No admin review needed. Every unresolved area either auto-resolves or has been ignored."
                        : "No needs-review rows match the current filter."}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {filteredReview.map((row) => {
                        const region = regionByKey[row.normalized_key] ?? "";
                        const canonical =
                          canonicalByKey[row.normalized_key] ?? "";
                        const status: RowStatus = statusByKey[
                          row.normalized_key
                        ] ?? { state: "idle" };
                        const canonicalOptions = region
                          ? canonicalsByRegion.get(region) ?? []
                          : [];
                        const aliasDisabled =
                          status.state === "saving" || !region || !canonical;
                        const canonicalDisabled =
                          status.state === "saving" || !region;
                        const ignoreDisabled = status.state === "saving";

                        return (
                          <li
                            key={row.normalized_key}
                            className="rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                                {row.count.toLocaleString()}{" "}
                                {row.count === 1 ? "row" : "rows"}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {row.area}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  row.reason === "ambiguous"
                                    ? "bg-rose-100 text-rose-900"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {row.reason}
                              </span>
                              {row.sample_provider_ids.length > 0 && (
                                <span className="text-xs text-slate-400">
                                  e.g.{" "}
                                  {row.sample_provider_ids.slice(0, 3).join(", ")}
                                  {row.sample_provider_ids.length > 3
                                    ? "…"
                                    : ""}
                                </span>
                              )}
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
                              <select
                                value={region}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setRegionByKey((prev) => ({
                                    ...prev,
                                    [row.normalized_key]: next,
                                  }));
                                  setCanonicalByKey((prev) => ({
                                    ...prev,
                                    [row.normalized_key]: "",
                                  }));
                                  if (status.state !== "idle") {
                                    setStatus(row.normalized_key, {
                                      state: "idle",
                                    });
                                  }
                                }}
                                aria-label={`Region for ${row.area}`}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                              >
                                <option value="">Region…</option>
                                {activeRegions.map((r) => (
                                  <option
                                    key={r.region_code}
                                    value={r.region_code}
                                  >
                                    {r.region_code}
                                    {r.region_name ? ` — ${r.region_name}` : ""}
                                  </option>
                                ))}
                              </select>

                              <select
                                value={canonical}
                                onChange={(e) => {
                                  setCanonicalByKey((prev) => ({
                                    ...prev,
                                    [row.normalized_key]: e.target.value,
                                  }));
                                  if (status.state !== "idle") {
                                    setStatus(row.normalized_key, {
                                      state: "idle",
                                    });
                                  }
                                }}
                                disabled={!region}
                                aria-label={`Canonical area for ${row.area}`}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                <option value="">
                                  {region
                                    ? "Canonical area…"
                                    : "(pick region first)"}
                                </option>
                                {canonicalOptions.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                onClick={() => void submitReview(row, "alias")}
                                disabled={aliasDisabled}
                                className="rounded-lg bg-[#003d20] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                Map as alias
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  void submitReview(row, "canonical")
                                }
                                disabled={canonicalDisabled}
                                className="rounded-lg border border-[#003d20] bg-white px-3 py-2 text-sm font-semibold text-[#003d20] transition hover:bg-[#003d20]/5 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
                              >
                                Create canonical
                              </button>

                              <button
                                type="button"
                                onClick={() => void submitReview(row, "ignore")}
                                disabled={ignoreDisabled}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Ignore
                              </button>
                            </div>

                            {status.state !== "idle" && status.message && (
                              <p
                                className={`mt-2 text-xs ${
                                  status.state === "error"
                                    ? "text-red-700"
                                    : status.state === "saved"
                                      ? "text-emerald-700"
                                      : "text-slate-500"
                                }`}
                              >
                                {status.message}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "rose";
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
