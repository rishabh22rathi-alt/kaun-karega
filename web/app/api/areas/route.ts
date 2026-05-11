import { NextResponse } from "next/server";
import {
  canonicalizeProviderAreasToCanonicalNames,
  listActiveCanonicalAreas,
} from "@/lib/admin/adminAreaMappings";
import { adminSupabase } from "@/lib/supabase/admin";

const CACHE_TTL_MS = 5 * 60 * 1000;

// Cap on rows pulled for the Phase 2 union. service_region_areas is in
// the low hundreds today; provider_areas is in the low thousands. Caps
// here keep the response size bounded if either table grows pathologically.
const SERVICE_REGION_AREAS_LIMIT = 5000;
const PROVIDER_AREAS_LIMIT = 10000;

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

// Phase 2 union: legacy `areas` (via listActiveCanonicalAreas) extended
// with active `service_region_areas.canonical_area` rows that are ALSO
// served by at least one provider (case-insensitive match against
// `provider_areas.area`). The provider-coverage gate ensures we never
// surface a new homepage suggestion whose canonical can't be matched by
// /api/find-provider's ILIKE on provider_areas.
//
// Failure isolation: if either Phase 2 read fails, we log and return the
// legacy list alone. /api/areas continues to serve the pre-Phase-2 set.
async function fetchPhase2Extras(legacyKeys: Set<string>): Promise<string[]> {
  try {
    const [aiRes, provRes] = await Promise.all([
      adminSupabase
        .from("service_region_areas")
        .select("canonical_area, active")
        .eq("active", true)
        .limit(SERVICE_REGION_AREAS_LIMIT),
      adminSupabase
        .from("provider_areas")
        .select("area")
        .limit(PROVIDER_AREAS_LIMIT),
    ]);

    if (aiRes.error || provRes.error) {
      console.warn(
        "[areas API] Phase 2 union read failed; falling back to legacy list only",
        aiRes.error || provRes.error
      );
      return [];
    }

    const providerKeys = new Set<string>();
    for (const row of provRes.data ?? []) {
      const k = toAreaKey((row as { area?: unknown }).area);
      if (k) providerKeys.add(k);
    }

    const extras: string[] = [];
    const seen = new Set<string>(legacyKeys);
    for (const row of aiRes.data ?? []) {
      const name = normalizeAreaName(
        (row as { canonical_area?: unknown }).canonical_area
      );
      const k = toAreaKey(name);
      if (!name || !k) continue;
      // Dedupe against the legacy list — legacy display name wins.
      if (seen.has(k)) continue;
      // Safety gate: only surface if at least one provider serves it.
      if (!providerKeys.has(k)) continue;
      seen.add(k);
      extras.push(name);
    }
    return extras;
  } catch (err) {
    console.warn("[areas API] Phase 2 union threw; serving legacy only", err);
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

  const phase2Extras = await fetchPhase2Extras(legacyKeys);

  // Preserve the helper's ascending sort: legacy was sorted on `area_name`
  // ASC at fetch time. Sort the combined list alphabetically so newly
  // unioned names interleave naturally.
  const merged = [...legacyAreas, ...phase2Extras].sort((a, b) =>
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
