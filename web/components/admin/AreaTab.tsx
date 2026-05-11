"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, X } from "lucide-react";

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

type LoadResponse = {
  ok?: boolean;
  regions?: RegionRow[];
  areas?: AreaRow[];
  unmapped_provider_areas?: UnmappedProviderArea[];
  error?: string;
};

type ActiveTab = "approved" | "pending";

type RowStatus = {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
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

// Case-insensitive exact match. Returns the first area whose
// canonical_area matches `text` (excluding `excludeAreaCode`), or null.
function findDuplicateArea(
  text: string,
  areas: AreaRow[],
  excludeAreaCode: string | null
): AreaRow | null {
  const n = text.trim().toLowerCase();
  if (!n) return null;
  for (const a of areas) {
    if (a.area_code === excludeAreaCode) continue;
    if (a.canonical_area.trim().toLowerCase() === n) return a;
  }
  return null;
}

// Returns the first (area, alias) pair whose alias text matches
// (excluding `excludeAliasCode`), or null.
function findDuplicateAlias(
  text: string,
  areas: AreaRow[],
  excludeAliasCode: string | null
): { area: AreaRow; alias: AliasRow } | null {
  const n = text.trim().toLowerCase();
  if (!n) return null;
  for (const a of areas) {
    for (const al of a.aliases) {
      if (al.alias_code === excludeAliasCode) continue;
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
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Add-area form (top-level)
  const [newCanonical, setNewCanonical] = useState("");
  const [newRegion, setNewRegion] = useState("");
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

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "approved") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch("/api/admin/areas", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: LoadResponse) => {
        if (cancelled) return;
        if (res?.ok && Array.isArray(res.areas) && Array.isArray(res.regions)) {
          setAreas(res.areas);
          setRegions(res.regions);
          setUnmappedProviderAreas(
            Array.isArray(res.unmapped_provider_areas)
              ? res.unmapped_provider_areas
              : []
          );
        } else {
          setLoadError(res?.error || "Failed to load areas");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, refreshKey]);

  const refresh = () => setRefreshKey((p) => p + 1);

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
    const area_code = nextCode(allAreas.map((a) => a.area_code), "A-");
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

              {/* Diagnostics — provider_areas.area values not mapped to any
                  active service_region_areas canonical. Read-only for now;
                  next step is a one-click "add as area / alias" affordance
                  per row. Section is hidden while a search filter is
                  active (it's dataset-wide and would just clutter focused
                  results). */}
              {!searchView.active && unmappedProviderAreas.length > 0 ? (
                <section className="mt-6 overflow-hidden rounded-xl border border-slate-200">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">
                        Unmapped Provider Areas
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Provider areas that don't resolve to any region's
                        canonical area. Top {unmappedProviderAreas.length}{" "}
                        by provider count.
                      </p>
                    </div>
                  </header>
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-white text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-2">Provider Area</th>
                        <th className="px-3 py-2">Providers</th>
                        <th className="px-3 py-2">Region</th>
                        <th className="px-3 py-2">Add as Area</th>
                        <th className="px-3 py-2">Add as Alias of…</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmappedProviderAreas.map((row) => {
                        const selectedRegion =
                          promoteRegionByArea[row.area] ?? "";
                        const selectedCanonical =
                          promoteCanonicalByArea[row.area] ?? "";
                        const status = promoteStatusByArea[row.area];
                        const isSaving = status?.state === "saving";
                        // Cross-region area duplicate (informational; same-
                        // region duplicate is blocked by the API).
                        const areaDup = findDuplicateArea(
                          row.area,
                          allAreas,
                          null
                        );
                        const areaCrossRegionDup =
                          areaDup && areaDup.region_code !== selectedRegion;
                        const areaConfirmRequired =
                          areaCrossRegionDup &&
                          !promoteAreaConfirmedFor.has(row.area);
                        // Cross-region alias duplicate (informational).
                        const aliasDup = findDuplicateAlias(
                          row.area,
                          allAreas,
                          null
                        );
                        const aliasCrossRegionDup =
                          aliasDup &&
                          aliasDup.area.region_code !== selectedRegion;
                        const aliasConfirmRequired =
                          aliasCrossRegionDup &&
                          !promoteAliasConfirmedFor.has(row.area);
                        // Canonicals available for the selected region —
                        // alias creation requires a (canonical, region)
                        // pair that already exists in service_region_areas.
                        const canonicalsInRegion = selectedRegion
                          ? (areas ?? []).filter(
                              (a) =>
                                a.region_code === selectedRegion && a.active
                            )
                          : [];
                        return (
                          <tr
                            key={row.area}
                            className="border-b border-slate-100 align-top last:border-b-0"
                          >
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {row.area}
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
                              <span className="font-semibold">
                                {row.provider_count}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={selectedRegion}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setPromoteRegionByArea((prev) => ({
                                    ...prev,
                                    [row.area]: v,
                                  }));
                                  // Region change invalidates the canonical
                                  // selection (canonicals are region-scoped).
                                  setPromoteCanonicalByArea((prev) => ({
                                    ...prev,
                                    [row.area]: "",
                                  }));
                                  // Changing region also resets any pending
                                  // cross-region confirmation flags.
                                  setPromoteAreaConfirmedFor((prev) => {
                                    const next = new Set(prev);
                                    next.delete(row.area);
                                    return next;
                                  });
                                  setPromoteAliasConfirmedFor((prev) => {
                                    const next = new Set(prev);
                                    next.delete(row.area);
                                    return next;
                                  });
                                }}
                                disabled={isSaving}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20"
                                aria-label={`Pick region for ${row.area}`}
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
                                  handlePromoteUnmapped(row.area);
                                }}
                                disabled={!selectedRegion || isSaving}
                                className="rounded bg-[#003d20] px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isSaving
                                  ? "Adding…"
                                  : areaConfirmRequired
                                    ? "Add anyway"
                                    : "Add as Area"}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <select
                                  value={selectedCanonical}
                                  onChange={(e) =>
                                    setPromoteCanonicalByArea((prev) => ({
                                      ...prev,
                                      [row.area]: e.target.value,
                                    }))
                                  }
                                  disabled={!selectedRegion || isSaving}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#003d20] focus:ring-1 focus:ring-[#003d20]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label={`Pick canonical for ${row.area}`}
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
                                    handlePromoteAsAlias(row.area);
                                  }}
                                  disabled={
                                    !selectedRegion ||
                                    !selectedCanonical ||
                                    isSaving
                                  }
                                  className="rounded border border-[#003d20]/40 bg-white px-3 py-1 text-xs font-semibold text-[#003d20] transition hover:bg-[#003d20]/5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isSaving
                                    ? "Adding…"
                                    : aliasConfirmRequired
                                      ? "Add anyway"
                                      : "Add as Alias"}
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
                </section>
              ) : null}
            </div>
          )}

          {activeTab === "pending" && (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-slate-500">
                No pending area requests.
              </p>
              <p className="text-xs text-slate-400">
                Provider-submitted area requests are not wired yet; this tab
                is a placeholder for that future flow.
              </p>
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
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
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
