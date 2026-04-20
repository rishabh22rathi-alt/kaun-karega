import { adminSupabase } from "../supabase/admin";

// ---------------------------------------------------------------------------
// Normalization — mirrors GAS normalizeAreaName_() and getNormalizedAreaKey_()
// ---------------------------------------------------------------------------

function normalizeAreaName(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toAreaKey(value: string): string {
  return normalizeAreaName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AreaRow = {
  area_name: string;
  active: boolean;
};

type AliasRow = {
  alias_name: string;
  canonical_area: string;
  active: boolean;
};

type ProviderAreaRow = {
  provider_id: string;
  area: string | null;
};

export type ManagedAreaAlias = {
  AliasName: string;
  Active: string;
};

export type ManagedAreaMapping = {
  CanonicalArea: string;
  Active: string;
  Aliases: ManagedAreaAlias[];
  AliasCount: number;
};

export type AreaMappingsResult =
  | { ok: true; status: "success"; mappings: ManagedAreaMapping[] }
  | { ok: false; status: "error"; error: string };

export type AreaAliasMutateResult =
  | { ok: true; status: "success"; alias: { AliasName: string; CanonicalArea: string; Active: string } }
  | { ok: false; status: "error"; error: string };

export type AreaMergeResult =
  | { ok: true; status: "success"; sourceArea: string; canonicalArea: string }
  | { ok: false; status: "error"; error: string };

export type AreaMutateResult =
  | { ok: true; status: "success"; area: { AreaName: string; Active: string } }
  | { ok: false; status: "error"; error: string };

export type ProviderAreaCanonicalizationResult =
  | {
      ok: true;
      status: "success";
      updatedProviders: number;
      updatedRows: number;
      dedupedRows: number;
      unresolvedRows: number;
      skipped?: boolean;
    }
  | { ok: false; status: "error"; error: string };

const PROVIDER_AREA_CANONICALIZATION_TTL_MS = 5 * 60 * 1000;

let lastProviderAreaCanonicalizationAt = 0;
let pendingProviderAreaCanonicalization: Promise<ProviderAreaCanonicalizationResult> | null = null;

type AreaResolutionMaps = {
  activeCanonicalByKey: Map<string, string>;
  anyCanonicalByKey: Map<string, string>;
  activeAliasToCanonicalByKey: Map<string, string>;
};

function buildAreaResolutionMaps(areas: AreaRow[], aliases: AliasRow[]): AreaResolutionMaps {
  const activeCanonicalByKey = new Map<string, string>();
  const anyCanonicalByKey = new Map<string, string>();

  for (const area of areas) {
    const normalizedName = normalizeAreaName(area.area_name);
    const key = toAreaKey(normalizedName);
    if (!normalizedName || !key) continue;

    if (!anyCanonicalByKey.has(key)) {
      anyCanonicalByKey.set(key, normalizedName);
    }
    if (area.active && !activeCanonicalByKey.has(key)) {
      activeCanonicalByKey.set(key, normalizedName);
    }
  }

  const activeAliasToCanonicalByKey = new Map<string, string>();
  for (const alias of aliases) {
    if (!alias.active) continue;

    const normalizedAlias = normalizeAreaName(alias.alias_name);
    const aliasKey = toAreaKey(normalizedAlias);
    if (!normalizedAlias || !aliasKey || activeAliasToCanonicalByKey.has(aliasKey)) continue;

    const canonicalKey = toAreaKey(alias.canonical_area);
    const canonicalName =
      activeCanonicalByKey.get(canonicalKey) ??
      anyCanonicalByKey.get(canonicalKey) ??
      normalizeAreaName(alias.canonical_area);

    if (!canonicalName) continue;
    activeAliasToCanonicalByKey.set(aliasKey, canonicalName);
  }

  return {
    activeCanonicalByKey,
    anyCanonicalByKey,
    activeAliasToCanonicalByKey,
  };
}

function resolveCanonicalAreaNameForCoverage(
  areaName: string,
  maps: AreaResolutionMaps
): string | null {
  const normalizedName = normalizeAreaName(areaName);
  const key = toAreaKey(normalizedName);
  if (!normalizedName || !key) return null;

  return (
    maps.activeCanonicalByKey.get(key) ??
    maps.activeAliasToCanonicalByKey.get(key) ??
    maps.anyCanonicalByKey.get(key) ??
    null
  );
}

async function runProviderAreaCanonicalization(): Promise<ProviderAreaCanonicalizationResult> {
  const [areasRes, aliasesRes, providerAreasRes] = await Promise.all([
    adminSupabase.from("areas").select("area_name, active"),
    adminSupabase.from("area_aliases").select("alias_name, canonical_area, active"),
    adminSupabase.from("provider_areas").select("provider_id, area"),
  ]);

  if (areasRes.error) {
    return { ok: false, status: "error", error: areasRes.error.message };
  }
  if (aliasesRes.error) {
    return { ok: false, status: "error", error: aliasesRes.error.message };
  }
  if (providerAreasRes.error) {
    return { ok: false, status: "error", error: providerAreasRes.error.message };
  }

  const areas = (areasRes.data ?? []) as AreaRow[];
  const aliases = (aliasesRes.data ?? []) as AliasRow[];
  const providerAreaRows = (providerAreasRes.data ?? []) as ProviderAreaRow[];
  const maps = buildAreaResolutionMaps(areas, aliases);

  if (providerAreaRows.length === 0) {
    return {
      ok: true,
      status: "success",
      updatedProviders: 0,
      updatedRows: 0,
      dedupedRows: 0,
      unresolvedRows: 0,
    };
  }

  const rowsByProvider = new Map<string, string[]>();
  for (const row of providerAreaRows) {
    const providerId = String(row.provider_id || "").trim();
    if (!providerId) continue;
    if (!rowsByProvider.has(providerId)) rowsByProvider.set(providerId, []);
    rowsByProvider.get(providerId)!.push(String(row.area ?? ""));
  }

  let updatedProviders = 0;
  let updatedRows = 0;
  let dedupedRows = 0;
  let unresolvedRows = 0;

  for (const [providerId, currentAreas] of rowsByProvider.entries()) {
    const nextAreas: string[] = [];
    const seenResolvedKeys = new Set<string>();

    for (const currentArea of currentAreas) {
      const resolvedCanonical = resolveCanonicalAreaNameForCoverage(currentArea, maps);

      if (!resolvedCanonical) {
        unresolvedRows += 1;
        nextAreas.push(currentArea);
        continue;
      }

      const resolvedKey = toAreaKey(resolvedCanonical);
      if (seenResolvedKeys.has(resolvedKey)) {
        dedupedRows += 1;
        continue;
      }

      seenResolvedKeys.add(resolvedKey);
      if (normalizeAreaName(currentArea) !== resolvedCanonical) {
        updatedRows += 1;
      }
      nextAreas.push(resolvedCanonical);
    }

    const changed =
      currentAreas.length !== nextAreas.length ||
      currentAreas.some((area, index) => area !== nextAreas[index]);

    if (!changed) continue;

    const { error: deleteError } = await adminSupabase
      .from("provider_areas")
      .delete()
      .eq("provider_id", providerId);
    if (deleteError) {
      return { ok: false, status: "error", error: deleteError.message };
    }

    if (nextAreas.length > 0) {
      const { error: insertError } = await adminSupabase.from("provider_areas").insert(
        nextAreas.map((area) => ({
          provider_id: providerId,
          area,
        }))
      );
      if (insertError) {
        return { ok: false, status: "error", error: insertError.message };
      }
    }

    updatedProviders += 1;
  }

  return {
    ok: true,
    status: "success",
    updatedProviders,
    updatedRows,
    dedupedRows,
    unresolvedRows,
  };
}

async function rewriteProviderAreasForRenamedCanonicalArea(
  oldArea: string,
  newArea: string
): Promise<{ ok: boolean; error?: string }> {
  const oldKey = toAreaKey(oldArea);
  const newKey = toAreaKey(newArea);
  if (!oldKey || !newKey) return { ok: true };

  const { data, error } = await adminSupabase.from("provider_areas").select("provider_id, area");
  if (error) return { ok: false, error: error.message };

  const rowsByProvider = new Map<string, string[]>();
  for (const row of (data ?? []) as ProviderAreaRow[]) {
    const providerId = String(row.provider_id || "").trim();
    if (!providerId) continue;
    if (!rowsByProvider.has(providerId)) rowsByProvider.set(providerId, []);
    rowsByProvider.get(providerId)!.push(String(row.area ?? ""));
  }

  for (const [providerId, currentAreas] of rowsByProvider.entries()) {
    let changed = false;
    const nextAreas: string[] = [];
    let seenNewKey = false;

    for (const currentArea of currentAreas) {
      const currentKey = toAreaKey(currentArea);
      const shouldRewrite = currentKey === oldKey;
      const nextArea = shouldRewrite ? newArea : currentArea;
      const nextKey = toAreaKey(nextArea);

      if (nextKey === newKey) {
        if (seenNewKey) {
          changed = true;
          continue;
        }
        seenNewKey = true;
      }

      if (shouldRewrite && currentArea !== nextArea) {
        changed = true;
      }
      nextAreas.push(nextArea);
    }

    if (!changed) continue;

    const { error: deleteError } = await adminSupabase
      .from("provider_areas")
      .delete()
      .eq("provider_id", providerId);
    if (deleteError) return { ok: false, error: deleteError.message };

    if (nextAreas.length > 0) {
      const { error: insertError } = await adminSupabase.from("provider_areas").insert(
        nextAreas.map((area) => ({
          provider_id: providerId,
          area,
        }))
      );
      if (insertError) return { ok: false, error: insertError.message };
    }
  }

  return { ok: true };
}

export async function canonicalizeProviderAreasToCanonicalNames(params?: {
  force?: boolean;
}): Promise<ProviderAreaCanonicalizationResult> {
  const force = params?.force === true;
  const now = Date.now();

  if (pendingProviderAreaCanonicalization) {
    return pendingProviderAreaCanonicalization;
  }

  if (
    !force &&
    lastProviderAreaCanonicalizationAt > 0 &&
    now - lastProviderAreaCanonicalizationAt < PROVIDER_AREA_CANONICALIZATION_TTL_MS
  ) {
    return {
      ok: true,
      status: "success",
      updatedProviders: 0,
      updatedRows: 0,
      dedupedRows: 0,
      unresolvedRows: 0,
      skipped: true,
    };
  }

  const runPromise = (async () => {
    const result = await runProviderAreaCanonicalization();
    if (result.ok) {
      lastProviderAreaCanonicalizationAt = Date.now();
    }
    return result;
  })();

  pendingProviderAreaCanonicalization = runPromise;

  try {
    return await runPromise;
  } finally {
    pendingProviderAreaCanonicalization = null;
  }
}

export async function listActiveCanonicalAreas(): Promise<string[]> {
  const { data, error } = await adminSupabase
    .from("areas")
    .select("area_name")
    .eq("active", true)
    .order("area_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const row of (data ?? []) as Array<{ area_name: string | null }>) {
    const areaName = normalizeAreaName(row.area_name || "");
    const key = toAreaKey(areaName);
    if (!areaName || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(areaName);
  }

  return out;
}

export async function addAreaToSupabase(params: {
  areaName: string;
}): Promise<AreaMutateResult> {
  try {
    const normalizedArea = normalizeAreaName(params.areaName);
    if (!normalizedArea) {
      return { ok: false, status: "error", error: "AreaName required" };
    }

    const nowIso = new Date().toISOString();
    const ensureResult = await ensureCanonicalAreaExists(normalizedArea, nowIso);
    if (!ensureResult.ok) {
      return { ok: false, status: "error", error: ensureResult.error ?? "Failed to add area" };
    }

    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames({ force: true });
    if (!reconcileResult.ok) {
      return { ok: false, status: "error", error: reconcileResult.error };
    }

    return {
      ok: true,
      status: "success",
      area: { AreaName: normalizedArea, Active: "yes" },
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to add area",
    };
  }
}

export async function editAreaInSupabase(params: {
  oldArea: string;
  newArea: string;
}): Promise<AreaMutateResult> {
  try {
    const normalizedOld = normalizeAreaName(params.oldArea);
    const normalizedNew = normalizeAreaName(params.newArea);

    if (!normalizedOld || !normalizedNew) {
      return { ok: false, status: "error", error: "OldArea and NewArea required" };
    }

    const oldKey = toAreaKey(normalizedOld);
    const newKey = toAreaKey(normalizedNew);

    const { data: areaRows, error: areaFetchError } = await adminSupabase
      .from("areas")
      .select("area_name, active");
    if (areaFetchError) {
      return { ok: false, status: "error", error: areaFetchError.message };
    }

    const areas = (areaRows ?? []) as AreaRow[];
    const existingArea =
      areas.find((row) => toAreaKey(row.area_name) === oldKey) ?? null;
    if (!existingArea) {
      return { ok: false, status: "error", error: "Area not found" };
    }

    const duplicateArea = areas.find(
      (row) => toAreaKey(row.area_name) === newKey && toAreaKey(row.area_name) !== oldKey
    );
    if (duplicateArea) {
      return { ok: false, status: "error", error: "Area already exists" };
    }

    const nowIso = new Date().toISOString();
    const { error: updateAreaError } = await adminSupabase
      .from("areas")
      .update({ area_name: normalizedNew, active: true, updated_at: nowIso })
      .eq("area_name", existingArea.area_name);
    if (updateAreaError) {
      return { ok: false, status: "error", error: updateAreaError.message };
    }

    const { error: aliasUpdateError } = await adminSupabase
      .from("area_aliases")
      .update({ canonical_area: normalizedNew, updated_at: nowIso })
      .eq("canonical_area", existingArea.area_name);
    if (aliasUpdateError) {
      return { ok: false, status: "error", error: aliasUpdateError.message };
    }

    const rewriteResult = await rewriteProviderAreasForRenamedCanonicalArea(
      existingArea.area_name,
      normalizedNew
    );
    if (!rewriteResult.ok) {
      return { ok: false, status: "error", error: rewriteResult.error ?? "Failed to update provider areas" };
    }

    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames({ force: true });
    if (!reconcileResult.ok) {
      return { ok: false, status: "error", error: reconcileResult.error };
    }

    return {
      ok: true,
      status: "success",
      area: { AreaName: normalizedNew, Active: "yes" },
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to edit area",
    };
  }
}

// ---------------------------------------------------------------------------
// READ — get_admin_area_mappings / admin_get_area_mappings
// ---------------------------------------------------------------------------

export async function getAreaMappingsFromSupabase(): Promise<AreaMappingsResult> {
  try {
    const [areasRes, aliasesRes] = await Promise.all([
      adminSupabase.from("areas").select("area_name, active"),
      adminSupabase.from("area_aliases").select("alias_name, canonical_area, active"),
    ]);

    if (areasRes.error) {
      return { ok: false, status: "error", error: areasRes.error.message };
    }
    if (aliasesRes.error) {
      return { ok: false, status: "error", error: aliasesRes.error.message };
    }

    const areas = (areasRes.data ?? []) as AreaRow[];
    const aliases = (aliasesRes.data ?? []) as AliasRow[];

    const byKey: Record<string, ManagedAreaMapping> = {};

    for (const area of areas) {
      const name = normalizeAreaName(area.area_name);
      if (!name) continue;
      const key = toAreaKey(name);
      if (!key || byKey[key]) continue;
      byKey[key] = {
        CanonicalArea: name,
        Active: area.active ? "yes" : "no",
        Aliases: [],
        AliasCount: 0,
      };
    }

    for (const alias of aliases) {
      const aliasName = normalizeAreaName(alias.alias_name);
      const canonicalName = normalizeAreaName(alias.canonical_area);
      if (!aliasName || !canonicalName) continue;

      const canonicalKey = toAreaKey(canonicalName);
      if (!byKey[canonicalKey]) {
        byKey[canonicalKey] = {
          CanonicalArea: canonicalName,
          Active: "yes",
          Aliases: [],
          AliasCount: 0,
        };
      }

      const aliasList = byKey[canonicalKey].Aliases;
      const aliasKey = toAreaKey(aliasName);
      const exists = aliasList.some((a) => toAreaKey(a.AliasName) === aliasKey);
      if (exists) continue;

      aliasList.push({ AliasName: aliasName, Active: alias.active ? "yes" : "no" });
    }

    const mappings = Object.values(byKey)
      .map((item) => {
        item.Aliases.sort((a, b) => a.AliasName.localeCompare(b.AliasName));
        item.AliasCount = item.Aliases.filter((a) => a.Active === "yes").length;
        return item;
      })
      .sort((a, b) => a.CanonicalArea.localeCompare(b.CanonicalArea));

    return { ok: true, status: "success", mappings };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to load area mappings",
    };
  }
}

// ---------------------------------------------------------------------------
// Shared helper — ensure canonical area row exists (creates/activates if needed)
// ---------------------------------------------------------------------------

async function ensureCanonicalAreaExists(
  normalizedCanonical: string,
  nowIso: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await adminSupabase.from("areas").upsert(
    { area_name: normalizedCanonical, active: true, updated_at: nowIso },
    { onConflict: "area_name" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// WRITE — admin_add_area_alias
// ---------------------------------------------------------------------------

export async function addAreaAliasToSupabase(params: {
  aliasName: string;
  canonicalArea: string;
}): Promise<AreaAliasMutateResult> {
  try {
    const normalizedAlias = normalizeAreaName(params.aliasName);
    const normalizedCanonical = normalizeAreaName(params.canonicalArea);

    if (!normalizedAlias) {
      return { ok: false, status: "error", error: "AliasName required" };
    }
    if (!normalizedCanonical) {
      return { ok: false, status: "error", error: "CanonicalArea required" };
    }
    if (toAreaKey(normalizedAlias) === toAreaKey(normalizedCanonical)) {
      return { ok: false, status: "error", error: "Alias and canonical area cannot match" };
    }

    const nowIso = new Date().toISOString();

    const ensureResult = await ensureCanonicalAreaExists(normalizedCanonical, nowIso);
    if (!ensureResult.ok) {
      return { ok: false, status: "error", error: ensureResult.error ?? "Failed to ensure canonical area" };
    }

    const { error: upsertError } = await adminSupabase.from("area_aliases").upsert(
      {
        alias_name: normalizedAlias,
        canonical_area: normalizedCanonical,
        active: true,
        updated_at: nowIso,
      },
      { onConflict: "alias_name" }
    );
    if (upsertError) {
      return { ok: false, status: "error", error: upsertError.message };
    }

    // Deactivate the alias name as a canonical area (if it exists as one)
    await adminSupabase
      .from("areas")
      .update({ active: false, updated_at: nowIso })
      .eq("area_name", normalizedAlias);

    // Migrate provider_areas from alias → canonical
    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames({ force: true });
    if (!reconcileResult.ok) {
      return { ok: false, status: "error", error: reconcileResult.error };
    }

    return {
      ok: true,
      status: "success",
      alias: { AliasName: normalizedAlias, CanonicalArea: normalizedCanonical, Active: "yes" },
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to add area alias",
    };
  }
}

export async function mergeAreaIntoCanonicalInSupabase(params: {
  sourceArea: string;
  canonicalArea: string;
}): Promise<AreaMergeResult> {
  const normalizedSource = normalizeAreaName(params.sourceArea);
  const normalizedCanonical = normalizeAreaName(params.canonicalArea);

  if (!normalizedSource) {
    return { ok: false, status: "error", error: "SourceArea required" };
  }
  if (!normalizedCanonical) {
    return { ok: false, status: "error", error: "CanonicalArea required" };
  }
  if (toAreaKey(normalizedSource) === toAreaKey(normalizedCanonical)) {
    return {
      ok: false,
      status: "error",
      error: "SourceArea and CanonicalArea cannot match",
    };
  }

  const aliasResult = await addAreaAliasToSupabase({
    aliasName: normalizedSource,
    canonicalArea: normalizedCanonical,
  });
  if (!aliasResult.ok) {
    return { ok: false, status: "error", error: aliasResult.error };
  }

  return {
    ok: true,
    status: "success",
    sourceArea: normalizedSource,
    canonicalArea: aliasResult.alias.CanonicalArea,
  };
}

// ---------------------------------------------------------------------------
// WRITE — admin_update_area_alias
// ---------------------------------------------------------------------------

export async function updateAreaAliasInSupabase(params: {
  oldAliasName: string;
  newAliasName: string;
  canonicalArea: string;
}): Promise<AreaAliasMutateResult> {
  try {
    const normalizedOld = normalizeAreaName(params.oldAliasName || params.newAliasName);
    const normalizedNew = normalizeAreaName(params.newAliasName || normalizedOld);
    const normalizedCanonical = normalizeAreaName(params.canonicalArea);

    if (!normalizedOld || !normalizedNew || !normalizedCanonical) {
      return {
        ok: false,
        status: "error",
        error: "OldAliasName, NewAliasName, and CanonicalArea required",
      };
    }
    if (toAreaKey(normalizedNew) === toAreaKey(normalizedCanonical)) {
      return { ok: false, status: "error", error: "Alias and canonical area cannot match" };
    }

    const { data: existing, error: fetchError } = await adminSupabase
      .from("area_aliases")
      .select("alias_name, canonical_area, active")
      .ilike("alias_name", normalizedOld)
      .maybeSingle();

    if (fetchError) {
      return { ok: false, status: "error", error: fetchError.message };
    }
    if (!existing) {
      return { ok: false, status: "error", error: "Alias not found" };
    }

    const oldKey = toAreaKey(normalizedOld);
    const newKey = toAreaKey(normalizedNew);
    const nameChanged = oldKey !== newKey;

    // Check for duplicate (only if name is actually changing)
    if (nameChanged) {
      const { data: duplicate } = await adminSupabase
        .from("area_aliases")
        .select("alias_name")
        .ilike("alias_name", normalizedNew)
        .maybeSingle();

      if (duplicate) {
        return { ok: false, status: "error", error: "Alias already exists" };
      }
    }

    const nowIso = new Date().toISOString();

    const ensureResult = await ensureCanonicalAreaExists(normalizedCanonical, nowIso);
    if (!ensureResult.ok) {
      return { ok: false, status: "error", error: ensureResult.error ?? "Failed to ensure canonical area" };
    }

    const { error: updateError } = await adminSupabase
      .from("area_aliases")
      .update({
        alias_name: normalizedNew,
        canonical_area: normalizedCanonical,
        updated_at: nowIso,
      })
      .ilike("alias_name", normalizedOld);

    if (updateError) {
      return { ok: false, status: "error", error: updateError.message };
    }

    // If alias is active and the new alias name is also a canonical area, deactivate it
    const aliasIsActive = existing.active === true;
    if (nameChanged && aliasIsActive) {
      await adminSupabase
        .from("areas")
        .update({ active: false, updated_at: nowIso })
        .eq("area_name", normalizedNew)
        .eq("active", true);
    }

    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames({ force: true });
    if (!reconcileResult.ok) {
      return { ok: false, status: "error", error: reconcileResult.error };
    }

    const currentActive = aliasIsActive ? "yes" : "no";
    return {
      ok: true,
      status: "success",
      alias: { AliasName: normalizedNew, CanonicalArea: normalizedCanonical, Active: currentActive },
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to update area alias",
    };
  }
}

// ---------------------------------------------------------------------------
// WRITE — admin_toggle_area_alias
// ---------------------------------------------------------------------------

export async function toggleAreaAliasInSupabase(params: {
  aliasName: string;
  active: string;
}): Promise<AreaAliasMutateResult> {
  try {
    const normalizedAlias = normalizeAreaName(params.aliasName);
    if (!normalizedAlias) {
      return { ok: false, status: "error", error: "AliasName required" };
    }

    const nextActive = String(params.active || "").trim().toLowerCase() === "yes";

    const { data: existing, error: fetchError } = await adminSupabase
      .from("area_aliases")
      .select("alias_name, canonical_area, active")
      .ilike("alias_name", normalizedAlias)
      .maybeSingle();

    if (fetchError) {
      return { ok: false, status: "error", error: fetchError.message };
    }
    if (!existing) {
      return { ok: false, status: "error", error: "Alias not found" };
    }

    const nowIso = new Date().toISOString();

    const { error: updateError } = await adminSupabase
      .from("area_aliases")
      .update({ active: nextActive, updated_at: nowIso })
      .ilike("alias_name", normalizedAlias);

    if (updateError) {
      return { ok: false, status: "error", error: updateError.message };
    }

    // Mirror GAS: alias active → deactivate canonical of same name; alias inactive → activate it
    await adminSupabase
      .from("areas")
      .update({ active: !nextActive, updated_at: nowIso })
      .eq("area_name", normalizeAreaName(existing.alias_name));

    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames({ force: true });
    if (!reconcileResult.ok) {
      return { ok: false, status: "error", error: reconcileResult.error };
    }

    return {
      ok: true,
      status: "success",
      alias: {
        AliasName: normalizeAreaName(existing.alias_name),
        CanonicalArea: normalizeAreaName(existing.canonical_area),
        Active: nextActive ? "yes" : "no",
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err instanceof Error ? err.message : "Failed to toggle area alias",
    };
  }
}
