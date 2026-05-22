import { adminSupabase } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import {
  resolveCityParam,
  InvalidCityCodeError,
} from "@/lib/cities/cityContext";

// Sandbox-only Area Intelligence resolver.
// Does NOT touch live matching, provider registration, homepage search,
// /api/find-provider, or the existing areas / area_aliases tables.
// It resolves a free-text area string against the new
// service_region_areas + service_region_area_aliases + service_regions
// tables so we can iterate on a region-aware model in isolation.

export const runtime = "nodejs";

// Hard ceiling for in-JS comparison sets. Tables are small today (regions
// in the tens, areas/aliases in the low thousands at most), but capping
// keeps a pathological row count from blowing the response budget.
const MAX_ROWS = 5000;

// Input + stored values run through the same pipeline so the comparison
// is symmetric:
//   trim → lowercase → "-" and "_" → " " → collapse whitespace runs.
// Deliberately conservative: no abbreviation expansion (rd→road), no
// fuzzy/prefix matching. This is exact equality on a normalized form.
function normalizeAreaInput(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawInput = url.searchParams.get("query") || "";
  const normalizedInput = normalizeAreaInput(rawInput);

  if (!normalizedInput) {
    return NextResponse.json(
      { ok: false, input: rawInput, error: "Missing query parameter" },
      { status: 400 }
    );
  }

  // Phase 1.1: resolution is now strictly city-scoped. A bad ?city= is a
  // 400 (resolve is a precision endpoint — silent fallback would mask
  // misconfigured callers).
  let cityCode: string;
  try {
    const r = await resolveCityParam(url, { fallback: "reject" });
    cityCode = r.city_code;
  } catch (e) {
    if (e instanceof InvalidCityCodeError) {
      return NextResponse.json(
        { ok: false, input: rawInput, error: "INVALID_CITY_CODE" },
        { status: 400 }
      );
    }
    throw e;
  }

  try {
    // Phase A3: preload active region codes so alias and canonical-area
    // hits whose parent region is inactive are skipped. The region match
    // path below already gates on service_regions.active=true; this set
    // makes the alias and canonical paths consistent with it.
    const { data: activeRegions, error: activeRegionsErr } = await adminSupabase
      .from("service_regions")
      .select("region_code")
      .eq("active", true)
      .eq("city_code", cityCode)
      .limit(1000);
    if (activeRegionsErr) {
      console.error(
        "[area-intelligence/resolve] active-regions preload failed",
        activeRegionsErr
      );
      return NextResponse.json(
        { ok: false, input: rawInput, error: "Region lookup failed" },
        { status: 500 }
      );
    }
    const activeRegionCodes = new Set<string>();
    for (const r of activeRegions ?? []) {
      const rc = String(
        (r as { region_code?: unknown }).region_code ?? ""
      ).trim();
      if (rc) activeRegionCodes.add(rc);
    }

    // 1) Alias path — normalized(alias) === normalizedInput, active = true.
    const { data: aliasRows, error: aliasError } = await adminSupabase
      .from("service_region_area_aliases")
      .select("alias, canonical_area, region_code, active")
      .eq("active", true)
      .eq("city_code", cityCode)
      .limit(MAX_ROWS);

    if (aliasError) {
      console.error("[area-intelligence/resolve] alias query failed", aliasError);
      return NextResponse.json(
        { ok: false, input: rawInput, error: "Alias lookup failed" },
        { status: 500 }
      );
    }

    const aliasHit = (aliasRows ?? []).find(
      (row) =>
        // Phase A3: skip aliases whose parent region is inactive.
        activeRegionCodes.has(String(row.region_code ?? "").trim()) &&
        normalizeAreaInput(row.alias) === normalizedInput
    );

    if (aliasHit) {
      const regionName = await fetchRegionName(aliasHit.region_code);
      return NextResponse.json({
        ok: true,
        input: rawInput,
        match_type: "alias",
        alias: aliasHit.alias,
        canonical_area: aliasHit.canonical_area,
        region_code: aliasHit.region_code,
        region_name: regionName,
        city_code: cityCode,
      });
    }

    // 2) Canonical-area path — normalized(canonical_area) === normalizedInput.
    const { data: areaRows, error: areaError } = await adminSupabase
      .from("service_region_areas")
      .select("canonical_area, region_code, active")
      .eq("active", true)
      .eq("city_code", cityCode)
      .limit(MAX_ROWS);

    if (areaError) {
      console.error("[area-intelligence/resolve] canonical query failed", areaError);
      return NextResponse.json(
        { ok: false, input: rawInput, error: "Canonical area lookup failed" },
        { status: 500 }
      );
    }

    const areaHit = (areaRows ?? []).find(
      (row) =>
        // Phase A3: skip canonical areas whose parent region is inactive.
        activeRegionCodes.has(String(row.region_code ?? "").trim()) &&
        normalizeAreaInput(row.canonical_area) === normalizedInput
    );

    if (areaHit) {
      const regionName = await fetchRegionName(areaHit.region_code);
      return NextResponse.json({
        ok: true,
        input: rawInput,
        match_type: "canonical_area",
        canonical_area: areaHit.canonical_area,
        region_code: areaHit.region_code,
        region_name: regionName,
        city_code: cityCode,
      });
    }

    // 3) Region path — normalized(region_name) === normalizedInput.
    const { data: regionRows, error: regionError } = await adminSupabase
      .from("service_regions")
      .select("region_code, region_name, active")
      .eq("active", true)
      .eq("city_code", cityCode)
      .limit(MAX_ROWS);

    if (regionError) {
      console.error("[area-intelligence/resolve] region query failed", regionError);
      return NextResponse.json(
        { ok: false, input: rawInput, error: "Region lookup failed" },
        { status: 500 }
      );
    }

    const regionHit = (regionRows ?? []).find(
      (row) => normalizeAreaInput(row.region_name) === normalizedInput
    );

    if (regionHit) {
      return NextResponse.json({
        ok: true,
        input: rawInput,
        match_type: "region",
        canonical_area: null,
        region_code: regionHit.region_code,
        region_name: regionHit.region_name,
        city_code: cityCode,
      });
    }

    // 4) No match.
    return NextResponse.json({
      ok: false,
      input: rawInput,
      city_code: cityCode,
      error: "No area intelligence match found",
    });
  } catch (err: any) {
    console.error("[area-intelligence/resolve] unexpected error", err);
    return NextResponse.json(
      {
        ok: false,
        input: rawInput,
        error: err?.message || "Unexpected error",
      },
      { status: 500 }
    );
  }
}

async function fetchRegionName(regionCode: string): Promise<string | null> {
  if (!regionCode) return null;
  const { data, error } = await adminSupabase
    .from("service_regions")
    .select("region_name")
    .eq("region_code", regionCode)
    .maybeSingle();
  if (error) {
    console.warn(
      "[area-intelligence/resolve] region_name lookup failed",
      regionCode,
      error
    );
    return null;
  }
  return data?.region_name ?? null;
}
