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

type LoadResponse = {
  ok?: boolean;
  regions?: RegionRow[];
  areas?: AreaRow[];
  error?: string;
};

type ActiveTab = "approved" | "pending";

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
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Add-area form
  const [newCanonical, setNewCanonical] = useState("");
  const [newRegion, setNewRegion] = useState("");

  // Expand state — top-level regions
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(
    new Set()
  );
  // Per-area aliases expanded
  const [expandedAliasFor, setExpandedAliasFor] = useState<Set<string>>(
    new Set()
  );

  // Inline rename state
  const [editingRegionCode, setEditingRegionCode] = useState<string | null>(
    null
  );
  const [editingRegionDraft, setEditingRegionDraft] = useState("");
  const [editingRegionError, setEditingRegionError] = useState<string | null>(
    null
  );
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
  };
  const handleCancelEditRegion = () => {
    setEditingRegionCode(null);
    setEditingRegionDraft("");
    setEditingRegionError(null);
  };
  const handleSaveEditRegion = (region: RegionRow) => {
    const newName = editingRegionDraft.trim();
    if (!newName) {
      setEditingRegionError("Region name cannot be blank.");
      return;
    }
    if (newName === (region.region_name ?? "")) {
      handleCancelEditRegion();
      return;
    }
    setEditingRegionError(null);
    void callAi(
      "PATCH",
      `editRegion::${region.region_code}`,
      {
        target: "region",
        region_code: region.region_code,
        region_name: newName,
      },
      () => {
        // Local state update — no full reload needed; region_code is the
        // immutable identifier so areas / aliases under it are unaffected.
        setRegions((prev) =>
          prev.map((r) =>
            r.region_code === region.region_code
              ? { ...r, region_name: newName }
              : r
          )
        );
        handleCancelEditRegion();
      }
    );
  };

  const handleAddArea = () => {
    const canonical = newCanonical.trim();
    const region_code = newRegion.trim();
    if (!canonical) {
      setActionError("Canonical area name is required.");
      return;
    }
    if (!region_code) {
      setActionError("Pick a region for the new area.");
      return;
    }
    const area_code = nextCode(
      allAreas.map((a) => a.area_code),
      "A-"
    );
    void callAi(
      "POST",
      `addArea::${canonical}`,
      {
        target: "area",
        area_code,
        canonical_area: canonical,
        region_code,
        active: true,
      },
      () => {
        setNewCanonical("");
        setNewRegion("");
        setExpandedRegions((prev) => {
          const next = new Set(prev);
          next.add(region_code);
          return next;
        });
        refresh();
      }
    );
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

              {loading && (
                <p className="text-sm text-slate-500">Loading regions…</p>
              )}
              {loadError && !loading && (
                <p className="text-sm text-red-600">Error: {loadError}</p>
              )}
              {areas &&
                !loading &&
                !loadError &&
                sortedRegions.length === 0 && (
                  <p className="text-sm text-slate-500">No regions yet.</p>
                )}

              {areas && !loading && !loadError && sortedRegions.length > 0 && (
                <div className="space-y-3">
                  {sortedRegions.map((region) => {
                    const regionAreas =
                      areasByRegion.get(region.region_code) ?? [];
                    const regionAliasCount = regionAreas.reduce(
                      (sum, a) => sum + a.aliases.length,
                      0
                    );
                    const isExpanded = expandedRegions.has(region.region_code);
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
                        onEditDraftChange={setEditingRegionDraft}
                        onStartEdit={() => handleStartEditRegion(region)}
                        onCancelEdit={handleCancelEditRegion}
                        onSaveEdit={() => handleSaveEditRegion(region)}
                        editInProgress={
                          actionInProgress ===
                          `editRegion::${region.region_code}`
                        }
                      >
                        {regionAreas.length === 0 ? (
                          <div className="px-3 py-3 text-xs italic text-slate-400">
                            No canonical areas in this region yet.
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
                                  aliasesExpanded={expandedAliasFor.has(
                                    area.area_code
                                  )}
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
                onClick={onSaveEdit}
                disabled={editInProgress}
                className="rounded bg-[#003d20] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                {editInProgress ? "…" : "Save"}
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              >
                Cancel
              </button>
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
              <button
                type="button"
                onClick={toggleAliases}
                aria-expanded={aliasesExpanded}
                className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-[#003d20]"
              >
                {aliasesExpanded ? "Hide" : "View"} aliases / local names (
                {area.aliases.length})
              </button>
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

function DupWarning({ text }: { text: string }) {
  return (
    <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] leading-tight text-amber-800">
      {text}
    </p>
  );
}
