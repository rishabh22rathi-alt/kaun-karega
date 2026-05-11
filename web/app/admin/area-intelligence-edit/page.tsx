"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Sandbox-only admin editor for Area Intelligence data. Talks to
// /api/admin/area-intelligence (GET/PATCH/POST). No DELETE button —
// deactivate via active=false. Does not touch live matching, provider
// registration, homepage search, /api/find-provider, /api/areas, or
// existing area_aliases logic.

type Region = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
  notes: string | null;
};

type Area = {
  area_code: string;
  canonical_area: string;
  region_code: string;
  active: boolean | null;
  notes: string | null;
};

type Alias = {
  alias_code: string;
  alias: string;
  canonical_area: string;
  region_code: string;
  active: boolean | null;
  notes: string | null;
};

type LoadResponse = {
  ok?: boolean;
  regions?: Region[];
  areas?: Area[];
  aliases?: Alias[];
  error?: string;
};

type RegionDraft = Region;
type AreaDraft = Area;
type AliasDraft = Alias;
type RowStatus = { state: "idle" | "saving" | "saved" | "error"; message?: string };

export default function AreaIntelligenceEditPage() {
  const [regionDrafts, setRegionDrafts] = useState<Record<string, RegionDraft>>(
    {}
  );
  const [regionBaseline, setRegionBaseline] = useState<
    Record<string, RegionDraft>
  >({});
  const [regionStatus, setRegionStatus] = useState<Record<string, RowStatus>>(
    {}
  );
  const [areaDrafts, setAreaDrafts] = useState<Record<string, AreaDraft>>({});
  const [areaBaseline, setAreaBaseline] = useState<Record<string, AreaDraft>>(
    {}
  );
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, AliasDraft>>(
    {}
  );
  const [aliasBaseline, setAliasBaseline] = useState<Record<string, AliasDraft>>(
    {}
  );
  const [areaStatus, setAreaStatus] = useState<Record<string, RowStatus>>({});
  const [aliasStatus, setAliasStatus] = useState<Record<string, RowStatus>>({});

  // Region dropdown source — always the current drafts, sorted by code.
  const regions: Region[] = useMemo(
    () =>
      Object.values(regionDrafts).sort((a, b) =>
        a.region_code.localeCompare(b.region_code)
      ),
    [regionDrafts]
  );

  // Dependency counts derived from the CURRENT drafts (not the baseline), so
  // toggling a child's active flag locally is reflected in the parent's
  // warning state before save. Counts are intentionally cheap — full scan
  // of two small in-memory dicts; tables here cap at thousands of rows.
  type RegionStats = {
    areas: number;
    aliases: number;
    activeAreas: number;
    activeAliases: number;
  };
  const regionStats: Map<string, RegionStats> = useMemo(() => {
    const m = new Map<string, RegionStats>();
    const bump = (code: string): RegionStats => {
      const cur = m.get(code) ?? {
        areas: 0,
        aliases: 0,
        activeAreas: 0,
        activeAliases: 0,
      };
      m.set(code, cur);
      return cur;
    };
    for (const a of Object.values(areaDrafts)) {
      const s = bump(a.region_code);
      s.areas += 1;
      if (a.active) s.activeAreas += 1;
    }
    for (const al of Object.values(aliasDrafts)) {
      const s = bump(al.region_code);
      s.aliases += 1;
      if (al.active) s.activeAliases += 1;
    }
    return m;
  }, [areaDrafts, aliasDrafts]);

  // Per (canonical_area, region_code) pair, count linked aliases. Key uses
  // lower-cased canonical so casing drift in stored rows doesn't split the
  // bucket; mirrors the resolver / validator normalization.
  type AreaStats = { total: number; active: number };
  const areaAliasStats: Map<string, AreaStats> = useMemo(() => {
    const m = new Map<string, AreaStats>();
    for (const al of Object.values(aliasDrafts)) {
      const key = `${al.canonical_area.trim().toLowerCase()}||${al.region_code}`;
      const cur = m.get(key) ?? { total: 0, active: 0 };
      cur.total += 1;
      if (al.active) cur.active += 1;
      m.set(key, cur);
    }
    return m;
  }, [aliasDrafts]);
  const areaAliasKey = (canonical: string, region: string) =>
    `${canonical.trim().toLowerCase()}||${region}`;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // New-alias / new-region / new-area form state
  const [newAlias, setNewAlias] = useState({
    alias_code: "",
    alias: "",
    canonical_area: "",
    region_code: "",
    notes: "",
  });
  const [createStatus, setCreateStatus] = useState<RowStatus>({ state: "idle" });
  const [newRegion, setNewRegion] = useState({
    region_code: "",
    region_name: "",
    notes: "",
  });
  const [createRegionStatus, setCreateRegionStatus] = useState<RowStatus>({
    state: "idle",
  });
  const [newArea, setNewArea] = useState({
    area_code: "",
    canonical_area: "",
    region_code: "",
    notes: "",
  });
  const [createAreaStatus, setCreateAreaStatus] = useState<RowStatus>({
    state: "idle",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        cache: "no-store",
      });
      const data = (await res.json()) as LoadResponse;
      if (!res.ok || !data?.ok) {
        setLoadError(data?.error || "Failed to load");
        return;
      }
      const rMap = Object.fromEntries(
        (data.regions ?? []).map((r) => [r.region_code, r])
      );
      const aMap = Object.fromEntries(
        (data.areas ?? []).map((a) => [a.area_code, a])
      );
      const alMap = Object.fromEntries(
        (data.aliases ?? []).map((a) => [a.alias_code, a])
      );
      setRegionDrafts(rMap);
      setRegionBaseline(rMap);
      setAreaDrafts(aMap);
      setAreaBaseline(aMap);
      setAliasDrafts(alMap);
      setAliasBaseline(alMap);
      setRegionStatus({});
      setAreaStatus({});
      setAliasStatus({});
    } catch (e: any) {
      setLoadError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter inputs
  const [areaFilter, setAreaFilter] = useState("");
  const [aliasFilter, setAliasFilter] = useState("");

  const areaRows = useMemo(() => {
    const q = areaFilter.trim().toLowerCase();
    const rows = Object.values(areaDrafts);
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.area_code.toLowerCase().includes(q) ||
        r.canonical_area.toLowerCase().includes(q) ||
        r.region_code.toLowerCase().includes(q)
    );
  }, [areaDrafts, areaFilter]);

  const aliasRows = useMemo(() => {
    const q = aliasFilter.trim().toLowerCase();
    const rows = Object.values(aliasDrafts);
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.alias_code.toLowerCase().includes(q) ||
        r.alias.toLowerCase().includes(q) ||
        r.canonical_area.toLowerCase().includes(q) ||
        r.region_code.toLowerCase().includes(q)
    );
  }, [aliasDrafts, aliasFilter]);

  // ── region row mutations ──
  const updateRegionDraft = (code: string, patch: Partial<RegionDraft>) => {
    setRegionDrafts((prev) => ({
      ...prev,
      [code]: { ...prev[code], ...patch },
    }));
    setRegionStatus((prev) => ({ ...prev, [code]: { state: "idle" } }));
  };

  const saveRegionRow = async (code: string) => {
    const draft = regionDrafts[code];
    const baseline = regionBaseline[code];
    if (!draft || !baseline) return;
    const diff: Record<string, unknown> = {};
    if ((draft.region_name ?? "") !== (baseline.region_name ?? ""))
      diff.region_name = draft.region_name ?? "";
    if (Boolean(draft.active) !== Boolean(baseline.active))
      diff.active = Boolean(draft.active);
    if ((draft.notes ?? "") !== (baseline.notes ?? ""))
      diff.notes = draft.notes ?? "";

    if (Object.keys(diff).length === 0) {
      setRegionStatus((p) => ({
        ...p,
        [code]: { state: "saved", message: "No changes" },
      }));
      return;
    }

    setRegionStatus((p) => ({ ...p, [code]: { state: "saving" } }));
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "region",
          region_code: code,
          ...diff,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        region?: Region;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data?.ok || !data.region) {
        setRegionStatus((p) => ({
          ...p,
          [code]: {
            state: "error",
            message: data?.detail || data?.error || `HTTP ${res.status}`,
          },
        }));
        return;
      }
      setRegionDrafts((p) => ({ ...p, [code]: data.region! }));
      setRegionBaseline((p) => ({ ...p, [code]: data.region! }));
      setRegionStatus((p) => ({
        ...p,
        [code]: { state: "saved", message: "Saved" },
      }));
    } catch (e: any) {
      setRegionStatus((p) => ({
        ...p,
        [code]: { state: "error", message: e?.message || "Network error" },
      }));
    }
  };

  const createRegion = async () => {
    const { region_code, region_name, notes } = newRegion;
    if (!region_code.trim() || !region_name.trim()) {
      setCreateRegionStatus({
        state: "error",
        message: "region_code and region_name are required.",
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
          region_code: region_code.trim(),
          region_name: region_name.trim(),
          active: true,
          notes,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        region?: Region;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data?.ok || !data.region) {
        setCreateRegionStatus({
          state: "error",
          message: data?.detail || data?.error || `HTTP ${res.status}`,
        });
        return;
      }
      const created = data.region;
      setRegionDrafts((p) => ({ ...p, [created.region_code]: created }));
      setRegionBaseline((p) => ({ ...p, [created.region_code]: created }));
      setCreateRegionStatus({
        state: "saved",
        message: `Created ${created.region_code}.`,
      });
      setNewRegion({ region_code: "", region_name: "", notes: "" });
    } catch (e: any) {
      setCreateRegionStatus({
        state: "error",
        message: e?.message || "Network error",
      });
    }
  };

  const createArea = async () => {
    const { area_code, canonical_area, region_code, notes } = newArea;
    if (!area_code.trim() || !canonical_area.trim() || !region_code.trim()) {
      setCreateAreaStatus({
        state: "error",
        message: "area_code, canonical_area, and region_code are required.",
      });
      return;
    }
    setCreateAreaStatus({ state: "saving" });
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "area",
          area_code: area_code.trim(),
          canonical_area: canonical_area.trim(),
          region_code: region_code.trim(),
          active: true,
          notes,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        area?: Area;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data?.ok || !data.area) {
        setCreateAreaStatus({
          state: "error",
          message: data?.detail || data?.error || `HTTP ${res.status}`,
        });
        return;
      }
      const created = data.area;
      setAreaDrafts((p) => ({ ...p, [created.area_code]: created }));
      setAreaBaseline((p) => ({ ...p, [created.area_code]: created }));
      setCreateAreaStatus({
        state: "saved",
        message: `Created ${created.area_code}.`,
      });
      setNewArea({
        area_code: "",
        canonical_area: "",
        region_code: "",
        notes: "",
      });
    } catch (e: any) {
      setCreateAreaStatus({
        state: "error",
        message: e?.message || "Network error",
      });
    }
  };

  // ── area row mutations ──
  const updateAreaDraft = (code: string, patch: Partial<AreaDraft>) => {
    setAreaDrafts((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
    setAreaStatus((prev) => ({ ...prev, [code]: { state: "idle" } }));
  };

  const saveAreaRow = async (code: string) => {
    const draft = areaDrafts[code];
    const baseline = areaBaseline[code];
    if (!draft || !baseline) return;
    const diff: Record<string, unknown> = {};
    if (draft.canonical_area !== baseline.canonical_area)
      diff.canonical_area = draft.canonical_area;
    if (draft.region_code !== baseline.region_code)
      diff.region_code = draft.region_code;
    if (Boolean(draft.active) !== Boolean(baseline.active))
      diff.active = Boolean(draft.active);
    if ((draft.notes ?? "") !== (baseline.notes ?? ""))
      diff.notes = draft.notes ?? "";

    if (Object.keys(diff).length === 0) {
      setAreaStatus((p) => ({
        ...p,
        [code]: { state: "saved", message: "No changes" },
      }));
      return;
    }

    setAreaStatus((p) => ({ ...p, [code]: { state: "saving" } }));
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "area", area_code: code, ...diff }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        area?: Area;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data?.ok || !data.area) {
        setAreaStatus((p) => ({
          ...p,
          [code]: {
            state: "error",
            message: data?.detail || data?.error || `HTTP ${res.status}`,
          },
        }));
        return;
      }
      setAreaDrafts((p) => ({ ...p, [code]: data.area! }));
      setAreaBaseline((p) => ({ ...p, [code]: data.area! }));
      setAreaStatus((p) => ({
        ...p,
        [code]: { state: "saved", message: "Saved" },
      }));
    } catch (e: any) {
      setAreaStatus((p) => ({
        ...p,
        [code]: { state: "error", message: e?.message || "Network error" },
      }));
    }
  };

  // ── alias row mutations ──
  const updateAliasDraft = (code: string, patch: Partial<AliasDraft>) => {
    setAliasDrafts((prev) => ({
      ...prev,
      [code]: { ...prev[code], ...patch },
    }));
    setAliasStatus((prev) => ({ ...prev, [code]: { state: "idle" } }));
  };

  const saveAliasRow = async (code: string) => {
    const draft = aliasDrafts[code];
    const baseline = aliasBaseline[code];
    if (!draft || !baseline) return;
    const diff: Record<string, unknown> = {};
    if (draft.alias !== baseline.alias) diff.alias = draft.alias;
    if (draft.canonical_area !== baseline.canonical_area)
      diff.canonical_area = draft.canonical_area;
    if (draft.region_code !== baseline.region_code)
      diff.region_code = draft.region_code;
    if (Boolean(draft.active) !== Boolean(baseline.active))
      diff.active = Boolean(draft.active);
    if ((draft.notes ?? "") !== (baseline.notes ?? ""))
      diff.notes = draft.notes ?? "";

    if (Object.keys(diff).length === 0) {
      setAliasStatus((p) => ({
        ...p,
        [code]: { state: "saved", message: "No changes" },
      }));
      return;
    }

    setAliasStatus((p) => ({ ...p, [code]: { state: "saving" } }));
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "alias", alias_code: code, ...diff }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        alias?: Alias;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data?.ok || !data.alias) {
        setAliasStatus((p) => ({
          ...p,
          [code]: {
            state: "error",
            message: data?.detail || data?.error || `HTTP ${res.status}`,
          },
        }));
        return;
      }
      setAliasDrafts((p) => ({ ...p, [code]: data.alias! }));
      setAliasBaseline((p) => ({ ...p, [code]: data.alias! }));
      setAliasStatus((p) => ({
        ...p,
        [code]: { state: "saved", message: "Saved" },
      }));
    } catch (e: any) {
      setAliasStatus((p) => ({
        ...p,
        [code]: { state: "error", message: e?.message || "Network error" },
      }));
    }
  };

  const createAlias = async () => {
    const { alias_code, alias, canonical_area, region_code, notes } = newAlias;
    if (!alias_code.trim() || !alias.trim() || !canonical_area.trim() || !region_code.trim()) {
      setCreateStatus({
        state: "error",
        message: "alias_code, alias, canonical_area, and region_code are required.",
      });
      return;
    }
    setCreateStatus({ state: "saving" });
    try {
      const res = await fetch("/api/admin/area-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias_code: alias_code.trim(),
          alias: alias.trim(),
          canonical_area: canonical_area.trim(),
          region_code: region_code.trim(),
          active: true,
          notes,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        alias?: Alias;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data?.ok || !data.alias) {
        setCreateStatus({
          state: "error",
          message: data?.detail || data?.error || `HTTP ${res.status}`,
        });
        return;
      }
      const created = data.alias;
      setAliasDrafts((p) => ({ ...p, [created.alias_code]: created }));
      setAliasBaseline((p) => ({ ...p, [created.alias_code]: created }));
      setCreateStatus({
        state: "saved",
        message: `Created ${created.alias_code} (${created.alias}).`,
      });
      setNewAlias({
        alias_code: "",
        alias: "",
        canonical_area: "",
        region_code: "",
        notes: "",
      });
    } catch (e: any) {
      setCreateStatus({
        state: "error",
        message: e?.message || "Network error",
      });
    }
  };

  return (
    <main className="min-w-0 space-y-8 px-4 py-8 sm:px-0">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Area Intelligence — Edit
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Sandbox editor for the new Area Intelligence tables. No delete
          button — use the <code>active</code> toggle. Renaming a canonical
          area or moving it to a different region is blocked if aliases
          still reference it (deactivate or reassign those aliases first).
        </p>
      </header>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}

      <Section
        title={`Regions (${regions.length})`}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        }
      >
        <Table
          columns={[
            "region_code",
            "region_name",
            "active",
            "linked",
            "notes",
            "actions",
          ]}
          rows={regions.map((r) => {
            const baseline = regionBaseline[r.region_code];
            const dirty =
              baseline &&
              ((r.region_name ?? "") !== (baseline.region_name ?? "") ||
                Boolean(r.active) !== Boolean(baseline.active) ||
                (r.notes ?? "") !== (baseline.notes ?? ""));
            const status = regionStatus[r.region_code];
            const stats =
              regionStats.get(r.region_code) ?? {
                areas: 0,
                aliases: 0,
                activeAreas: 0,
                activeAliases: 0,
              };
            const showDeactivateWarning =
              !r.active &&
              (stats.activeAreas > 0 || stats.activeAliases > 0);
            return {
              key: r.region_code,
              cells: [
                <code key="c" className="text-xs">
                  {r.region_code}
                </code>,
                <input
                  key="rn"
                  type="text"
                  value={r.region_name ?? ""}
                  onChange={(e) =>
                    updateRegionDraft(r.region_code, {
                      region_name: e.target.value,
                    })
                  }
                  className={inputCls}
                />,
                <div key="a" className="flex flex-col gap-1">
                  <ToggleActive
                    value={Boolean(r.active)}
                    onChange={(v) =>
                      updateRegionDraft(r.region_code, { active: v })
                    }
                  />
                  {showDeactivateWarning ? (
                    <span className="max-w-[14rem] rounded bg-amber-50 px-2 py-1 text-[11px] leading-tight text-amber-800">
                      This region has linked areas/aliases. Deactivate
                      children separately if needed.
                    </span>
                  ) : null}
                </div>,
                <div key="l" className="text-xs leading-tight text-slate-600">
                  <div>
                    <span
                      className={
                        stats.areas > 0
                          ? "font-semibold text-slate-800"
                          : "text-slate-400"
                      }
                    >
                      {stats.areas}
                    </span>{" "}
                    areas
                    {stats.areas > 0 ? (
                      <span className="text-slate-400">
                        {" "}
                        ({stats.activeAreas} active)
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <span
                      className={
                        stats.aliases > 0
                          ? "font-semibold text-slate-800"
                          : "text-slate-400"
                      }
                    >
                      {stats.aliases}
                    </span>{" "}
                    aliases
                    {stats.aliases > 0 ? (
                      <span className="text-slate-400">
                        {" "}
                        ({stats.activeAliases} active)
                      </span>
                    ) : null}
                  </div>
                </div>,
                <input
                  key="n"
                  type="text"
                  value={r.notes ?? ""}
                  onChange={(e) =>
                    updateRegionDraft(r.region_code, { notes: e.target.value })
                  }
                  className={inputCls}
                  placeholder="—"
                />,
                <SaveCell
                  key="s"
                  dirty={Boolean(dirty)}
                  status={status}
                  onClick={() => void saveRegionRow(r.region_code)}
                />,
              ],
            };
          })}
          empty={loading ? "Loading…" : "No regions."}
        />
      </Section>

      <Section title="Add Region">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          <LabeledInput
            label="region_code"
            value={newRegion.region_code}
            onChange={(v) => setNewRegion((p) => ({ ...p, region_code: v }))}
            placeholder="e.g. R-99"
          />
          <LabeledInput
            label="region_name"
            value={newRegion.region_name}
            onChange={(v) => setNewRegion((p) => ({ ...p, region_name: v }))}
            placeholder="e.g. Test Region"
          />
          <LabeledInput
            label="notes (optional)"
            value={newRegion.notes}
            onChange={(v) => setNewRegion((p) => ({ ...p, notes: v }))}
            placeholder="—"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void createRegion()}
            disabled={createRegionStatus.state === "saving"}
            className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:opacity-60"
          >
            {createRegionStatus.state === "saving" ? "Creating…" : "Create"}
          </button>
          {createRegionStatus.message ? (
            <span
              className={
                createRegionStatus.state === "error"
                  ? "text-xs text-rose-700"
                  : "text-xs text-emerald-700"
              }
            >
              {createRegionStatus.message}
            </span>
          ) : null}
        </div>
      </Section>

      <Section title={`Canonical Areas (${Object.keys(areaDrafts).length})`}>
        <FilterInput
          value={areaFilter}
          onChange={setAreaFilter}
          placeholder="Filter areas by code, name, or region…"
        />
        <Table
          columns={[
            "area_code",
            "canonical_area",
            "region_code",
            "active",
            "linked",
            "notes",
            "actions",
          ]}
          rows={areaRows.map((r) => {
            const baseline = areaBaseline[r.area_code];
            const dirty =
              baseline &&
              (r.canonical_area !== baseline.canonical_area ||
                r.region_code !== baseline.region_code ||
                Boolean(r.active) !== Boolean(baseline.active) ||
                (r.notes ?? "") !== (baseline.notes ?? ""));
            const status = areaStatus[r.area_code];
            const stats =
              areaAliasStats.get(
                areaAliasKey(r.canonical_area, r.region_code)
              ) ?? { total: 0, active: 0 };
            const showDeactivateWarning = !r.active && stats.active > 0;
            return {
              key: r.area_code,
              cells: [
                <code key="c" className="text-xs">
                  {r.area_code}
                </code>,
                <input
                  key="ca"
                  type="text"
                  value={r.canonical_area}
                  onChange={(e) =>
                    updateAreaDraft(r.area_code, {
                      canonical_area: e.target.value,
                    })
                  }
                  className={inputCls}
                />,
                <select
                  key="rc"
                  value={r.region_code}
                  onChange={(e) =>
                    updateAreaDraft(r.area_code, {
                      region_code: e.target.value,
                    })
                  }
                  className={inputCls}
                >
                  {regions.map((rg) => (
                    <option key={rg.region_code} value={rg.region_code}>
                      {rg.region_code} — {rg.region_name}
                    </option>
                  ))}
                </select>,
                <div key="a" className="flex flex-col gap-1">
                  <ToggleActive
                    value={Boolean(r.active)}
                    onChange={(v) =>
                      updateAreaDraft(r.area_code, { active: v })
                    }
                  />
                  {showDeactivateWarning ? (
                    <span className="max-w-[14rem] rounded bg-amber-50 px-2 py-1 text-[11px] leading-tight text-amber-800">
                      This area has linked aliases. Deactivate aliases
                      separately if needed.
                    </span>
                  ) : null}
                </div>,
                <div key="l" className="text-xs leading-tight text-slate-600">
                  <span
                    className={
                      stats.total > 0
                        ? "font-semibold text-slate-800"
                        : "text-slate-400"
                    }
                  >
                    {stats.total}
                  </span>{" "}
                  aliases
                  {stats.total > 0 ? (
                    <span className="text-slate-400">
                      {" "}
                      ({stats.active} active)
                    </span>
                  ) : null}
                </div>,
                <input
                  key="n"
                  type="text"
                  value={r.notes ?? ""}
                  onChange={(e) =>
                    updateAreaDraft(r.area_code, { notes: e.target.value })
                  }
                  className={inputCls}
                  placeholder="—"
                />,
                <SaveCell
                  key="s"
                  dirty={Boolean(dirty)}
                  status={status}
                  onClick={() => void saveAreaRow(r.area_code)}
                />,
              ],
            };
          })}
          empty={loading ? "Loading…" : "No areas match."}
        />
      </Section>

      <Section title="Add Area">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <LabeledInput
            label="area_code"
            value={newArea.area_code}
            onChange={(v) => setNewArea((p) => ({ ...p, area_code: v }))}
            placeholder="e.g. A-999"
          />
          <LabeledInput
            label="canonical_area"
            value={newArea.canonical_area}
            onChange={(v) => setNewArea((p) => ({ ...p, canonical_area: v }))}
            placeholder="e.g. Test Area"
          />
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              region_code
            </label>
            <select
              value={newArea.region_code}
              onChange={(e) =>
                setNewArea((p) => ({ ...p, region_code: e.target.value }))
              }
              className={`mt-1 ${inputCls}`}
            >
              <option value="">— select region —</option>
              {regions.map((rg) => (
                <option key={rg.region_code} value={rg.region_code}>
                  {rg.region_code} — {rg.region_name}
                </option>
              ))}
            </select>
          </div>
          <LabeledInput
            label="notes (optional)"
            value={newArea.notes}
            onChange={(v) => setNewArea((p) => ({ ...p, notes: v }))}
            placeholder="—"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void createArea()}
            disabled={createAreaStatus.state === "saving"}
            className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:opacity-60"
          >
            {createAreaStatus.state === "saving" ? "Creating…" : "Create"}
          </button>
          {createAreaStatus.message ? (
            <span
              className={
                createAreaStatus.state === "error"
                  ? "text-xs text-rose-700"
                  : "text-xs text-emerald-700"
              }
            >
              {createAreaStatus.message}
            </span>
          ) : null}
        </div>
      </Section>

      <Section title={`Aliases (${Object.keys(aliasDrafts).length})`}>
        <FilterInput
          value={aliasFilter}
          onChange={setAliasFilter}
          placeholder="Filter aliases…"
        />
        <Table
          columns={[
            "alias_code",
            "alias",
            "canonical_area",
            "region_code",
            "active",
            "notes",
            "actions",
          ]}
          rows={aliasRows.map((r) => {
            const baseline = aliasBaseline[r.alias_code];
            const dirty =
              baseline &&
              (r.alias !== baseline.alias ||
                r.canonical_area !== baseline.canonical_area ||
                r.region_code !== baseline.region_code ||
                Boolean(r.active) !== Boolean(baseline.active) ||
                (r.notes ?? "") !== (baseline.notes ?? ""));
            const status = aliasStatus[r.alias_code];
            return {
              key: r.alias_code,
              cells: [
                <code key="c" className="text-xs">
                  {r.alias_code}
                </code>,
                <input
                  key="al"
                  type="text"
                  value={r.alias}
                  onChange={(e) =>
                    updateAliasDraft(r.alias_code, { alias: e.target.value })
                  }
                  className={inputCls}
                />,
                <input
                  key="ca"
                  type="text"
                  value={r.canonical_area}
                  onChange={(e) =>
                    updateAliasDraft(r.alias_code, {
                      canonical_area: e.target.value,
                    })
                  }
                  className={inputCls}
                />,
                <select
                  key="rc"
                  value={r.region_code}
                  onChange={(e) =>
                    updateAliasDraft(r.alias_code, {
                      region_code: e.target.value,
                    })
                  }
                  className={inputCls}
                >
                  {regions.map((rg) => (
                    <option key={rg.region_code} value={rg.region_code}>
                      {rg.region_code} — {rg.region_name}
                    </option>
                  ))}
                </select>,
                <ToggleActive
                  key="a"
                  value={Boolean(r.active)}
                  onChange={(v) =>
                    updateAliasDraft(r.alias_code, { active: v })
                  }
                />,
                <input
                  key="n"
                  type="text"
                  value={r.notes ?? ""}
                  onChange={(e) =>
                    updateAliasDraft(r.alias_code, { notes: e.target.value })
                  }
                  className={inputCls}
                  placeholder="—"
                />,
                <SaveCell
                  key="s"
                  dirty={Boolean(dirty)}
                  status={status}
                  onClick={() => void saveAliasRow(r.alias_code)}
                />,
              ],
            };
          })}
          empty={loading ? "Loading…" : "No aliases match."}
        />
      </Section>

      <Section title="Add Alias">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <LabeledInput
            label="alias_code"
            value={newAlias.alias_code}
            onChange={(v) => setNewAlias((p) => ({ ...p, alias_code: v }))}
            placeholder="e.g. AL-200"
          />
          <LabeledInput
            label="alias"
            value={newAlias.alias}
            onChange={(v) => setNewAlias((p) => ({ ...p, alias: v }))}
            placeholder="e.g. Sardarpura B"
          />
          <LabeledInput
            label="canonical_area"
            value={newAlias.canonical_area}
            onChange={(v) =>
              setNewAlias((p) => ({ ...p, canonical_area: v }))
            }
            placeholder="must exist under region"
          />
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              region_code
            </label>
            <select
              value={newAlias.region_code}
              onChange={(e) =>
                setNewAlias((p) => ({ ...p, region_code: e.target.value }))
              }
              className={`mt-1 ${inputCls}`}
            >
              <option value="">— select region —</option>
              {regions.map((rg) => (
                <option key={rg.region_code} value={rg.region_code}>
                  {rg.region_code} — {rg.region_name}
                </option>
              ))}
            </select>
          </div>
          <LabeledInput
            label="notes (optional)"
            value={newAlias.notes}
            onChange={(v) => setNewAlias((p) => ({ ...p, notes: v }))}
            placeholder="—"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void createAlias()}
            disabled={createStatus.state === "saving"}
            className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:opacity-60"
          >
            {createStatus.state === "saving" ? "Creating…" : "Create"}
          </button>
          {createStatus.message ? (
            <span
              className={
                createStatus.state === "error"
                  ? "text-xs text-rose-700"
                  : "text-xs text-emerald-700"
              }
            >
              {createStatus.message}
            </span>
          ) : null}
        </div>
      </Section>
    </main>
  );
}

// ─── small UI helpers ──────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200";

function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </h2>
        {actions ?? null}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputCls}
    />
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 ${inputCls}`}
      />
    </label>
  );
}

function ToggleActive({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-300"
      />
      {value ? (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
          active
        </span>
      ) : (
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          inactive
        </span>
      )}
    </label>
  );
}

function SaveCell({
  dirty,
  status,
  onClick,
}: {
  dirty: boolean;
  status: RowStatus | undefined;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={!dirty || status?.state === "saving"}
        className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-3 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-[#002a16] disabled:opacity-40"
      >
        {status?.state === "saving" ? "Saving…" : "Save"}
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
  );
}

function Table({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-sm text-slate-500">{empty}</div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-2 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.key} className="align-top">
              {r.cells.map((cell, i) => (
                <td key={i} className="px-2 py-2 text-slate-800">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
