"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil, RotateCcw, X } from "lucide-react";

import CacheStatusBar, {
  type CacheStatusBarMetadata,
} from "@/components/admin/CacheStatusBar";
import ProviderAreaResolutionSection from "@/components/admin/ProviderAreaResolutionSection";
import {
  type AdminCacheInterval,
  getAdminCacheInterval,
  msUntilNextAutoRefresh,
  setAdminCacheInterval,
} from "@/lib/admin/adminCachePreferences";

// Area Management accordion for /admin/dashboard.
// Hierarchy: Region → Area → Aliases. Regions are the top-level cards;
// expanding a region reveals its canonical areas; expanding an area
// reveals its aliases / local names.
//
// Reads:   GET /api/admin/areas
// Mutates: POST/PATCH /api/admin/area-intelligence
//   target:"area"  — add / rename / toggle active
//   target:"alias" — add / rename / toggle active
//
// No DELETE. "Disable" sets active=false on both areas and aliases.

type RegionRow = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
  // Provider density — populated by GET /api/admin/areas (Phase 3 addition).
  // Optional on the client side so older cached responses degrade gracefully.
  provider_count?: number;
  verified_provider_count?: number;
};

type AliasRow = {
  id: string;
  alias_code: string;
  alias: string;
  active: boolean;
  notes: string | null;
};

type AreaRow = {
  area_code: string;
  canonical_area: string;
  region_code: string;
  region_name: string | null;
  active: boolean;
  notes: string | null;
  aliases: AliasRow[];
};

type UnmappedProviderArea = {
  area: string;
  provider_count: number;
};

type PendingAreaRequest = {
  review_id: string;
  raw_area: string;
  occurrences: number;
  source_ref: string | null;
  source_type: string | null;
  last_seen_at: string | null;
  submitter_name: string | null;
  submitter_phone: string | null;
};

type LoadResponse = {
  ok?: boolean;
  regions?: RegionRow[];
  areas?: AreaRow[];
  unmapped_provider_areas?: UnmappedProviderArea[];
  pending_area_requests?: PendingAreaRequest[];
  error?: string;
};

type ActiveTab = "approved" | "pending";

type RowStatus = {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
};

// Phase A5: per-region disable/re-enable status. Carries the same
// state/message as RowStatus plus the list of active child areas the
// server returned when REGION_HAS_ACTIVE_AREAS blocked a disable so the
// card can render the friendly "still active under this region" hint.
type RegionDisableStatus = {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
  blockedActiveAreas?: Array<{ area_code: string; canonical_area: string }>;
  blockedActiveAreaCount?: number;
};

// Compute the next `A-###` / `AL-###` code from existing codes.
function nextCode(existingCodes: string[], prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let max = 0;
  for (const code of existingCodes) {
    const m = code.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  const suffix = next > 999 ? String(next) : String(next).padStart(3, "0");
  return `${prefix}${suffix}`;
}

// Compute the next region-prefixed manual area code, e.g. JOD-19-M001.
// Scans existing area codes within the same region for any `<region>-M###`
// pattern and returns the next available counter.
//
// The "M" suffix marks the row's provenance as Manually imported /
// admin-created, distinguishing it from "A" (original JOD-25 seed) and
// "E" (AI enrichment). See supabase/migrations/20260531120000_normalize_jod_area_codes.sql.
//
// Caller must pass only codes from the same region (or the full list —
// scoping is enforced by the regex anchor on regionCode).
function nextRegionManualAreaCode(
  regionCode: string,
  existingAreaCodes: string[]
): string {
  const escaped = regionCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}-M(\\d+)$`);
  let max = 0;
  for (const code of existingAreaCodes) {
    const m = code.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  const suffix = next > 999 ? String(next) : String(next).padStart(3, "0");
  return `${regionCode}-M${suffix}`;
}

// Case-insensitive exact match. Returns the first area whose
// canonical_area matches `text` (excluding `excludeAreaCode`), or null.
// Inactive rows are skipped so soft-deactivated legacy entries (e.g.
// the R-* rows retained by the JOD-25 migration for audit/re-enable)
// do not trigger duplicate warnings when an admin creates a row in
// the new JOD-* region structure.
function findDuplicateArea(
  text: string,
  areas: AreaRow[],
  excludeAreaCode: string | null
): AreaRow | null {
  const n = text.trim().toLowerCase();
  if (!n) return null;
  for (const a of areas) {
    if (a.area_code === excludeAreaCode) continue;
    if (a.active === false) continue;
    if (a.canonical_area.trim().toLowerCase() === n) return a;
  }
  return null;
}

// Returns the first (area, alias) pair whose alias text matches
// (excluding `excludeAliasCode`), or null. Inactive aliases and aliases
// under inactive parent areas are skipped so soft-deactivated legacy
// entries (e.g. R-* rows retained by the JOD-25 migration) do not
// trigger duplicate warnings against new active JOD-* aliases.
function findDuplicateAlias(
  text: string,
  areas: AreaRow[],
  excludeAliasCode: string | null
): { area: AreaRow; alias: AliasRow } | null {
  const n = text.trim().toLowerCase();
  if (!n) return null;
  for (const a of areas) {
    if (a.active === false) continue;
    for (const al of a.aliases) {
      if (al.alias_code === excludeAliasCode) continue;
      if (al.active === false) continue;
      if (al.alias.trim().toLowerCase() === n) return { area: a, alias: al };
    }
  }
  return null;
}

export default function AreaTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("approved");

  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [areas, setAreas] = useState<AreaRow[] | null>(null);
  // Diagnostics — provider_areas.area values that don't resolve to any
  // active service_region_areas canonical. Populated alongside the
  // regions / areas reads on each load.
  const [unmappedProviderAreas, setUnmappedProviderAreas] = useState<
    UnmappedProviderArea[]
  >([]);
  // Per-row promote state. Keys are the raw unmapped area strings —
  // they're unique within the response (server groups by raw area).
  const [promoteRegionByArea, setPromoteRegionByArea] = useState<
    Record<string, string>
  >({});
  // Selected canonical area for the "Add as Alias" path. Only meaningful
  // when a region is also selected (since canonicals are region-scoped).
  const [promoteCanonicalByArea, setPromoteCanonicalByArea] = useState<
    Record<string, string>
  >({});
  const [promoteStatusByArea, setPromoteStatusByArea] = useState<
    Record<string, RowStatus>
  >({});
  // One-shot confirmation tokens for cross-region duplicate creates.
  // First click sets the flag (and the button label flips to "Add
  // anyway"); second click submits.
  const [promoteAreaConfirmedFor, setPromoteAreaConfirmedFor] = useState<
    Set<string>
  >(new Set());
  const [promoteAliasConfirmedFor, setPromoteAliasConfirmedFor] = useState<
    Set<string>
  >(new Set());

  // Pending Approval tab state — review-queue rows from area_review_queue.
  // Per-row promote state mirrors the unmapped-section pattern but keyed
  // by review_id (raw_area is not guaranteed unique across the queue —
  // dedup is done by normalized_key server-side, not raw text).
  const [pendingAreaRequests, setPendingAreaRequests] = useState<
    PendingAreaRequest[]
  >([]);
  const [pendingRegionByReview, setPendingRegionByReview] = useState<
    Record<string, string>
  >({});
  const [pendingCanonicalByReview, setPendingCanonicalByReview] = useState<
    Record<string, string>
  >({});
  const [pendingStatusByReview, setPendingStatusByReview] = useState<
    Record<string, RowStatus>
  >({});
  const [pendingAreaConfirmedFor, setPendingAreaConfirmedFor] = useState<
    Set<string>
  >(new Set());
  const [pendingAliasConfirmedFor, setPendingAliasConfirmedFor] = useState<
    Set<string>
  >(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Snapshot-cache wiring for AreaTab. We keep the existing fetch
  // effect (it has many setters) and layer cache metadata, manual
  // refresh, and interval-driven auto refresh on top.
  const [cacheMeta, setCacheMeta] =
    useState<CacheStatusBarMetadata | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // forceRefreshOnce → next fetch appends ?refresh=1. Reset by the
  // fetch effect after it runs. Lets the Refresh button trigger a
  // recompute without growing a second copy of the load logic.
  const [forceRefreshOnce, setForceRefreshOnce] = useState(false);
  const [autoInterval, setAutoIntervalState] = useState<AdminCacheInterval>(
    () => getAdminCacheInterval("area_stats", "manual")
  );
  const setAutoInterval = useCallback((next: AdminCacheInterval) => {
    setAutoIntervalState(next);
    setAdminCacheInterval("area_stats", next);
  }, []);
  // Single-shot setTimeout for auto refresh — never a polling loop.
  const autoTimerRef = useRef<number | null>(null);

  // Add-area form (top-level)
  const [newCanonical, setNewCanonical] = useState("");
  const [newRegion, setNewRegion] = useState("");

  // Create-region form. Mirrors the add-area form's pattern but writes
  // POST /api/admin/area-intelligence target:"region". Status pill is
  // dedicated (not the global actionError banner) so feedback lands next
  // to the Create button.
  const [newRegionCodeDraft, setNewRegionCodeDraft] = useState("");
  const [newRegionNameDraft, setNewRegionNameDraft] = useState("");
  const [createRegionStatus, setCreateRegionStatus] = useState<RowStatus>({
    state: "idle",
  });
  // Per-region inline add — one in-progress text per region_code so two
  // regions' draft inputs don't collide. Each region renders its own
  // status pill so success/error feedback lands next to the form that
  // produced it.
  const [perRegionAddDraft, setPerRegionAddDraft] = useState<
    Record<string, string>
  >({});
  const [perRegionAddStatus, setPerRegionAddStatus] = useState<
    Record<string, RowStatus>
  >({});

  // Expand state — top-level regions
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(
    new Set()
  );
  // Per-area aliases expanded
  const [expandedAliasFor, setExpandedAliasFor] = useState<Set<string>>(
    new Set()
  );

  // Client-side search across region_code / region_name / canonical_area /
  // alias. Empty → list renders normally (collapsed regions). Non-empty →
  // only matching regions render, auto-expanded with matching areas + aliases.
  const [searchQuery, setSearchQuery] = useState("");

  // Inline rename state
  const [editingRegionCode, setEditingRegionCode] = useState<string | null>(
    null
  );
  const [editingRegionDraft, setEditingRegionDraft] = useState("");
  const [editingRegionError, setEditingRegionError] = useState<string | null>(
    null
  );
  // Dedicated status for region rename so feedback appears next to the
  // Save button (the global `actionError` banner sits at the top of the
  // tab body, which is far away when the region is scrolled below the
  // fold — previously perceived as "Save does nothing").
  const [editingRegionStatus, setEditingRegionStatus] = useState<RowStatus>({
    state: "idle",
  });
  // Phase A5: per-region status for the disable/re-enable flow. Keyed
  // by region_code so simultaneous actions on two cards don't collide.
  const [regionDisableStatusByCode, setRegionDisableStatusByCode] = useState<
    Record<string, RegionDisableStatus>
  >({});
  const [editingAreaCode, setEditingAreaCode] = useState<string | null>(null);
  const [editingAreaDraft, setEditingAreaDraft] = useState("");
  const [editingAliasCode, setEditingAliasCode] = useState<string | null>(null);
  const [editingAliasDraft, setEditingAliasDraft] = useState("");

  // Per-area "+ Add alias" state
  const [addingAliasFor, setAddingAliasFor] = useState<string | null>(null);
  const [newAliasDraft, setNewAliasDraft] = useState("");

  // Action plumbing
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Legacy R-* region cleanup — temporary admin maintenance widget.
  // Two-click flow: first click runs a dry-run (GET); the result is
  // surfaced inline; a second click on the confirm button triggers the
  // POST with ?dryRun=false. See
  // /api/admin/area-intelligence/cleanup-legacy-regions for the safety
  // rules — orphan-risk regions are skipped, not deleted.
  type CleanupReference = {
    table: "provider_areas" | "tasks" | "area_review_queue";
    legacy_name: string;
    count: number;
  };
  type CleanupCandidate = {
    region_code: string;
    region_name: string | null;
    safe: boolean;
    legacy_area_count: number;
    legacy_alias_count: number;
    references: CleanupReference[];
    orphan_risk_names: string[];
    skip_reason: string | null;
  };
  type CleanupWarning = {
    region_code: string;
    region_name: string | null;
    orphan_risk_names: string[];
    reference_counts: { table: string; name: string; count: number }[];
  };
  type CleanupSummary = {
    ok: true;
    dryRun: boolean;
    force: boolean;
    candidates: CleanupCandidate[];
    warnings: CleanupWarning[];
    deleted: Array<{
      region_code: string;
      region_name: string | null;
      areas_deleted: number;
      aliases_deleted: number;
    }>;
    skipped: Array<{
      region_code: string;
      region_name: string | null;
      reason: string;
    }>;
    counts: {
      regionsFound: number;
      regionsDeleted: number;
      regionsSkipped: number;
      areasDeleted: number;
      aliasesDeleted: number;
    };
  };
  type CleanupState =
    | { phase: "idle" }
    | { phase: "loading-dryrun" }
    | { phase: "dryrun-ready"; summary: CleanupSummary }
    | { phase: "loading-delete" }
    | { phase: "loading-force-delete" }
    | { phase: "done"; summary: CleanupSummary }
    | { phase: "error"; message: string };
  const [cleanupState, setCleanupState] = useState<CleanupState>({
    phase: "idle",
  });
  const runCleanupDryRun = async () => {
    setCleanupState({ phase: "loading-dryrun" });
    try {
      const res = await fetch(
        "/api/admin/area-intelligence/cleanup-legacy-regions",
        { method: "GET", cache: "no-store" }
      );
      const json = (await res.json()) as
        | CleanupSummary
        | { ok: false; error?: string; detail?: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        const msg =
          ("detail" in json && json.detail) ||
          ("error" in json && json.error) ||
          `Dry-run failed (HTTP ${res.status})`;
        setCleanupState({ phase: "error", message: String(msg) });
        return;
      }
      setCleanupState({ phase: "dryrun-ready", summary: json });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setCleanupState({ phase: "error", message: msg });
    }
  };
  const runCleanupDelete = async () => {
    setCleanupState({ phase: "loading-delete" });
    try {
      const res = await fetch(
        "/api/admin/area-intelligence/cleanup-legacy-regions?dryRun=false",
        { method: "POST" }
      );
      const json = (await res.json()) as
        | CleanupSummary
        | { ok: false; error?: string; detail?: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        const msg =
          ("detail" in json && json.detail) ||
          ("error" in json && json.error) ||
          `Delete failed (HTTP ${res.status})`;
        setCleanupState({ phase: "error", message: String(msg) });
        return;
      }
      setCleanupState({ phase: "done", summary: json });
      setRefreshKey((p) => p + 1); // reload the region list
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setCleanupState({ phase: "error", message: msg });
    }
  };
  // Force-delete path — bypasses the orphan-risk guard on the server.
  // Only callable from the dry-run-ready UI state and gated by a
  // browser confirm() so the bypass is never one-click. provider_areas,
  // tasks, and area_review_queue are not touched; the route returns
  // warnings describing the references that were left in place.
  const runCleanupForceDelete = async () => {
    const proceed = window.confirm(
      "This will remove old inactive R-* regions even if provider area references exist. Continue?"
    );
    if (!proceed) return;
    setCleanupState({ phase: "loading-force-delete" });
    try {
      const res = await fetch(
        "/api/admin/area-intelligence/cleanup-legacy-regions?dryRun=false&force=true",
        { method: "POST" }
      );
      const json = (await res.json()) as
        | CleanupSummary
        | { ok: false; error?: string; detail?: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        const msg =
          ("detail" in json && json.detail) ||
          ("error" in json && json.error) ||
          `Force delete failed (HTTP ${res.status})`;
        setCleanupState({ phase: "error", message: String(msg) });
        return;
      }
      setCleanupState({ phase: "done", summary: json });
      setRefreshKey((p) => p + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setCleanupState({ phase: "error", message: msg });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "approved") return;
    let cancelled = false;
    const force = forceRefreshOnce;
    if (force) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);
    const url = force
      ? "/api/admin/areas?refresh=1"
      : "/api/admin/areas";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (
          res: LoadResponse & { cache?: CacheStatusBarMetadata }
        ) => {
          if (cancelled) return;
          if (res?.ok && Array.isArray(res.areas) && Array.isArray(res.regions)) {
            setAreas(res.areas);
            setRegions(res.regions);
            setUnmappedProviderAreas(
              Array.isArray(res.unmapped_provider_areas)
                ? res.unmapped_provider_areas
                : []
            );
            setPendingAreaRequests(
              Array.isArray(res.pending_area_requests)
                ? res.pending_area_requests
                : []
            );
            setCacheMeta(res.cache ?? null);
          } else {
            setLoadError(res?.error || "Failed to load areas");
            // On a manual refresh failure, keep the old cacheMeta so
            // the UI still shows what we last had.
            if (!force) setCacheMeta(null);
          }
        }
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Network error");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, refreshKey, forceRefreshOnce]);

  const refresh = () => setRefreshKey((p) => p + 1);

  // Manual refresh — bypasses snapshot cache via ?refresh=1.
  const handleManualRefresh = useCallback(() => {
    if (refreshing) return;
    setForceRefreshOnce(true);
    setRefreshKey((p) => p + 1);
  }, [refreshing]);

  // Auto refresh scheduled by a single setTimeout — re-armed on each
  // cacheMeta update, interval change, or tab open. Cleared on
  // unmount / tab close. No polling loops.
  useEffect(() => {
    const cancelTimer = () => {
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
    cancelTimer();
    if (!isOpen) return;
    if (activeTab !== "approved") return;
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
      setRefreshKey((p) => p + 1);
    }, remaining);
    return cancelTimer;
  }, [isOpen, activeTab, cacheMeta, autoInterval]);

  // Group areas by region_code for the tree view. Areas already arrive
  // sorted by (region_code, canonical_area) from the server.
  const areasByRegion = useMemo(() => {
    const m = new Map<string, AreaRow[]>();
    for (const a of areas ?? []) {
      const arr = m.get(a.region_code) ?? [];
      arr.push(a);
      m.set(a.region_code, arr);
    }
    return m;
  }, [areas]);

  // Sort regions by code for deterministic output.
  const sortedRegions = useMemo(
    () =>
      [...regions].sort((a, b) => a.region_code.localeCompare(b.region_code)),
    [regions]
  );

  // Search filter — derives, in one pass:
  //   - visibleRegions: regions to render (filtered)
  //   - visibleAreasByRegion: which areas to render inside each region
  //   - forceAliasExpand: alias panels to auto-open because an alias matched
  // When the query is empty, all three reduce to "render everything normally".
  type SearchView = {
    active: boolean;
    visibleRegions: RegionRow[];
    visibleAreasByRegion: Map<string, AreaRow[]>;
    forceAliasExpand: Set<string>; // area_code
    matchedAreaCount: number;
  };
  const searchView: SearchView = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        active: false,
        visibleRegions: sortedRegions,
        visibleAreasByRegion: areasByRegion,
        forceAliasExpand: new Set<string>(),
        matchedAreaCount: areas?.length ?? 0,
      };
    }

    const matches = (value: unknown) =>
      String(value ?? "").toLowerCase().includes(q);

    const visibleRegions: RegionRow[] = [];
    const visibleAreasByRegion = new Map<string, AreaRow[]>();
    const forceAliasExpand = new Set<string>();
    let matchedAreaCount = 0;

    for (const region of sortedRegions) {
      const regionItselfMatches =
        matches(region.region_code) || matches(region.region_name);
      const areasInRegion = areasByRegion.get(region.region_code) ?? [];

      const areasToShow: AreaRow[] = [];
      for (const area of areasInRegion) {
        const areaItselfMatches = matches(area.canonical_area);
        const matchingAliases = area.aliases.filter((al) =>
          matches(al.alias)
        );
        const hasMatchingAlias = matchingAliases.length > 0;

        // Show this area if:
        //   • the region itself matched (give full context), or
        //   • the area name matched, or
        //   • any of its aliases matched
        const shouldShow =
          regionItselfMatches || areaItselfMatches || hasMatchingAlias;
        if (!shouldShow) continue;

        areasToShow.push(area);
        if (hasMatchingAlias) forceAliasExpand.add(area.area_code);
      }

      const regionHasAnyMatch =
        regionItselfMatches || areasToShow.length > 0;
      if (!regionHasAnyMatch) continue;

      visibleRegions.push(region);
      visibleAreasByRegion.set(region.region_code, areasToShow);
      matchedAreaCount += areasToShow.length;
    }

    return {
      active: true,
      visibleRegions,
      visibleAreasByRegion,
      forceAliasExpand,
      matchedAreaCount,
    };
  }, [searchQuery, sortedRegions, areasByRegion, areas]);

  // Duplicate detection — informational only. API still enforces its own
  // hard rules (per-region uniqueness etc.) and we surface those on save.
  const allAreas = areas ?? [];
  const dupNewArea = findDuplicateArea(newCanonical, allAreas, null);
  const dupNewAlias =
    addingAliasFor !== null
      ? findDuplicateAlias(newAliasDraft, allAreas, null)
      : null;
  const dupEditArea =
    editingAreaCode !== null
      ? findDuplicateArea(editingAreaDraft, allAreas, editingAreaCode)
      : null;
  const dupEditAlias =
    editingAliasCode !== null
      ? findDuplicateAlias(editingAliasDraft, allAreas, editingAliasCode)
      : null;

  const callAi = async (
    method: "POST" | "PATCH",
    actionKey: string,
    body: Record<string, unknown>,
    onSuccess: () => void
  ) => {
    setActionInProgress(actionKey);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json?.ok) {
        setActionError(
          json?.detail || json?.error || `Action failed (${res.status})`
        );
        return;
      }
      onSuccess();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStartEditRegion = (region: RegionRow) => {
    setEditingRegionCode(region.region_code);
    setEditingRegionDraft(region.region_name ?? "");
    setEditingRegionError(null);
    setEditingRegionStatus({ state: "idle" });
  };
  const handleCancelEditRegion = () => {
    setEditingRegionCode(null);
    setEditingRegionDraft("");
    setEditingRegionError(null);
    setEditingRegionStatus({ state: "idle" });
  };
  const handleSaveEditRegion = async (region: RegionRow) => {
    const newName = editingRegionDraft.trim();
    if (!newName) {
      setEditingRegionError("Region name cannot be blank.");
      setEditingRegionStatus({ state: "idle" });
      return;
    }
    if (newName === (region.region_name ?? "")) {
      handleCancelEditRegion();
      return;
    }
    setEditingRegionError(null);
    setEditingRegionStatus({ state: "saving" });

    // Direct fetch (mirrors callAi but routes feedback into the
    // dedicated editingRegionStatus state rather than the global
    // actionError banner — the inline pill sits right next to the Save
    // button so the user always sees what happened).
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "region",
          region_code: region.region_code,
          region_name: newName,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json?.ok) {
        const msg =
          json?.detail || json?.error || `Save failed (HTTP ${res.status})`;
        setEditingRegionStatus({ state: "error", message: msg });
        return;
      }
      // Local state update — region_code is the immutable identifier so
      // areas / aliases under it are unaffected.
      setRegions((prev) =>
        prev.map((r) =>
          r.region_code === region.region_code
            ? { ...r, region_name: newName }
            : r
        )
      );
      setEditingRegionStatus({ state: "saved", message: "Saved" });
      // Brief success flash, then drop out of edit mode. setTimeout keeps
      // the "Saved" pill visible long enough for the eye to register.
      window.setTimeout(() => {
        setEditingRegionCode((cur) =>
          cur === region.region_code ? null : cur
        );
        setEditingRegionDraft("");
        setEditingRegionError(null);
        setEditingRegionStatus({ state: "idle" });
      }, 700);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setEditingRegionStatus({ state: "error", message: msg });
    }
  };

  // Phase A5: disable a region. Server enforces REGION_HAS_ACTIVE_AREAS;
  // when the guard fires we surface the listed active areas inline on
  // the region card and auto-expand the region so the admin can act on
  // each child. Uses a direct fetch (not callAi) so the response can
  // route into the per-region status slot rather than the global banner.
  const handleDisableRegion = async (region: RegionRow) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Disable region "${region.region_code}${
          region.region_name ? ` — ${region.region_name}` : ""
        }"? Its areas (and the aliases under them) will be hidden from public search, autocomplete, and provider dashboards while it is inactive.`
      )
    ) {
      return;
    }
    setRegionDisableStatusByCode((prev) => ({
      ...prev,
      [region.region_code]: { state: "saving" },
    }));
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "region",
          region_code: region.region_code,
          active: false,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        areas?: Array<{ area_code: string; canonical_area: string }>;
        active_area_count?: number;
      };
      if (!res.ok || !json?.ok) {
        if (json?.error === "REGION_HAS_ACTIVE_AREAS") {
          // Auto-expand the region so the admin sees the blocking
          // areas without an extra click.
          setExpandedRegions((prev) => {
            const next = new Set(prev);
            next.add(region.region_code);
            return next;
          });
          setRegionDisableStatusByCode((prev) => ({
            ...prev,
            [region.region_code]: {
              state: "error",
              message:
                json?.detail ||
                "This region still has active areas. Disable them first.",
              blockedActiveAreas: Array.isArray(json.areas) ? json.areas : [],
              blockedActiveAreaCount:
                typeof json.active_area_count === "number"
                  ? json.active_area_count
                  : (json.areas?.length ?? 0),
            },
          }));
          return;
        }
        setRegionDisableStatusByCode((prev) => ({
          ...prev,
          [region.region_code]: {
            state: "error",
            message:
              json?.detail ||
              json?.error ||
              `Disable failed (HTTP ${res.status})`,
          },
        }));
        return;
      }
      // Local state update — flip the region's active flag immediately
      // so the card flips visual state without waiting for refresh().
      setRegions((prev) =>
        prev.map((r) =>
          r.region_code === region.region_code ? { ...r, active: false } : r
        )
      );
      setRegionDisableStatusByCode((prev) => ({
        ...prev,
        [region.region_code]: { state: "saved", message: "Region disabled" },
      }));
      refresh();
      // Clear the success pill after a brief flash.
      window.setTimeout(() => {
        setRegionDisableStatusByCode((prev) => ({
          ...prev,
          [region.region_code]: { state: "idle" },
        }));
      }, 1200);
    } catch (err: unknown) {
      setRegionDisableStatusByCode((prev) => ({
        ...prev,
        [region.region_code]: {
          state: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      }));
    }
  };

  // Phase A5: re-enable a region. Restorative; no confirm dialog. The
  // server has no guard on this direction — children keep whatever
  // active state they had when the region was disabled (A5 deliberately
  // does NOT cascade), so this only flips the region row itself.
  const handleReenableRegion = async (region: RegionRow) => {
    setRegionDisableStatusByCode((prev) => ({
      ...prev,
      [region.region_code]: { state: "saving" },
    }));
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "region",
          region_code: region.region_code,
          active: true,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json?.ok) {
        setRegionDisableStatusByCode((prev) => ({
          ...prev,
          [region.region_code]: {
            state: "error",
            message:
              json?.detail ||
              json?.error ||
              `Re-enable failed (HTTP ${res.status})`,
          },
        }));
        return;
      }
      setRegions((prev) =>
        prev.map((r) =>
          r.region_code === region.region_code ? { ...r, active: true } : r
        )
      );
      setRegionDisableStatusByCode((prev) => ({
        ...prev,
        [region.region_code]: { state: "saved", message: "Region re-enabled" },
      }));
      refresh();
      window.setTimeout(() => {
        setRegionDisableStatusByCode((prev) => ({
          ...prev,
          [region.region_code]: { state: "idle" },
        }));
      }, 1200);
    } catch (err: unknown) {
      setRegionDisableStatusByCode((prev) => ({
        ...prev,
        [region.region_code]: {
          state: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      }));
    }
  };

  // Shared core for both top-level and per-region area creation.
  // Returns a Promise so per-region callers can react after the API
  // finishes (status pills, draft cleanup).
  const addAreaCore = (params: {
    canonical: string;
    region_code: string;
    actionKey: string;
    onSuccess: () => void;
    onError?: (message: string) => void;
  }) => {
    const { canonical, region_code, actionKey, onSuccess, onError } = params;
    if (!canonical || !region_code) {
      const msg = !canonical
        ? "Canonical area name is required."
        : "Pick a region for the new area.";
      if (onError) onError(msg);
      else setActionError(msg);
      return;
    }
    // Mint the next region-prefixed M code (JOD-19-M001, JOD-19-M002, …)
    // instead of the legacy global A-#### counter. The migration
    // 20260531120000_normalize_jod_area_codes.sql renames any historical
    // A-#### rows to this scheme; this mint site keeps the catalog
    // consistent going forward. Aliases still use the AL- prefix
    // (alias_code is independent of area_code).
    const area_code = nextRegionManualAreaCode(
      region_code,
      allAreas.map((a) => a.area_code)
    );
    void callAi(
      "POST",
      actionKey,
      {
        target: "area",
        area_code,
        canonical_area: canonical,
        region_code,
        active: true,
      },
      onSuccess
    );
  };

  // Create a brand-new region via POST /api/admin/area-intelligence
  // target:"region". Mirrors the inline-status pattern used by per-region
  // area creation so feedback lands beside the form, not in the global
  // actionError banner at the top of the tab. Client-side guards:
  //   - non-empty code + name
  //   - case-insensitive duplicate against the loaded `regions` list
  // The server still enforces these (REQUIRED_FIELDS_MISSING /
  // DUPLICATE_REGION_CODE / DB_ERROR); the client checks just avoid a
  // pointless roundtrip and let us name the conflicting region.
  const handleCreateRegion = async () => {
    const code = newRegionCodeDraft.trim();
    const name = newRegionNameDraft.trim();
    if (!code) {
      setCreateRegionStatus({
        state: "error",
        message: "Region code is required.",
      });
      return;
    }
    if (!name) {
      setCreateRegionStatus({
        state: "error",
        message: "Region name is required.",
      });
      return;
    }
    const codeLower = code.toLowerCase();
    const dup = regions.find(
      (r) => r.region_code.trim().toLowerCase() === codeLower
    );
    if (dup) {
      setCreateRegionStatus({
        state: "error",
        message: `Region code "${code}" already exists${
          dup.region_name ? ` (${dup.region_name})` : ""
        }.`,
      });
      return;
    }
    setCreateRegionStatus({ state: "saving" });
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "region",
          region_code: code,
          region_name: name,
          active: true,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json?.ok) {
        // Friendly translation for the two error codes postRegion can
        // return; anything else (transient DB blip) falls through to the
        // raw detail/error.
        const errCode = json?.error;
        const friendly =
          errCode === "DUPLICATE_REGION_CODE"
            ? `A region with code "${code}" already exists.`
            : errCode === "REQUIRED_FIELDS_MISSING"
              ? "Region code and name are both required."
              : null;
        setCreateRegionStatus({
          state: "error",
          message:
            friendly ||
            json?.detail ||
            json?.error ||
            `Create failed (HTTP ${res.status})`,
        });
        return;
      }
      setCreateRegionStatus({
        state: "saved",
        message: `Created region "${code} — ${name}".`,
      });
      setNewRegionCodeDraft("");
      setNewRegionNameDraft("");
      refresh();
    } catch (err: unknown) {
      setCreateRegionStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const handleAddArea = () => {
    const canonical = newCanonical.trim();
    const region_code = newRegion.trim();
    addAreaCore({
      canonical,
      region_code,
      actionKey: `addArea::${canonical}`,
      onSuccess: () => {
        setNewCanonical("");
        setNewRegion("");
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      },
    });
  };

  // Per-region "Add area in this region" — the same writes, but state
  // and feedback are scoped to one region so each card behaves independently.
  const handleAddAreaInRegion = (region_code: string) => {
    const canonical = (perRegionAddDraft[region_code] ?? "").trim();
    if (!canonical) {
      setPerRegionAddStatus((prev) => ({
        ...prev,
        [region_code]: {
          state: "error",
          message: "Area name is required.",
        },
      }));
      return;
    }
    setPerRegionAddStatus((prev) => ({
      ...prev,
      [region_code]: { state: "saving" },
    }));
    addAreaCore({
      canonical,
      region_code,
      actionKey: `addArea::${canonical}@${region_code}`,
      onSuccess: () => {
        setPerRegionAddDraft((prev) => ({ ...prev, [region_code]: "" }));
        setPerRegionAddStatus((prev) => ({
          ...prev,
          [region_code]: {
            state: "saved",
            message: `Created "${canonical}"`,
          },
        }));
        // Keep the region expanded so the new row appears immediately.
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      },
    });
    // Error path is surfaced via the top-level actionError banner (set
    // inside callAi). Mirror that into the per-region status pill on the
    // next render via an effect-less approach: watch `actionError` is
    // out of scope here; we leave the per-region pill at "saving" until
    // the banner clears. Simpler than a watcher, and the global banner
    // is immediately visible above the regions list.
  };

  // Promote an unmapped provider_areas string into Area Intelligence as
  // a new canonical area in the admin-picked region. Reuses addAreaCore
  // (same area_code auto-gen, same POST target:"area" path, same server-
  // side validators).
  const handlePromoteUnmapped = (rawArea: string) => {
    const canonical = rawArea.trim();
    const region_code = (promoteRegionByArea[rawArea] ?? "").trim();
    if (!canonical) return;
    if (!region_code) {
      setPromoteStatusByArea((prev) => ({
        ...prev,
        [rawArea]: { state: "error", message: "Pick a region first." },
      }));
      return;
    }
    // Cross-region duplicate confirmation gate. Same-region duplicate
    // is blocked by the server (DUPLICATE_AREA_IN_REGION → 409); cross-
    // region duplicate is allowed but flagged so admins don't fork the
    // canonical accidentally.
    const dup = findDuplicateArea(canonical, allAreas, null);
    const isCrossRegionDup = dup && dup.region_code !== region_code;
    if (isCrossRegionDup && !promoteAreaConfirmedFor.has(rawArea)) {
      setPromoteAreaConfirmedFor((prev) => {
        const next = new Set(prev);
        next.add(rawArea);
        return next;
      });
      setPromoteStatusByArea((prev) => ({
        ...prev,
        [rawArea]: {
          state: "error",
          message: `"${canonical}" also exists in ${dup!.region_code}. Click again to add to ${region_code} anyway.`,
        },
      }));
      return;
    }
    setPromoteStatusByArea((prev) => ({
      ...prev,
      [rawArea]: { state: "saving" },
    }));
    addAreaCore({
      canonical,
      region_code,
      actionKey: `promoteUnmapped::${rawArea}@${region_code}`,
      onSuccess: () => {
        setUnmappedProviderAreas((prev) =>
          prev.filter((r) => r.area !== rawArea)
        );
        setPromoteAreaConfirmedFor((prev) => {
          const next = new Set(prev);
          next.delete(rawArea);
          return next;
        });
        setPromoteStatusByArea((prev) => ({
          ...prev,
          [rawArea]: {
            state: "saved",
            message: `Promoted to ${region_code}`,
          },
        }));
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      },
    });
  };

  // Shared core for alias creation. Mirrors addAreaCore — same POST
  // target:"alias" body, same alias_code auto-generation, same server-
  // side validators (alias_code uniqueness, region+pair existence,
  // per-region alias uniqueness).
  const addAliasCore = (params: {
    alias: string;
    canonical_area: string;
    region_code: string;
    actionKey: string;
    onSuccess: () => void;
    onError?: (msg: string) => void;
  }) => {
    const { alias, canonical_area, region_code, actionKey, onSuccess, onError } =
      params;
    if (!alias || !canonical_area || !region_code) {
      const msg = !alias
        ? "Alias text is required."
        : !region_code
          ? "Pick a region first."
          : "Pick a canonical area in the selected region.";
      if (onError) onError(msg);
      else setActionError(msg);
      return;
    }
    const allAliasCodes = (areas ?? []).flatMap((a) =>
      a.aliases.map((al) => al.alias_code)
    );
    const alias_code = nextCode(allAliasCodes, "AL-");
    void callAi(
      "POST",
      actionKey,
      {
        target: "alias",
        alias_code,
        alias,
        canonical_area,
        region_code,
        active: true,
      },
      onSuccess
    );
  };

  // Best-effort: mark an area_review_queue row resolved after a
  // successful area/alias create. Failures are non-fatal — the user
  // already got their area/alias; the queue row will simply remain
  // pending and can be cleared next round. We surface the error in
  // the row's status pill so the admin can see it.
  const resolveReviewRow = async (
    review_id: string,
    resolved_canonical_area: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/admin/areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve_review",
          review_id,
          resolved_canonical_area,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json?.ok) {
        return {
          ok: false,
          error:
            json?.detail || json?.error || `Resolve failed (${res.status})`,
        };
      }
      return { ok: true };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      };
    }
  };

  // Approve a pending review-queue row as a new canonical area in the
  // admin-picked region. Reuses addAreaCore. After the area is created,
  // marks the queue row resolved so the row drops out of the pending tab
  // and the provider's dashboard reflects the mapped outcome on next load.
  const handleApprovePendingAsArea = (req: PendingAreaRequest) => {
    const canonical = req.raw_area.trim();
    const region_code = (pendingRegionByReview[req.review_id] ?? "").trim();
    if (!canonical) return;
    if (!region_code) {
      setPendingStatusByReview((prev) => ({
        ...prev,
        [req.review_id]: { state: "error", message: "Pick a region first." },
      }));
      return;
    }
    const dup = findDuplicateArea(canonical, allAreas, null);
    const isCrossRegionDup = dup && dup.region_code !== region_code;
    if (isCrossRegionDup && !pendingAreaConfirmedFor.has(req.review_id)) {
      setPendingAreaConfirmedFor((prev) => {
        const next = new Set(prev);
        next.add(req.review_id);
        return next;
      });
      setPendingStatusByReview((prev) => ({
        ...prev,
        [req.review_id]: {
          state: "error",
          message: `"${canonical}" also exists in ${dup!.region_code}. Click again to add to ${region_code} anyway.`,
        },
      }));
      return;
    }
    setPendingStatusByReview((prev) => ({
      ...prev,
      [req.review_id]: { state: "saving" },
    }));
    addAreaCore({
      canonical,
      region_code,
      actionKey: `pendingArea::${req.review_id}@${region_code}`,
      onSuccess: async () => {
        const resolveRes = await resolveReviewRow(req.review_id, canonical);
        setPendingAreaRequests((prev) =>
          prev.filter((r) => r.review_id !== req.review_id)
        );
        setPendingAreaConfirmedFor((prev) => {
          const next = new Set(prev);
          next.delete(req.review_id);
          return next;
        });
        setPendingStatusByReview((prev) => ({
          ...prev,
          [req.review_id]: resolveRes.ok
            ? {
                state: "saved",
                message: `Approved as area in ${region_code}`,
              }
            : {
                state: "error",
                message: `Area created but queue resolve failed: ${resolveRes.error}`,
              },
        }));
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      },
    });
  };

  // Approve a pending review-queue row as an alias of an existing
  // canonical area in the admin-picked region. Reuses addAliasCore.
  const handleApprovePendingAsAlias = (req: PendingAreaRequest) => {
    const aliasText = req.raw_area.trim();
    const region_code = (pendingRegionByReview[req.review_id] ?? "").trim();
    const canonical_area = (
      pendingCanonicalByReview[req.review_id] ?? ""
    ).trim();
    if (!aliasText) return;
    if (!region_code) {
      setPendingStatusByReview((prev) => ({
        ...prev,
        [req.review_id]: { state: "error", message: "Pick a region first." },
      }));
      return;
    }
    if (!canonical_area) {
      setPendingStatusByReview((prev) => ({
        ...prev,
        [req.review_id]: {
          state: "error",
          message: "Pick a canonical area in that region.",
        },
      }));
      return;
    }
    const dupAlias = findDuplicateAlias(aliasText, allAreas, null);
    const isCrossRegionAliasDup =
      dupAlias && dupAlias.area.region_code !== region_code;
    if (isCrossRegionAliasDup && !pendingAliasConfirmedFor.has(req.review_id)) {
      setPendingAliasConfirmedFor((prev) => {
        const next = new Set(prev);
        next.add(req.review_id);
        return next;
      });
      setPendingStatusByReview((prev) => ({
        ...prev,
        [req.review_id]: {
          state: "error",
          message: `Alias "${aliasText}" already used under ${dupAlias!.area.canonical_area} / ${dupAlias!.area.region_code}. Click again to add anyway.`,
        },
      }));
      return;
    }
    setPendingStatusByReview((prev) => ({
      ...prev,
      [req.review_id]: { state: "saving" },
    }));
    addAliasCore({
      alias: aliasText,
      canonical_area,
      region_code,
      actionKey: `pendingAlias::${req.review_id}@${region_code}`,
      onSuccess: async () => {
        const resolveRes = await resolveReviewRow(req.review_id, canonical_area);
        setPendingAreaRequests((prev) =>
          prev.filter((r) => r.review_id !== req.review_id)
        );
        setPendingAliasConfirmedFor((prev) => {
          const next = new Set(prev);
          next.delete(req.review_id);
          return next;
        });
        setPendingStatusByReview((prev) => ({
          ...prev,
          [req.review_id]: resolveRes.ok
            ? {
                state: "saved",
                message: `Approved as alias of ${canonical_area} (${region_code})`,
              }
            : {
                state: "error",
                message: `Alias created but queue resolve failed: ${resolveRes.error}`,
              },
        }));
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      },
    });
  };

  // Promote an unmapped provider_areas string as an alias of an existing
  // canonical area in the admin-picked region. After this lands, the
  // next refresh's API response will treat the same provider_areas.area
  // as mapped (because the unmapped-detection logic on the server now
  // also checks aliases), so the row drops out naturally.
  const handlePromoteAsAlias = (rawArea: string) => {
    const aliasText = rawArea.trim();
    const region_code = (promoteRegionByArea[rawArea] ?? "").trim();
    const canonical_area = (promoteCanonicalByArea[rawArea] ?? "").trim();
    if (!aliasText) return;
    if (!region_code) {
      setPromoteStatusByArea((prev) => ({
        ...prev,
        [rawArea]: { state: "error", message: "Pick a region first." },
      }));
      return;
    }
    if (!canonical_area) {
      setPromoteStatusByArea((prev) => ({
        ...prev,
        [rawArea]: {
          state: "error",
          message: "Pick a canonical area in that region.",
        },
      }));
      return;
    }
    // Cross-region alias duplicate gate (same pattern as Add-as-Area).
    const dupAlias = findDuplicateAlias(aliasText, allAreas, null);
    const isCrossRegionAliasDup =
      dupAlias && dupAlias.area.region_code !== region_code;
    if (isCrossRegionAliasDup && !promoteAliasConfirmedFor.has(rawArea)) {
      setPromoteAliasConfirmedFor((prev) => {
        const next = new Set(prev);
        next.add(rawArea);
        return next;
      });
      setPromoteStatusByArea((prev) => ({
        ...prev,
        [rawArea]: {
          state: "error",
          message: `Alias "${aliasText}" already used under ${dupAlias!.area.canonical_area} / ${dupAlias!.area.region_code}. Click again to add anyway.`,
        },
      }));
      return;
    }
    setPromoteStatusByArea((prev) => ({
      ...prev,
      [rawArea]: { state: "saving" },
    }));
    addAliasCore({
      alias: aliasText,
      canonical_area,
      region_code,
      actionKey: `promoteAlias::${rawArea}@${region_code}`,
      onSuccess: () => {
        setUnmappedProviderAreas((prev) =>
          prev.filter((r) => r.area !== rawArea)
        );
        setPromoteAliasConfirmedFor((prev) => {
          const next = new Set(prev);
          next.delete(rawArea);
          return next;
        });
        setPromoteStatusByArea((prev) => ({
          ...prev,
          [rawArea]: {
            state: "saved",
            message: `Alias added under ${canonical_area} (${region_code})`,
          },
        }));
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      },
    });
  };

  const handleSaveAreaEdit = (area: AreaRow) => {
    const newName = editingAreaDraft.trim();
    if (!newName || newName === area.canonical_area) {
      setEditingAreaCode(null);
      setEditingAreaDraft("");
      return;
    }
    void callAi(
      "PATCH",
      `editArea::${area.area_code}`,
      {
        target: "area",
        area_code: area.area_code,
        canonical_area: newName,
      },
      () => {
        setEditingAreaCode(null);
        setEditingAreaDraft("");
        refresh();
      }
    );
  };

  const handleToggleArea = (area: AreaRow) => {
    void callAi(
      "PATCH",
      `toggleArea::${area.area_code}`,
      {
        target: "area",
        area_code: area.area_code,
        active: !area.active,
      },
      refresh
    );
  };

  const handleStartAddAlias = (areaCode: string) => {
    setAddingAliasFor(areaCode);
    setNewAliasDraft("");
    setActionError(null);
    setExpandedAliasFor((prev) => {
      const next = new Set(prev);
      next.add(areaCode);
      return next;
    });
  };
  const handleCancelAddAlias = () => {
    setAddingAliasFor(null);
    setNewAliasDraft("");
  };

  const handleSaveNewAlias = (area: AreaRow) => {
    const text = newAliasDraft.trim();
    if (!text) return;
    const allAliasCodes = allAreas.flatMap((a) =>
      a.aliases.map((al) => al.alias_code)
    );
    const alias_code = nextCode(allAliasCodes, "AL-");
    void callAi(
      "POST",
      `addAlias::${area.area_code}`,
      {
        target: "alias",
        alias_code,
        alias: text,
        canonical_area: area.canonical_area,
        region_code: area.region_code,
        active: true,
      },
      () => {
        handleCancelAddAlias();
        refresh();
      }
    );
  };

  const handleSaveAliasEdit = (alias: AliasRow) => {
    const newText = editingAliasDraft.trim();
    if (!newText || newText === alias.alias) {
      setEditingAliasCode(null);
      setEditingAliasDraft("");
      return;
    }
    void callAi(
      "PATCH",
      `editAlias::${alias.alias_code}`,
      {
        target: "alias",
        alias_code: alias.alias_code,
        alias: newText,
      },
      () => {
        setEditingAliasCode(null);
        setEditingAliasDraft("");
        refresh();
      }
    );
  };

  const handleDisableAlias = (alias: AliasRow) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Disable alias "${alias.alias}"? It can be re-enabled.`)
    ) {
      return;
    }
    void callAi(
      "PATCH",
      `disableAlias::${alias.alias_code}`,
      {
        target: "alias",
        alias_code: alias.alias_code,
        active: false,
      },
      refresh
    );
  };

  // Phase A4: restore a previously soft-disabled alias. No confirm
  // dialog — re-enabling is restorative. Per-region alias uniqueness is
  // already preserved on prod because aliasExistsInRegion (server) does
  // not filter on active, so a same-text active alias cannot have been
  // created while this one was disabled.
  const handleReenableAlias = (alias: AliasRow) => {
    void callAi(
      "PATCH",
      `reenableAlias::${alias.alias_code}`,
      {
        target: "alias",
        alias_code: alias.alias_code,
        active: true,
      },
      refresh
    );
  };

  const summary = areas
    ? `${areas.length} canonical area${areas.length === 1 ? "" : "s"} · ${regions.length} region${regions.length === 1 ? "" : "s"}`
    : "Region → Area → Alias management";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="area-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">Area</p>
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
        <div id="area-tab-body" className="border-t border-slate-200 px-5 py-5">
          {/* Provider Area Resolution Center — collapsible triage UI for
              unresolved provider_areas rows (city='JOD', region_code IS
              NULL). Sits above the tab switcher so it's reachable from
              either Approved or Pending Approval views. Lazy-loads its
              own data on first expand and refreshes the AreaTab tree on
              each successful resolve so newly-added aliases/canonicals
              and recomputed provider counts surface immediately. */}
          <div className="mb-4">
            <ProviderAreaResolutionSection
              regions={regions}
              areas={(areas ?? []).map((a) => ({
                canonical_area: a.canonical_area,
                region_code: a.region_code,
                active: a.active,
              }))}
              onResolved={refresh}
            />
          </div>

          <div className="flex gap-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab("approved")}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
                activeTab === "approved"
                  ? "border-[#003d20] text-[#003d20]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Approved Areas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pending")}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
                activeTab === "pending"
                  ? "border-[#003d20] text-[#003d20]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Pending Approval
            </button>
          </div>

          {actionError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          )}

          {activeTab === "approved" && (
            <div className="mt-4 space-y-4">
              {/* Snapshot cache status — same component the other
                  admin tabs use. Auto-refresh interval persists per
                  admin in localStorage; manual Refresh calls
                  ?refresh=1 to bypass the 6-hour server cache. */}
              <CacheStatusBar
                cache={cacheMeta}
                refreshing={refreshing || loading}
                onRefresh={handleManualRefresh}
                interval={autoInterval}
                onIntervalChange={setAutoInterval}
              />
              {/* Create Region — POST /api/admin/area-intelligence
                  target:"region". Sits above the canonical-area add form
                  because regions are the parent layer; until a region
                  exists, no areas can be created inside it. The region
                  code placeholder suggests the next R-NNN based on
                  existing rows but the field stays fully editable. */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Create region
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newRegionCodeDraft}
                    onChange={(e) => {
                      setNewRegionCodeDraft(e.target.value);
                      if (createRegionStatus.state !== "idle") {
                        setCreateRegionStatus({ state: "idle" });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateRegion();
                    }}
                    placeholder={`Region code (e.g. ${nextCode(
                      regions.map((r) => r.region_code),
                      "R-"
                    )})`}
                    aria-label="Region code"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20 sm:max-w-[14rem]"
                  />
                  <input
                    type="text"
                    value={newRegionNameDraft}
                    onChange={(e) => {
                      setNewRegionNameDraft(e.target.value);
                      if (createRegionStatus.state !== "idle") {
                        setCreateRegionStatus({ state: "idle" });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateRegion();
                    }}
                    placeholder="Region name (e.g. South Jodhpur)"
                    aria-label="Region name"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateRegion()}
                    disabled={
                      !newRegionCodeDraft.trim() ||
                      !newRegionNameDraft.trim() ||
                      createRegionStatus.state === "saving"
                    }
                    className="rounded-lg bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {createRegionStatus.state === "saving"
                      ? "Creating…"
                      : "Create"}
                  </button>
                </div>
                {createRegionStatus.state === "saved" &&
                createRegionStatus.message ? (
                  <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                    {createRegionStatus.message}
                  </p>
                ) : null}
                {createRegionStatus.state === "error" &&
                createRegionStatus.message ? (
                  <p
                    className="mt-1.5 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                    role="alert"
                  >
                    {createRegionStatus.message}
                  </p>
                ) : null}
              </div>

              <div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={newCanonical}
                    onChange={(e) => setNewCanonical(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddArea();
                    }}
                    placeholder="Add new canonical area…"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                  />
                  <select
                    value={newRegion}
                    onChange={(e) => setNewRegion(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                    aria-label="Region"
                  >
                    <option value="">— region —</option>
                    {sortedRegions.map((r) => (
                      <option key={r.region_code} value={r.region_code}>
                        {r.region_code} — {r.region_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddArea}
                    disabled={
                      !newCanonical.trim() ||
                      !newRegion.trim() ||
                      actionInProgress?.startsWith("addArea::")
                    }
                    className="rounded-lg bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionInProgress?.startsWith("addArea::")
                      ? "Adding…"
                      : "Add"}
                  </button>
                </div>
                {dupNewArea ? (
                  <DupWarning
                    text={`This area already exists in: ${dupNewArea.region_code} ${dupNewArea.region_name ?? ""}`}
                  />
                ) : null}
              </div>

              {/* Legacy R-* cleanup widget — temporary maintenance UI.
                  First click runs a dry-run; the result lists candidate
                  regions, skipped ones, and reference counts. The actual
                  delete is gated behind a second confirm click. The
                  underlying route refuses to delete any region whose
                  legacy area names lack an active JOD-* replacement. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-amber-900">
                    Legacy R-* region cleanup (JOD)
                  </div>
                  {cleanupState.phase === "idle" ||
                  cleanupState.phase === "error" ? (
                    <button
                      type="button"
                      onClick={() => void runCleanupDryRun()}
                      className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100"
                    >
                      Cleanup old inactive R-* regions
                    </button>
                  ) : null}
                  {cleanupState.phase === "loading-dryrun" ? (
                    <span className="text-xs text-amber-900">
                      Running dry-run…
                    </span>
                  ) : null}
                  {cleanupState.phase === "dryrun-ready" ? (
                    (() => {
                      const safeCount =
                        cleanupState.summary.candidates.filter(
                          (c) => c.safe
                        ).length;
                      const skipCount =
                        cleanupState.summary.candidates.filter(
                          (c) => !c.safe
                        ).length;
                      // The force-delete escape hatch is offered only
                      // when the guarded path would otherwise be a
                      // no-op (0 safe candidates) and there's actually
                      // something to remove (>0 skipped).
                      const showForce = safeCount === 0 && skipCount > 0;
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCleanupState({ phase: "idle" })}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void runCleanupDelete()}
                            disabled={safeCount === 0}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Confirm DELETE {safeCount} region(s)
                          </button>
                          {showForce ? (
                            <button
                              type="button"
                              onClick={() => void runCleanupForceDelete()}
                              className="rounded-md border-2 border-red-700 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm hover:bg-red-100"
                              title="Bypass orphan-risk guard and delete legacy R-* catalog rows. provider_areas, tasks, and area_review_queue are not touched."
                            >
                              Force DELETE old inactive R-* regions ({skipCount})
                            </button>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}
                  {cleanupState.phase === "loading-delete" ? (
                    <span className="text-xs text-red-700">Deleting…</span>
                  ) : null}
                  {cleanupState.phase === "loading-force-delete" ? (
                    <span className="text-xs font-semibold text-red-800">
                      Force-deleting…
                    </span>
                  ) : null}
                  {cleanupState.phase === "done" ? (
                    <button
                      type="button"
                      onClick={() => setCleanupState({ phase: "idle" })}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Close
                    </button>
                  ) : null}
                </div>
                {cleanupState.phase === "error" ? (
                  <p
                    className="mt-2 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
                    role="alert"
                  >
                    {cleanupState.message}
                  </p>
                ) : null}
                {cleanupState.phase === "dryrun-ready" ||
                cleanupState.phase === "done" ? (
                  <div className="mt-2 space-y-2 text-xs text-amber-950">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
                      <span>
                        Found:{" "}
                        {cleanupState.summary.counts.regionsFound}
                      </span>
                      {cleanupState.phase === "done" ? (
                        <>
                          <span className="text-emerald-800">
                            Deleted:{" "}
                            {cleanupState.summary.counts.regionsDeleted} (
                            {cleanupState.summary.counts.areasDeleted} areas,{" "}
                            {cleanupState.summary.counts.aliasesDeleted}{" "}
                            aliases)
                          </span>
                          <span className="text-amber-900">
                            Skipped:{" "}
                            {cleanupState.summary.counts.regionsSkipped}
                          </span>
                        </>
                      ) : (
                        <span>
                          Safe to delete:{" "}
                          {
                            cleanupState.summary.candidates.filter(
                              (c) => c.safe
                            ).length
                          }{" "}
                          / Will be skipped:{" "}
                          {
                            cleanupState.summary.candidates.filter(
                              (c) => !c.safe
                            ).length
                          }
                        </span>
                      )}
                    </div>
                    {cleanupState.summary.candidates.length === 0 ? (
                      <p className="text-amber-900">
                        No legacy R-* inactive regions found. Nothing to do.
                      </p>
                    ) : (
                      <ul className="max-h-60 space-y-1 overflow-y-auto rounded border border-amber-200 bg-white p-2">
                        {cleanupState.summary.candidates.map((c) => (
                          <li
                            key={c.region_code}
                            className="flex flex-col gap-0.5 border-b border-amber-100 pb-1 last:border-b-0 last:pb-0"
                          >
                            <span className="font-medium">
                              {c.region_code}{" "}
                              <span className="text-slate-500">
                                — {c.region_name ?? "(no name)"}
                              </span>{" "}
                              <span
                                className={
                                  c.safe
                                    ? "text-emerald-700"
                                    : "text-red-700"
                                }
                              >
                                [{c.safe ? "SAFE" : "SKIP"}]
                              </span>{" "}
                              <span className="text-slate-500">
                                {c.legacy_area_count} areas /{" "}
                                {c.legacy_alias_count} aliases
                              </span>
                            </span>
                            {c.references.length > 0 ? (
                              <span className="text-[11px] text-slate-600">
                                refs:{" "}
                                {c.references
                                  .map(
                                    (r) =>
                                      `${r.table}/${r.legacy_name} × ${r.count}`
                                  )
                                  .join(" · ")}
                              </span>
                            ) : null}
                            {c.skip_reason ? (
                              <span className="text-[11px] text-red-700">
                                {c.skip_reason}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* Warnings surface ONLY after a completed run.
                        They list regions that were force-deleted
                        while leaving downstream references in place. */}
                    {cleanupState.phase === "done" &&
                    cleanupState.summary.warnings.length > 0 ? (
                      <div className="rounded border border-red-300 bg-red-50 p-2">
                        <p className="text-[11px] font-semibold text-red-800">
                          Force-deleted with bypass — references left in
                          place (provider_areas / tasks / area_review_queue
                          rows untouched):
                        </p>
                        <ul className="mt-1 space-y-1 text-[11px] text-red-900">
                          {cleanupState.summary.warnings.map((w) => (
                            <li key={w.region_code}>
                              <span className="font-medium">
                                {w.region_code}
                              </span>{" "}
                              — {w.region_name ?? "(no name)"} ·{" "}
                              {w.reference_counts
                                .map(
                                  (r) =>
                                    `${r.table}/${r.name} × ${r.count}`
                                )
                                .join(" · ") || "no refs"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Client-side search across regions, areas, and aliases. Empty
                  query → normal collapsed list; non-empty → filtered + auto-
                  expanded matching regions and alias panels. */}
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search area, alias, or region..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#003d20] focus:ring-2 focus:ring-[#003d20]/20"
                  aria-label="Search areas and aliases"
                />
                {searchQuery.trim() ? (
                  <span className="text-xs text-slate-500">
                    Showing{" "}
                    <span className="font-semibold text-slate-800">
                      {searchView.visibleRegions.length}
                    </span>{" "}
                    region{searchView.visibleRegions.length === 1 ? "" : "s"} /{" "}
                    <span className="font-semibold text-slate-800">
                      {searchView.matchedAreaCount}
                    </span>{" "}
                    area
                    {searchView.matchedAreaCount === 1 ? "" : "s"}
                    {searchView.visibleRegions.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="ml-2 text-[#003d20] underline-offset-2 hover:underline"
                      >
                        clear
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>

              {loading && (
                <p className="text-sm text-slate-500">Loading regions…</p>
              )}
              {loadError && !loading && (
                <p className="text-sm text-red-600">Error: {loadError}</p>
              )}
              {areas &&
                !loading &&
                !loadError &&
                searchView.visibleRegions.length === 0 && (
                  <p className="text-sm text-slate-500">
                    {searchQuery.trim()
                      ? "No regions, areas, or aliases match your search."
                      : "No regions yet."}
                  </p>
                )}

              {areas &&
                !loading &&
                !loadError &&
                searchView.visibleRegions.length > 0 && (
                <div className="space-y-3">
                  {searchView.visibleRegions.map((region) => {
                    const regionAreas =
                      searchView.visibleAreasByRegion.get(
                        region.region_code
                      ) ?? [];
                    const regionAliasCount = regionAreas.reduce(
                      (sum, a) => sum + a.aliases.length,
                      0
                    );
                    // While a search is active every visible region is
                    // auto-expanded so the admin can see why it matched
                    // without an extra click.
                    const isExpanded =
                      searchView.active ||
                      expandedRegions.has(region.region_code);
                    return (
                      <RegionCard
                        key={region.region_code}
                        region={region}
                        areaCount={regionAreas.length}
                        aliasCount={regionAliasCount}
                        isExpanded={isExpanded}
                        onToggle={() =>
                          setExpandedRegions((prev) => {
                            const next = new Set(prev);
                            if (next.has(region.region_code))
                              next.delete(region.region_code);
                            else next.add(region.region_code);
                            return next;
                          })
                        }
                        isEditing={editingRegionCode === region.region_code}
                        editDraft={editingRegionDraft}
                        editError={
                          editingRegionCode === region.region_code
                            ? editingRegionError
                            : null
                        }
                        editStatus={
                          editingRegionCode === region.region_code
                            ? editingRegionStatus
                            : { state: "idle" }
                        }
                        onEditDraftChange={setEditingRegionDraft}
                        onStartEdit={() => handleStartEditRegion(region)}
                        onCancelEdit={handleCancelEditRegion}
                        onSaveEdit={() => {
                          void handleSaveEditRegion(region);
                        }}
                        editInProgress={
                          editingRegionCode === region.region_code &&
                          editingRegionStatus.state === "saving"
                        }
                        onDisable={() => {
                          void handleDisableRegion(region);
                        }}
                        onReenable={() => {
                          void handleReenableRegion(region);
                        }}
                        disableStatus={
                          regionDisableStatusByCode[region.region_code] ?? {
                            state: "idle",
                          }
                        }
                      >
                        <RegionInlineAddArea
                          regionCode={region.region_code}
                          draft={perRegionAddDraft[region.region_code] ?? ""}
                          status={perRegionAddStatus[region.region_code]}
                          inProgress={
                            actionInProgress?.startsWith(
                              `addArea::`
                            ) ?? false
                          }
                          duplicate={findDuplicateArea(
                            perRegionAddDraft[region.region_code] ?? "",
                            allAreas,
                            null
                          )}
                          onDraftChange={(v) =>
                            setPerRegionAddDraft((prev) => ({
                              ...prev,
                              [region.region_code]: v,
                            }))
                          }
                          onSubmit={() =>
                            handleAddAreaInRegion(region.region_code)
                          }
                        />
                        {regionAreas.length === 0 ? (
                          <div className="px-3 py-3 text-xs italic text-slate-400">
                            {searchView.active
                              ? "No areas in this region match your search."
                              : "No canonical areas in this region yet."}
                          </div>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                            {regionAreas.map((area) => (
                              <li
                                key={area.area_code}
                                className="px-3 py-3"
                              >
                                <AreaSubRow
                                  area={area}
                                  editingAreaCode={editingAreaCode}
                                  editingAreaDraft={editingAreaDraft}
                                  onEditDraftChange={setEditingAreaDraft}
                                  onStartEdit={() => {
                                    setEditingAreaCode(area.area_code);
                                    setEditingAreaDraft(area.canonical_area);
                                  }}
                                  onCancelEdit={() => {
                                    setEditingAreaCode(null);
                                    setEditingAreaDraft("");
                                  }}
                                  onSaveEdit={() => handleSaveAreaEdit(area)}
                                  onToggle={() => handleToggleArea(area)}
                                  actionInProgress={actionInProgress}
                                  dupEditArea={
                                    editingAreaCode === area.area_code
                                      ? dupEditArea
                                      : null
                                  }
                                  aliasesExpanded={
                                    expandedAliasFor.has(area.area_code) ||
                                    searchView.forceAliasExpand.has(
                                      area.area_code
                                    )
                                  }
                                  toggleAliases={() =>
                                    setExpandedAliasFor((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(area.area_code))
                                        next.delete(area.area_code);
                                      else next.add(area.area_code);
                                      return next;
                                    })
                                  }
                                  editingAliasCode={editingAliasCode}
                                  editingAliasDraft={editingAliasDraft}
                                  onEditAliasDraftChange={setEditingAliasDraft}
                                  onStartEditAlias={(al) => {
                                    setEditingAliasCode(al.alias_code);
                                    setEditingAliasDraft(al.alias);
                                  }}
                                  onCancelEditAlias={() => {
                                    setEditingAliasCode(null);
                                    setEditingAliasDraft("");
                                  }}
                                  onSaveEditAlias={(al) =>
                                    handleSaveAliasEdit(al)
                                  }
                                  onDisableAlias={(al) => handleDisableAlias(al)}
                                  onReenableAlias={(al) =>
                                    handleReenableAlias(al)
                                  }
                                  dupEditAlias={dupEditAlias}
                                  addingAliasFor={addingAliasFor}
                                  newAliasDraft={newAliasDraft}
                                  onAliasDraftChange={setNewAliasDraft}
                                  onStartAddAlias={() =>
                                    handleStartAddAlias(area.area_code)
                                  }
                                  onCancelAddAlias={handleCancelAddAlias}
                                  onSaveNewAlias={() =>
                                    handleSaveNewAlias(area)
                                  }
                                  dupNewAlias={
                                    addingAliasFor === area.area_code
                                      ? dupNewAlias
                                      : null
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </RegionCard>
                    );
                  })}
                </div>
              )}

              {/* "Unmapped Provider Areas" diagnostics section was hidden
                  here as part of the JOD-25 migration cleanup. The
                  free-text rows it surfaced reflected the pre-rebuild
                  area space and were confusing to act on while provider
                  re-allocation is still pending its own phase. State,
                  fetch (unmapped_provider_areas in /api/admin/areas),
                  and the handlePromoteUnmapped / handlePromoteAsAlias
                  handlers are intentionally left in place so the
                  section can be restored in one diff if needed. */}
            </div>
          )}

          {activeTab === "pending" && (
            <div className="mt-4 space-y-3">
              {pendingAreaRequests.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No pending area requests.
                </p>
              ) : (
                <section className="overflow-hidden rounded-xl border border-slate-200">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">
                        Pending Approval ({pendingAreaRequests.length})
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Provider-submitted area strings awaiting admin
                        approval. Approving creates a new canonical area or
                        an alias of an existing one, then marks the queue
                        row resolved.
                      </p>
                    </div>
                  </header>
                  {/* Wrap the table only (not the header) so narrow
                      viewports get horizontal scroll on the 5-col table. */}
                  <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-white text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-2">Requested Area</th>
                        <th className="px-3 py-2">Submitter</th>
                        <th className="px-3 py-2">Region</th>
                        <th className="px-3 py-2">Approve as Area</th>
                        <th className="px-3 py-2">Approve as Alias of…</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingAreaRequests.map((req) => {
                        const selectedRegion =
                          pendingRegionByReview[req.review_id] ?? "";
                        const selectedCanonical =
                          pendingCanonicalByReview[req.review_id] ?? "";
                        const status = pendingStatusByReview[req.review_id];
                        const isSaving = status?.state === "saving";
                        const areaDup = findDuplicateArea(
                          req.raw_area,
                          allAreas,
                          null
                        );
                        const areaCrossRegionDup =
                          areaDup && areaDup.region_code !== selectedRegion;
                        const areaConfirmRequired =
                          areaCrossRegionDup &&
                          !pendingAreaConfirmedFor.has(req.review_id);
                        const aliasDup = findDuplicateAlias(
                          req.raw_area,
                          allAreas,
                          null
                        );
                        const aliasCrossRegionDup =
                          aliasDup &&
                          aliasDup.area.region_code !== selectedRegion;
                        const aliasConfirmRequired =
                          aliasCrossRegionDup &&
                          !pendingAliasConfirmedFor.has(req.review_id);
                        const canonicalsInRegion = selectedRegion
                          ? (areas ?? []).filter(
                              (a) =>
                                a.region_code === selectedRegion && a.active
                            )
                          : [];
                        return (
                          <tr
                            key={req.review_id}
                            className="border-b border-slate-100 align-top last:border-b-0"
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">
                                {req.raw_area}
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500">
                                <span className="rounded bg-slate-100 px-1.5 py-0.5">
                                  {req.source_type ?? "unknown"}
                                </span>
                                {" · "}
                                {req.occurrences} occurrence
                                {req.occurrences === 1 ? "" : "s"}
                              </div>
                              {areaDup ? (
                                <DupWarning
                                  text={`Same canonical exists in: ${areaDup.region_code} ${areaDup.region_name ?? ""}`}
                                />
                              ) : null}
                              {aliasDup ? (
                                <DupWarning
                                  text={`Same alias text exists under: ${aliasDup.area.canonical_area} / ${aliasDup.area.region_code}`}
                                />
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {req.submitter_name ? (
                                <div className="font-medium">
                                  {req.submitter_name}
                                </div>
                              ) : null}
                              {req.submitter_phone ? (
                                <div className="text-xs text-slate-500">
                                  {req.submitter_phone}
                                </div>
                              ) : null}
                              {!req.submitter_name && !req.submitter_phone ? (
                                <span className="text-xs text-slate-400">
                                  {req.source_ref ?? "—"}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={selectedRegion}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setPendingRegionByReview((prev) => ({
                                    ...prev,
                                    [req.review_id]: v,
                                  }));
                                  setPendingCanonicalByReview((prev) => ({
                                    ...prev,
                                    [req.review_id]: "",
                                  }));
                                  setPendingAreaConfirmedFor((prev) => {
                                    const next = new Set(prev);
                                    next.delete(req.review_id);
                                    return next;
                                  });
                                  setPendingAliasConfirmedFor((prev) => {
                                    const next = new Set(prev);
                                    next.delete(req.review_id);
                                    return next;
                                  });
                                }}
                                disabled={isSaving}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20"
                                aria-label={`Pick region for ${req.raw_area}`}
                              >
                                <option value="">— region —</option>
                                {sortedRegions.map((r) => (
                                  <option
                                    key={r.region_code}
                                    value={r.region_code}
                                  >
                                    {r.region_code} — {r.region_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApprovePendingAsArea(req);
                                }}
                                disabled={!selectedRegion || isSaving}
                                className="rounded bg-[#003d20] px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isSaving
                                  ? "Approving…"
                                  : areaConfirmRequired
                                    ? "Approve anyway"
                                    : "Approve as Area"}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <select
                                  value={selectedCanonical}
                                  onChange={(e) =>
                                    setPendingCanonicalByReview((prev) => ({
                                      ...prev,
                                      [req.review_id]: e.target.value,
                                    }))
                                  }
                                  disabled={!selectedRegion || isSaving}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label={`Pick canonical for ${req.raw_area}`}
                                >
                                  <option value="">
                                    {selectedRegion
                                      ? canonicalsInRegion.length === 0
                                        ? "(no canonicals in region)"
                                        : "— canonical —"
                                      : "(pick region first)"}
                                  </option>
                                  {canonicalsInRegion.map((a) => (
                                    <option
                                      key={a.area_code}
                                      value={a.canonical_area}
                                    >
                                      {a.canonical_area}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleApprovePendingAsAlias(req);
                                  }}
                                  disabled={
                                    !selectedRegion ||
                                    !selectedCanonical ||
                                    isSaving
                                  }
                                  className="rounded border border-[#003d20]/40 bg-white px-3 py-1 text-xs font-semibold text-[#003d20] transition hover:bg-[#003d20]/5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isSaving
                                    ? "Approving…"
                                    : aliasConfirmRequired
                                      ? "Approve anyway"
                                      : "Approve as Alias"}
                                </button>
                                {status?.message ? (
                                  <span
                                    className={
                                      status.state === "error"
                                        ? "rounded bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
                                        : "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800"
                                    }
                                    role={
                                      status.state === "error"
                                        ? "alert"
                                        : undefined
                                    }
                                  >
                                    {status.message}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── presentational helpers ────────────────────────────────────────────

function RegionCard({
  region,
  areaCount,
  aliasCount,
  isExpanded,
  onToggle,
  isEditing,
  editDraft,
  editError,
  editStatus,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  editInProgress,
  onDisable,
  onReenable,
  disableStatus,
  children,
}: {
  region: RegionRow;
  areaCount: number;
  aliasCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  isEditing: boolean;
  editDraft: string;
  editError: string | null;
  editStatus: RowStatus;
  onEditDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  editInProgress: boolean;
  // Phase A5
  onDisable: () => void;
  onReenable: () => void;
  disableStatus: RegionDisableStatus;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl ${
        region.active
          ? "border border-slate-200"
          : "border border-dashed border-slate-300 bg-slate-50/40"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 transition">
        <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold text-slate-700">
            {region.region_code}
          </span>
          {isEditing ? (
            <div className="flex flex-1 min-w-0 flex-wrap items-center gap-2">
              <input
                type="text"
                value={editDraft}
                onChange={(e) => onEditDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveEdit();
                  if (e.key === "Escape") onCancelEdit();
                }}
                className="flex-1 min-w-[8rem] rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20"
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => {
                  // stopPropagation is defensive — no ancestor handler
                  // currently swallows the click, but prevents future
                  // regressions if the surrounding card adds one.
                  e.stopPropagation();
                  onSaveEdit();
                }}
                disabled={editInProgress}
                className="rounded bg-[#003d20] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                {editInProgress ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelEdit();
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              >
                Cancel
              </button>
              {/* Inline status pill — surfaces success and API errors
                  right next to the Save button so feedback never lands
                  off-screen. */}
              {editStatus.state === "saved" && editStatus.message ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  {editStatus.message}
                </span>
              ) : null}
              {editStatus.state === "error" && editStatus.message ? (
                <span
                  className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
                  role="alert"
                >
                  {editStatus.message}
                </span>
              ) : null}
            </div>
          ) : (
            <>
              <span className="truncate text-sm font-semibold text-slate-900">
                {region.region_name ?? "—"}
              </span>
              <button
                type="button"
                onClick={onStartEdit}
                aria-label={`Edit ${region.region_code} region name`}
                title="Edit region name"
                className="inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 hover:text-[#003d20]"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              {!region.active ? (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  inactive
                </span>
              ) : null}
              {/* Phase A5: explicit disable / re-enable affordance. The
                  Disable path triggers a confirm + REGION_HAS_ACTIVE_AREAS
                  guard; the Re-enable path is restorative (no confirm). */}
              {region.active ? (
                <button
                  type="button"
                  onClick={onDisable}
                  disabled={disableStatus.state === "saving"}
                  aria-label={`Disable region ${region.region_code}`}
                  title="Disable region (hides its areas from public surfaces)"
                  className="inline-flex items-center gap-1 rounded border border-orange-300 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                  {disableStatus.state === "saving"
                    ? "Disabling…"
                    : "Disable"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onReenable}
                  disabled={disableStatus.state === "saving"}
                  aria-label={`Re-enable region ${region.region_code}`}
                  title="Re-enable region"
                  className="inline-flex items-center gap-1 rounded border border-emerald-300 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  {disableStatus.state === "saving"
                    ? "Re-enabling…"
                    : "Re-enable"}
                </button>
              )}
              {disableStatus.state === "saved" && disableStatus.message ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  {disableStatus.message}
                </span>
              ) : null}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded
              ? `Collapse ${region.region_code}`
              : `Expand ${region.region_code}`
          }
          className="flex shrink-0 items-center gap-3 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
        >
          <span>
            <span className="font-semibold text-slate-800">{areaCount}</span>{" "}
            area{areaCount === 1 ? "" : "s"}
          </span>
          <span>
            <span className="font-semibold text-slate-800">{aliasCount}</span>{" "}
            alias{aliasCount === 1 ? "" : "es"}
          </span>
          {/* Provider density — Phase 3. The two counts come from
              GET /api/admin/areas. They're rendered as muted text so the
              header doesn't get visually busier; the verified count is
              also a small emerald pill so admins can spot supply gaps. */}
          {typeof region.provider_count === "number" ? (
            <span>
              <span
                className={`font-semibold ${
                  region.provider_count > 0
                    ? "text-slate-800"
                    : "text-slate-400"
                }`}
              >
                {region.provider_count}
              </span>{" "}
              provider{region.provider_count === 1 ? "" : "s"}
            </span>
          ) : null}
          {typeof region.verified_provider_count === "number" ? (
            <span
              title="Verified = OTP valid within 30 days + active approved category + not under review."
              className={
                region.verified_provider_count > 0
                  ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800"
                  : "text-slate-400"
              }
            >
              <span className="font-semibold">
                {region.verified_provider_count}
              </span>{" "}
              verified
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 text-slate-400 transition-transform ${
              isExpanded ? "rotate-180" : "rotate-0"
            }`}
          />
        </button>
      </div>
      {editError ? (
        <p className="mx-3 mb-2 rounded bg-red-50 px-2 py-1 text-[11px] leading-tight text-red-700">
          {editError}
        </p>
      ) : null}
      {/* Phase A5: surface REGION_HAS_ACTIVE_AREAS inline with the
          blocking child-area list. The card auto-expands when this
          fires so the listed areas can be acted on without scrolling. */}
      {disableStatus.state === "error" && disableStatus.message ? (
        <div className="mx-3 mb-2 rounded border border-orange-200 bg-orange-50 px-2 py-2 text-[11px] leading-tight text-orange-800">
          <p className="font-semibold" role="alert">
            {disableStatus.message}
          </p>
          {disableStatus.blockedActiveAreas &&
          disableStatus.blockedActiveAreas.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {disableStatus.blockedActiveAreas.map((a) => (
                <li key={a.area_code}>
                  <span className="font-mono text-[10px] text-orange-700">
                    {a.area_code}
                  </span>{" "}
                  <span className="text-orange-900">{a.canonical_area}</span>
                </li>
              ))}
              {typeof disableStatus.blockedActiveAreaCount === "number" &&
              disableStatus.blockedActiveAreaCount >
                disableStatus.blockedActiveAreas.length ? (
                <li className="italic text-orange-700">
                  +{" "}
                  {disableStatus.blockedActiveAreaCount -
                    disableStatus.blockedActiveAreas.length}{" "}
                  more …
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      {isExpanded ? (
        <div className="border-t border-slate-200 bg-slate-50/50">{children}</div>
      ) : null}
    </div>
  );
}

function AreaSubRow(props: {
  area: AreaRow;
  editingAreaCode: string | null;
  editingAreaDraft: string;
  onEditDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggle: () => void;
  actionInProgress: string | null;
  dupEditArea: AreaRow | null;
  aliasesExpanded: boolean;
  toggleAliases: () => void;
  editingAliasCode: string | null;
  editingAliasDraft: string;
  onEditAliasDraftChange: (v: string) => void;
  onStartEditAlias: (al: AliasRow) => void;
  onCancelEditAlias: () => void;
  onSaveEditAlias: (al: AliasRow) => void;
  onDisableAlias: (al: AliasRow) => void;
  onReenableAlias: (al: AliasRow) => void;
  dupEditAlias: { area: AreaRow; alias: AliasRow } | null;
  addingAliasFor: string | null;
  newAliasDraft: string;
  onAliasDraftChange: (v: string) => void;
  onStartAddAlias: () => void;
  onCancelAddAlias: () => void;
  onSaveNewAlias: () => void;
  dupNewAlias: { area: AreaRow; alias: AliasRow } | null;
}) {
  const {
    area,
    editingAreaCode,
    editingAreaDraft,
    onEditDraftChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onToggle,
    actionInProgress,
    dupEditArea,
    aliasesExpanded,
    toggleAliases,
    editingAliasCode,
    editingAliasDraft,
    onEditAliasDraftChange,
    onStartEditAlias,
    onCancelEditAlias,
    onSaveEditAlias,
    onDisableAlias,
    onReenableAlias,
    dupEditAlias,
    addingAliasFor,
    newAliasDraft,
    onAliasDraftChange,
    onStartAddAlias,
    onCancelAddAlias,
    onSaveNewAlias,
    dupNewAlias,
  } = props;

  const isEditing = editingAreaCode === area.area_code;
  const toggleKey = `toggleArea::${area.area_code}`;
  const editKey = `editArea::${area.area_code}`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingAreaDraft}
                  onChange={(e) => onEditDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveEdit();
                    if (e.key === "Escape") onCancelEdit();
                  }}
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={onSaveEdit}
                  disabled={actionInProgress === editKey}
                  className="rounded bg-[#003d20] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {actionInProgress === editKey ? "…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                >
                  Cancel
                </button>
              </div>
              {dupEditArea ? (
                <DupWarning
                  text={`This area already exists in: ${dupEditArea.region_code} ${dupEditArea.region_name ?? ""}`}
                />
              ) : null}
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span
                className={`text-sm font-medium ${
                  area.active ? "text-slate-800" : "text-slate-400 line-through"
                }`}
              >
                {area.canonical_area}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {area.area_code}
              </span>
              {area.active ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  active
                </span>
              ) : (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  inactive
                </span>
              )}
              {/* When the area has 0 aliases, surface the add affordance
                  directly on the toggle so admins don't need to expand →
                  scan empty list → click "+ Add". Clicking the button
                  expands the panel AND kicks off the add flow. */}
              {area.aliases.length === 0 && !aliasesExpanded ? (
                <button
                  type="button"
                  onClick={() => {
                    toggleAliases();
                    onStartAddAlias();
                  }}
                  className="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-[#003d20]/40 bg-white px-2 py-0.5 text-[11px] font-medium text-[#003d20] hover:bg-[#003d20]/5"
                >
                  + Add alias / local name
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggleAliases}
                  aria-expanded={aliasesExpanded}
                  className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-[#003d20]"
                >
                  {aliasesExpanded ? "Hide" : "View"} aliases / local names (
                  {area.aliases.length})
                </button>
              )}
            </div>
          )}
        </div>
        <div className="inline-flex flex-wrap justify-end gap-2">
          {!isEditing && (
            <button
              type="button"
              onClick={onStartEdit}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            disabled={actionInProgress === toggleKey}
            className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
              area.active
                ? "border-orange-300 text-orange-700 hover:bg-orange-50"
                : "border-[#003d20]/40 text-[#003d20] hover:bg-green-50"
            }`}
          >
            {actionInProgress === toggleKey
              ? "…"
              : area.active
                ? "Disable"
                : "Enable"}
          </button>
        </div>
      </div>

      {aliasesExpanded ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {area.aliases.length === 0 && (
            <span className="text-xs italic text-slate-400">
              no aliases yet
            </span>
          )}
          {area.aliases.map((al) => {
            const isEditingAlias = editingAliasCode === al.alias_code;
            const editAliasKey = `editAlias::${al.alias_code}`;
            const disableAliasKey = `disableAlias::${al.alias_code}`;
            const reenableAliasKey = `reenableAlias::${al.alias_code}`;
            if (isEditingAlias) {
              return (
                <div
                  key={al.alias_code}
                  className="flex flex-col gap-1"
                >
                  <div className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5">
                    <input
                      type="text"
                      value={editingAliasDraft}
                      onChange={(e) =>
                        onEditAliasDraftChange(e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onSaveEditAlias(al);
                        if (e.key === "Escape") onCancelEditAlias();
                      }}
                      className="w-40 bg-transparent text-xs text-slate-900 outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => onSaveEditAlias(al)}
                      disabled={actionInProgress === editAliasKey}
                      className="rounded bg-[#003d20] px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      {actionInProgress === editAliasKey ? "…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelEditAlias}
                      className="text-[10px] text-slate-500 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                  {dupEditAlias ? (
                    <DupWarning
                      text={`This alias already exists under: ${dupEditAlias.area.canonical_area} / ${dupEditAlias.area.region_code} ${dupEditAlias.area.region_name ?? ""}`}
                    />
                  ) : null}
                </div>
              );
            }
            // Phase A4: inactive aliases render with a dashed border,
            // muted + struck text, a small "inactive" badge, and a
            // Re-enable button in place of the Disable X. Edit stays
            // available so an admin can fix the text before re-enabling.
            if (!al.active) {
              return (
                <span
                  key={al.alias_code}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-400"
                  title={al.alias_code}
                >
                  <span className="line-through">{al.alias}</span>
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
                    inactive
                  </span>
                  <button
                    type="button"
                    onClick={() => onStartEditAlias(al)}
                    aria-label={`Edit alias ${al.alias}`}
                    title="Edit"
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-[#003d20]"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReenableAlias(al)}
                    disabled={actionInProgress === reenableAliasKey}
                    aria-label={`Re-enable alias ${al.alias}`}
                    title="Re-enable (active=true)"
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </span>
              );
            }
            return (
              <span
                key={al.alias_code}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
                title={al.alias_code}
              >
                {al.alias}
                <button
                  type="button"
                  onClick={() => onStartEditAlias(al)}
                  aria-label={`Edit alias ${al.alias}`}
                  title="Edit"
                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-[#003d20]"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onDisableAlias(al)}
                  disabled={actionInProgress === disableAliasKey}
                  aria-label={`Disable alias ${al.alias}`}
                  title="Disable (active=false)"
                  className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-orange-100 hover:text-orange-700 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          {addingAliasFor === area.area_code ? (
            <div className="flex flex-col gap-1">
              <div className="inline-flex items-center gap-1 rounded-full border border-[#003d20]/40 bg-white px-2 py-0.5">
                <input
                  type="text"
                  value={newAliasDraft}
                  onChange={(e) => onAliasDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveNewAlias();
                    if (e.key === "Escape") onCancelAddAlias();
                  }}
                  placeholder="alias text"
                  maxLength={80}
                  autoFocus
                  className="w-40 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={onSaveNewAlias}
                  disabled={
                    !newAliasDraft.trim() ||
                    actionInProgress === `addAlias::${area.area_code}`
                  }
                  className="rounded bg-[#003d20] px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                >
                  {actionInProgress === `addAlias::${area.area_code}`
                    ? "…"
                    : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelAddAlias}
                  className="text-[10px] text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
              {dupNewAlias ? (
                <DupWarning
                  text={`This alias already exists under: ${dupNewAlias.area.canonical_area} / ${dupNewAlias.area.region_code} ${dupNewAlias.area.region_name ?? ""}`}
                />
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={onStartAddAlias}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#003d20]/40 bg-white px-2 py-0.5 text-xs font-medium text-[#003d20] hover:bg-[#003d20]/5"
            >
              + Add alias / local name
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RegionInlineAddArea({
  regionCode,
  draft,
  status,
  inProgress,
  duplicate,
  onDraftChange,
  onSubmit,
}: {
  regionCode: string;
  draft: string;
  status: RowStatus | undefined;
  inProgress: boolean;
  duplicate: AreaRow | null;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="border-b border-slate-200 bg-white/60 px-3 py-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
        <input
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder={`Add area in ${regionCode}…`}
          className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!draft.trim() || inProgress}
          className="inline-flex shrink-0 items-center justify-center rounded bg-[#003d20] px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {inProgress && status?.state === "saving" ? "Adding…" : "Add"}
        </button>
        {status?.message ? (
          <span
            className={
              status.state === "error"
                ? "text-[11px] text-rose-700"
                : "text-[11px] text-emerald-700"
            }
          >
            {status.message}
          </span>
        ) : null}
      </div>
      {duplicate ? (
        <DupWarning
          text={`Area "${duplicate.canonical_area}" already exists in: ${duplicate.region_code} ${duplicate.region_name ?? ""}`}
        />
      ) : null}
    </div>
  );
}

function DupWarning({ text }: { text: string }) {
  return (
    <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] leading-tight text-amber-800">
      {text}
    </p>
  );
}
