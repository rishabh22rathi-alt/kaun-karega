import { NextResponse } from "next/server";
import {
  canonicalizeProviderAreasToCanonicalNames,
  listActiveCanonicalAreas,
} from "@/lib/admin/adminAreaMappings";
import { adminSupabase } from "@/lib/supabase/admin";

const CACHE_TTL_MS = 5 * 60 * 1000;

// Cap on rows pulled for the service_region_areas union. The table is in
// the low hundreds today; the cap keeps the response bounded if it grows.
const SERVICE_REGION_AREAS_LIMIT = 5000;

type AreasCache = {
  expiresAt: number;
  areas: string[];
};

let areasCache: AreasCache | null = null;

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
async function fetchServiceRegionAreaExtras(
  legacyKeys: Set<string>
): Promise<string[]> {
  try {
    const { data, error } = await adminSupabase
      .from("service_region_areas")
      .select("canonical_area, active")
      .eq("active", true)
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
      const name = normalizeAreaName(
        (row as { canonical_area?: unknown }).canonical_area
      );
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

async function fetchAllAreas(): Promise<string[]> {
  const now = Date.now();
  if (areasCache && areasCache.expiresAt > now) {
    return areasCache.areas;
  }

  const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
  if (!reconcileResult.ok) {
    throw new Error(reconcileResult.error);
  }

  const legacyAreas = await listActiveCanonicalAreas();

  // Build a key Set for the legacy list so the union can dedupe against
  // it cheaply. Keep the existing display name (legacy wins on collision).
  const legacyKeys = new Set<string>();
  for (const name of legacyAreas) {
    const k = toAreaKey(name);
    if (k) legacyKeys.add(k);
  }

  const serviceRegionExtras = await fetchServiceRegionAreaExtras(legacyKeys);

  // Preserve the helper's ascending sort: legacy was sorted on `area_name`
  // ASC at fetch time. Sort the combined list alphabetically so newly
  // unioned names interleave naturally.
  const merged = [...legacyAreas, ...serviceRegionExtras].sort((a, b) =>
    a.localeCompare(b)
  );

  areasCache = {
    expiresAt: now + CACHE_TTL_MS,
    areas: merged,
  };

  return merged;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const allAreas = await fetchAllAreas();

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
    });
  } catch (error: any) {
    console.error("[areas API] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load areas" },
      { status: 500 }
    );
  }
}
