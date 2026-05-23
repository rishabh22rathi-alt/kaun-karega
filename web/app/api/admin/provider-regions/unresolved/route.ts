import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/adminAuth";
import {
  resolveAreasToRegions,
  type AreaRegionResolution,
} from "@/lib/geo/areaRegionResolver";

// Admin Provider Area Resolution Center — classified list endpoint.
//
// Reads provider_areas rows where city_code='JOD' AND region_code IS NULL,
// aggregates by normalized area key, then runs them through the Phase 2
// resolver to classify each aggregate into one of two buckets:
//
//   • autoResolvable — resolver returns resolved=true. These rows can be
//     allocated to a region without any catalog change; the admin just
//     needs to click "Allocate". Surfaces region_code + canonical_area
//     + match_type so the UI can render the target without re-resolving.
//
//   • needsReview — resolver returns unresolved OR ambiguous. The admin
//     must Map-as-alias / Create-canonical / Ignore to resolve.
//
// Aggregates whose normalized_key appears in area_review_queue with
// status='ignored' are filtered out of both buckets and counted in
// summary.ignoredRows. Use ?includeIgnored=true to also return them.
//
// Pure read-only. Auth-gated to admins. No cache.

export const runtime = "nodejs";

const CITY_CODE = "JOD";
const PAGE_SIZE = 1000;
const MAX_SAMPLE_PROVIDERS = 5;

type ProviderAreaRow = {
  provider_id: string;
  area: string;
};

function normalizeAreaName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toAreaKey(value: unknown): string {
  return normalizeAreaName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchAllNullRegionRows(): Promise<
  { ok: true; rows: ProviderAreaRow[] } | { ok: false; error: string }
> {
  const out: ProviderAreaRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await adminSupabase
      .from("provider_areas")
      .select("provider_id, area")
      .eq("city_code", CITY_CODE)
      .is("region_code", null)
      .order("area", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, error: error.message };
    const chunk = (data ?? []) as ProviderAreaRow[];
    for (const r of chunk) {
      out.push({
        provider_id: String(r.provider_id ?? "").trim(),
        area: String(r.area ?? ""),
      });
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { ok: true, rows: out };
}

type Aggregate = {
  raw_area: string;
  normalized_key: string;
  count: number;
  providerIds: Set<string>;
};

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const rowsRes = await fetchAllNullRegionRows();
  if (!rowsRes.ok) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: rowsRes.error },
      { status: 500 }
    );
  }

  // Ignored set: any queue row whose status='ignored' (admin previously
  // marked the area outside service area).
  const ignoredKeys = new Set<string>();
  try {
    const { data: ignoredRows } = await adminSupabase
      .from("area_review_queue")
      .select("normalized_key")
      .eq("status", "ignored");
    for (const row of (ignoredRows ?? []) as Array<{
      normalized_key: string | null;
    }>) {
      const k = String(row.normalized_key ?? "").trim();
      if (k) ignoredKeys.add(k);
    }
  } catch {
    // best-effort
  }

  // Aggregate every NULL row by normalized_key. Track ignored rows
  // separately so summary.ignoredRows is accurate.
  const byKey = new Map<string, Aggregate>();
  let ignoredRowCount = 0;
  for (const r of rowsRes.rows) {
    const key = toAreaKey(r.area);
    if (!key) continue;
    if (ignoredKeys.has(key)) {
      ignoredRowCount += 1;
      continue;
    }
    const display = normalizeAreaName(r.area) || r.area;
    const agg = byKey.get(key) ?? {
      raw_area: display,
      normalized_key: key,
      count: 0,
      providerIds: new Set<string>(),
    };
    if (display.length > agg.raw_area.length) {
      agg.raw_area = display;
    }
    agg.count += 1;
    if (r.provider_id && agg.providerIds.size < MAX_SAMPLE_PROVIDERS) {
      agg.providerIds.add(r.provider_id);
    }
    byKey.set(key, agg);
  }

  // Run the resolver ONCE for the deduped set. Catalog read is O(1)
  // regardless of how many distinct areas there are.
  const distinctAreas = Array.from(byKey.values()).map((a) => a.raw_area);
  const resolutions: Map<string, AreaRegionResolution> =
    distinctAreas.length === 0
      ? new Map()
      : await resolveAreasToRegions(adminSupabase, {
          areas: distinctAreas,
          cityCode: CITY_CODE,
        });

  type AutoResolvableRow = {
    area: string;
    normalized_key: string;
    count: number;
    region_code: string;
    canonical_area: string;
    match_type: "canonical" | "alias";
    sample_provider_ids: string[];
  };

  type NeedsReviewRow = {
    area: string;
    normalized_key: string;
    count: number;
    reason: "unresolved" | "ambiguous";
    sample_provider_ids: string[];
  };

  const autoResolvable: AutoResolvableRow[] = [];
  const needsReview: NeedsReviewRow[] = [];
  let autoResolvableRowCount = 0;
  let reviewNeededRowCount = 0;
  let ambiguousRowCount = 0;

  for (const agg of byKey.values()) {
    const r = resolutions.get(agg.raw_area);
    const sample = Array.from(agg.providerIds);
    if (r && r.resolved) {
      autoResolvable.push({
        area: agg.raw_area,
        normalized_key: agg.normalized_key,
        count: agg.count,
        region_code: r.region_code,
        canonical_area: r.canonical_area,
        match_type: r.match_type,
        sample_provider_ids: sample,
      });
      autoResolvableRowCount += agg.count;
    } else {
      // No resolver entry (empty string filtered upstream) OR explicit
      // unresolved/ambiguous. Treat the "no entry" case as unresolved.
      const reason: "unresolved" | "ambiguous" =
        r && r.reason === "ambiguous" ? "ambiguous" : "unresolved";
      needsReview.push({
        area: agg.raw_area,
        normalized_key: agg.normalized_key,
        count: agg.count,
        reason,
        sample_provider_ids: sample,
      });
      reviewNeededRowCount += agg.count;
      if (reason === "ambiguous") ambiguousRowCount += agg.count;
    }
  }

  // Sort: highest impact first. Within auto-resolvable, group by region
  // for readability (still count-desc tiebreaker).
  autoResolvable.sort((a, b) => {
    if (a.region_code !== b.region_code) {
      return a.region_code.localeCompare(b.region_code);
    }
    if (a.count !== b.count) return b.count - a.count;
    return a.area.localeCompare(b.area);
  });
  needsReview.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.area.localeCompare(b.area);
  });

  return NextResponse.json({
    ok: true,
    autoResolvable,
    needsReview,
    summary: {
      totalNullRows: rowsRes.rows.length,
      autoResolvableRows: autoResolvableRowCount,
      reviewNeededRows: reviewNeededRowCount,
      ambiguousRows: ambiguousRowCount,
      ignoredRows: ignoredRowCount,
      distinctAutoResolvableAreas: autoResolvable.length,
      distinctNeedsReviewAreas: needsReview.length,
    },
  });
}
