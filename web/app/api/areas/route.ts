import { NextResponse } from "next/server";
import {
  canonicalizeProviderAreasToCanonicalNames,
  listActiveCanonicalAreas,
} from "@/lib/admin/adminAreaMappings";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  getDefaultCityCode,
  resolveCityParam,
  InvalidCityCodeError,
} from "@/lib/cities/cityContext";

const CACHE_TTL_MS = 5 * 60 * 1000;

// Cap on rows pulled for the service_region_areas union. The table is in
// the low hundreds today; the cap keeps the response bounded if it grows.
const SERVICE_REGION_AREAS_LIMIT = 5000;

type AreasCache = {
  expiresAt: number;
  areas: string[];
};

// Phase 1.1 — cache is now city-keyed. Each city resolves to a different
// merged list (legacy + service_region_areas filtered to the city), so a
// single cache entry would poison cross-city callers. Bounded at 10
// entries to keep the working set tiny even if a future homepage runs an
// "all cities" sweep.
const MAX_CITY_CACHE_ENTRIES = 10;
const areasCacheByCity = new Map<string, AreasCache>();

// Mirrors lib/admin/adminAreaMappings.ts so the same canonical
// (e.g. "high-court road" vs "High Court Road") collapses to one key.
// Inlined intentionally — the Phase 2 brief forbids modifying the
// helper module. Identical semantics; behavior is unchanged.
function normalizeAreaName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function toAreaKey(value: unknown): string {
  return normalizeAreaName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Union: legacy `areas` (via listActiveCanonicalAreas) extended with all
// active `service_region_areas.canonical_area` rows. Provider-coverage is
// NOT a precondition for surfacing — admins manage areas in
// service_region_areas independently of provider onboarding, and homepage
// area suggestions must reflect the canonical area catalogue, not the
// current provider footprint.
//
// Failure isolation: if the union read fails, we log and return the
// legacy list alone. /api/areas continues to serve the pre-union set.
//
// Phase 1.1: scoped to a single city. Parent-region preload and the
// canonical-area read both filter on city_code so a multi-city future
// keeps the response correct without further changes here.
async function fetchServiceRegionAreaExtras(
  legacyKeys: Set<string>,
  cityCode: string
): Promise<string[]> {
  try {
    // Phase A3: preload the set of active region codes so canonical
    // areas whose parent region is inactive don't leak into the public
    // autocomplete. If the regions read itself fails, fall back to the
    // legacy list alone — never serve an unfiltered new-table union.
    const { data: regionRows, error: regionErr } = await adminSupabase
      .from("service_regions")
      .select("region_code")
      .eq("active", true)
      .eq("city_code", cityCode)
      .limit(1000);
    if (regionErr) {
      console.warn(
        "[areas API] service_regions read failed; falling back to legacy list only",
        regionErr
      );
      return [];
    }
    const activeRegionCodes = new Set<string>();
    for (const r of regionRows ?? []) {
      const rc = String(
        (r as { region_code?: unknown }).region_code ?? ""
      ).trim();
      if (rc) activeRegionCodes.add(rc);
    }

    const { data, error } = await adminSupabase
      .from("service_region_areas")
      .select("canonical_area, region_code, active")
      .eq("active", true)
      .eq("city_code", cityCode)
      .limit(SERVICE_REGION_AREAS_LIMIT);

    if (error) {
      console.warn(
        "[areas API] service_region_areas read failed; falling back to legacy list only",
        error
      );
      return [];
    }

    const extras: string[] = [];
    const seen = new Set<string>(legacyKeys);
    for (const row of data ?? []) {
      const r = row as { canonical_area?: unknown; region_code?: unknown };
      const rc = String(r.region_code ?? "").trim();
      // Phase A3: drop areas whose parent region is inactive.
      if (!rc || !activeRegionCodes.has(rc)) continue;
      const name = normalizeAreaName(r.canonical_area);
      const k = toAreaKey(name);
      if (!name || !k) continue;
      // Dedupe against the legacy list AND prior extras — legacy display
      // name wins on collision; among service_region_areas duplicates,
      // first occurrence wins.
      if (seen.has(k)) continue;
      seen.add(k);
      extras.push(name);
    }
    return extras;
  } catch (err) {
    console.warn(
      "[areas API] service_region_areas union threw; serving legacy only",
      err
    );
    return [];
  }
}

async function fetchAllAreas(cityCode: string): Promise<string[]> {
  const now = Date.now();
  const cached = areasCacheByCity.get(cityCode);
  if (cached && cached.expiresAt > now) {
    return cached.areas;
  }

  // Phase 1.1: the canonicalization side effect is intentionally city-blind.
  // It rewrites `provider_areas` against the legacy `areas` / `area_aliases`
  // tables — neither has a city_code column, and adding one here would
  // silently change which providers get reconciled. Keep it untouched.
  const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
  if (!reconcileResult.ok) {
    throw new Error(reconcileResult.error);
  }

  // Legacy `areas` / `area_aliases` carry NO city_code. They are
  // historically Jodhpur-only, so for the default city we include them
  // as before; for any non-default city the legacy list is empty.
  // Today JOD is the only active city, so default-city callers see the
  // exact same legacy data they saw pre-Phase-1.1.
  const defaultCity = await getDefaultCityCode();
  const legacyAreas =
    cityCode === defaultCity ? await listActiveCanonicalAreas() : [];

  // Build a key Set for the legacy list so the union can dedupe against
  // it cheaply. Keep the existing display name (legacy wins on collision).
  const legacyKeys = new Set<string>();
  for (const name of legacyAreas) {
    const k = toAreaKey(name);
    if (k) legacyKeys.add(k);
  }

  const serviceRegionExtras = await fetchServiceRegionAreaExtras(
    legacyKeys,
    cityCode
  );

  // Preserve the helper's ascending sort: legacy was sorted on `area_name`
  // ASC at fetch time. Sort the combined list alphabetically so newly
  // unioned names interleave naturally.
  const merged = [...legacyAreas, ...serviceRegionExtras].sort((a, b) =>
    a.localeCompare(b)
  );

  // FIFO trim before insert keeps the cache bounded even under a pathological
  // sequence of distinct city params.
  if (areasCacheByCity.size >= MAX_CITY_CACHE_ENTRIES) {
    const oldestKey = areasCacheByCity.keys().next().value;
    if (oldestKey !== undefined) areasCacheByCity.delete(oldestKey);
  }
  areasCacheByCity.set(cityCode, {
    expiresAt: now + CACHE_TTL_MS,
    areas: merged,
  });

  return merged;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    // Missing/blank ?city= → default city. Malformed/inactive ?city= →
    // 400 so misconfigured callers fail loud rather than silently seeing
    // an unexpected city's data.
    let cityResolution;
    try {
      cityResolution = await resolveCityParam(url, { fallback: "reject" });
    } catch (e) {
      if (e instanceof InvalidCityCodeError) {
        return NextResponse.json(
          { ok: false, error: "INVALID_CITY_CODE", input: e.input },
          { status: 400 }
        );
      }
      throw e;
    }

    const allAreas = await fetchAllAreas(cityResolution.city_code);

    const filtered = q
      ? allAreas.filter((area) => {
          const lower = area.toLowerCase();
          return lower.startsWith(q) || lower.includes(q);
        })
      : allAreas;

    // Autocomplete callers (header search) cap to a small dropdown via `q`.
    // List callers (forms — e.g. /i-need/post) ask for the full canonical
    // list with no query and need every active area.
    const limited = q ? filtered.slice(0, 8) : filtered;

    return NextResponse.json({
      ok: true,
      areas: limited,
      city_code: cityResolution.city_code,
    });
  } catch (error: any) {
    console.error("[areas API] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load areas" },
      { status: 500 }
    );
  }
}
