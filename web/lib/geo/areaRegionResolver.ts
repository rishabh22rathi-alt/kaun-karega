import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only resolver. Maps a free-text provider area to a JOD service
// region by joining against service_region_areas (active canonicals) and
// service_region_area_aliases (active aliases), scoped to the caller's
// city_code.
//
// Phase 2 — Provider Region Allocation. This module is the single source
// of truth for "given an area string, which region does it belong to".
// Every provider_areas insert/update path calls this so the new
// provider_areas.region_code column (Phase 1 schema) gets populated
// consistently.
//
// Design notes:
//   • Reads only — never mutates the catalog.
//   • City-scoped — never crosses city boundaries.
//   • Canonical match short-circuits over alias (per spec).
//   • Multiple matches in either set → ambiguous (resolver does NOT
//     silently pick one — the caller decides what to do with NULL).
//   • Batched API loads the catalog ONCE per call; single API is a
//     convenience wrapper around the batch.

export type AreaRegionResolution =
  | {
      resolved: true;
      canonical_area: string;
      region_code: string;
      match_type: "canonical" | "alias";
    }
  | {
      resolved: false;
      reason: "unresolved" | "ambiguous";
    };

// Structural subset of SupabaseClient — accepts both the service-role
// adminSupabase and any cookie-scoped server client created via
// createClient(). Keeps callers from having to import the full
// SupabaseClient generic type.
type SupabaseLike = Pick<SupabaseClient, "from">;

function normalizeAreaName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Same shape as adminAreaMappings.ts:toAreaKey and the inlined helper in
// /api/provider/update — keeps fuzzy matching identical across the codebase.
function toAreaKey(value: unknown): string {
  return normalizeAreaName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

type CatalogEntry = { canonical_area: string; region_code: string };

type CityCatalog = {
  // Key (toAreaKey of canonical_area) → all matching region entries.
  // Length > 1 means the same normalized canonical text exists under
  // more than one region — caller treats as ambiguous.
  canonicalByKey: Map<string, CatalogEntry[]>;
  // Same shape for aliases. Alias text → list of region entries (whose
  // canonical_area is the alias's parent).
  aliasByKey: Map<string, CatalogEntry[]>;
};

async function loadCityCatalog(
  supabase: SupabaseLike,
  cityCode: string
): Promise<CityCatalog> {
  const safeCity = String(cityCode || "").trim().toUpperCase();

  const [canonicalRes, aliasRes] = await Promise.all([
    supabase
      .from("service_region_areas")
      .select("canonical_area, region_code, city_code, active")
      .eq("active", true)
      .limit(10000),
    supabase
      .from("service_region_area_aliases")
      .select("alias, canonical_area, region_code, city_code, active")
      .eq("active", true)
      .limit(10000),
  ]);

  const canonicalByKey = new Map<string, CatalogEntry[]>();
  for (const row of (canonicalRes.data ?? []) as Array<{
    canonical_area: string | null;
    region_code: string | null;
    city_code: string | null;
  }>) {
    // Skip rows from other cities. We filter post-fetch (rather than
    // adding .eq('city_code', …)) so a caller that passes an empty
    // cityCode still gets a usable catalog (today's single-city
    // deployment behaves identically either way).
    if (safeCity && String(row.city_code ?? "").trim().toUpperCase() !== safeCity) {
      continue;
    }
    const canonical = normalizeAreaName(row.canonical_area);
    const region = String(row.region_code ?? "").trim();
    const key = toAreaKey(canonical);
    if (!canonical || !region || !key) continue;
    const list = canonicalByKey.get(key) ?? [];
    if (!list.some((e) => e.region_code === region)) {
      list.push({ canonical_area: canonical, region_code: region });
    }
    canonicalByKey.set(key, list);
  }

  const aliasByKey = new Map<string, CatalogEntry[]>();
  for (const row of (aliasRes.data ?? []) as Array<{
    alias: string | null;
    canonical_area: string | null;
    region_code: string | null;
    city_code: string | null;
  }>) {
    if (safeCity && String(row.city_code ?? "").trim().toUpperCase() !== safeCity) {
      continue;
    }
    const aliasText = normalizeAreaName(row.alias);
    const canonical = normalizeAreaName(row.canonical_area);
    const region = String(row.region_code ?? "").trim();
    const key = toAreaKey(aliasText);
    if (!aliasText || !canonical || !region || !key) continue;
    const list = aliasByKey.get(key) ?? [];
    if (!list.some((e) => e.region_code === region)) {
      list.push({ canonical_area: canonical, region_code: region });
    }
    aliasByKey.set(key, list);
  }

  return { canonicalByKey, aliasByKey };
}

function resolveFromCache(area: string, cache: CityCatalog): AreaRegionResolution {
  const key = toAreaKey(area);
  if (!key) return { resolved: false, reason: "unresolved" };

  // Canonical match short-circuits, per spec: even if a same-key alias
  // also exists, the canonical wins. Multiple canonical matches are
  // ambiguous (do NOT fall through to alias).
  const canon = cache.canonicalByKey.get(key);
  if (canon && canon.length > 0) {
    if (canon.length === 1) {
      return {
        resolved: true,
        canonical_area: canon[0].canonical_area,
        region_code: canon[0].region_code,
        match_type: "canonical",
      };
    }
    return { resolved: false, reason: "ambiguous" };
  }

  const alias = cache.aliasByKey.get(key);
  if (alias && alias.length > 0) {
    if (alias.length === 1) {
      return {
        resolved: true,
        canonical_area: alias[0].canonical_area,
        region_code: alias[0].region_code,
        match_type: "alias",
      };
    }
    return { resolved: false, reason: "ambiguous" };
  }

  return { resolved: false, reason: "unresolved" };
}

// Single-area convenience wrapper. Loads the city catalog inline; if the
// caller is about to resolve multiple areas, prefer resolveAreasToRegions
// which loads the catalog ONCE.
export async function resolveAreaToRegion(
  supabase: SupabaseLike,
  args: { area: string; cityCode: string }
): Promise<AreaRegionResolution> {
  const cache = await loadCityCatalog(supabase, args.cityCode);
  return resolveFromCache(args.area, cache);
}

// Batched resolver. Returns a Map keyed by the raw area string AS PASSED
// (not by the normalized key) so callers can use the result with their
// original input list directly. Duplicates in the input are deduped on
// fetch; the returned Map has at most one entry per distinct raw value.
export async function resolveAreasToRegions(
  supabase: SupabaseLike,
  args: { areas: string[]; cityCode: string }
): Promise<Map<string, AreaRegionResolution>> {
  const out = new Map<string, AreaRegionResolution>();
  const distinct = Array.from(
    new Set(args.areas.map((a) => String(a ?? "")))
  ).filter((a) => a.length > 0);
  if (distinct.length === 0) return out;
  const cache = await loadCityCatalog(supabase, args.cityCode);
  for (const raw of distinct) {
    out.set(raw, resolveFromCache(raw, cache));
  }
  return out;
}
