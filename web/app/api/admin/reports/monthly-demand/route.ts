import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/reports/monthly-demand?month=YYYY-MM
//
// Read-only management report driven entirely off the Supabase tasks
// table + region mapping. No mutations. Categories, areas, regions
// are derived from real rows — nothing is hardcoded.
//
// Source tables:
//   - tasks                      — created_at, category, area, status
//   - service_region_areas       — canonical_area → region_code
//   - service_region_area_aliases — alias        → canonical_area, region_code
//   - service_regions            — region_code   → region_name
//   - pending_category_requests  — new-category requests this month
//   - notification_logs (optional context for future iterations)
//
// Caps:
//   The report scans up to REPORT_TASK_LIMIT tasks for the requested
//   month. The Kaun Karega volume is well below this today; the cap
//   guards against a runaway month.

const REPORT_TASK_LIMIT = 100_000;
const UNMAPPED_REGION = "Unmapped";

type AreaResolution = {
  canonicalArea: string;
  region: string;
};

function normalizeAreaKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

// Validate a `month` parameter in YYYY-MM. Returns { startIso, endIso,
// monthKey } when valid; null when missing or malformed.
function parseMonthParam(
  raw: string | null
): { monthKey: string; startIso: string; endIso: string } | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    monthKey: `${match[1]}-${match[2]}`,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  // Default to "this month" in UTC when caller omits the param.
  let monthParam = url.searchParams.get("month");
  if (!monthParam) {
    const today = new Date();
    monthParam = `${today.getUTCFullYear()}-${String(
      today.getUTCMonth() + 1
    ).padStart(2, "0")}`;
  }
  const range = parseMonthParam(monthParam);
  if (!range) {
    return NextResponse.json(
      {
        success: false,
        error: "month must be in YYYY-MM format",
      },
      { status: 400 }
    );
  }

  // Five parallel reads — analytics scan + region mapping + PCRs.
  const [
    tasksRes,
    regionAreasRes,
    regionAliasesRes,
    regionsRes,
    pcrRes,
  ] = await Promise.all([
    adminSupabase
      .from("tasks")
      .select("created_at, category, area, status")
      .gte("created_at", range.startIso)
      .lt("created_at", range.endIso)
      .limit(REPORT_TASK_LIMIT),
    adminSupabase
      .from("service_region_areas")
      .select("canonical_area, region_code, active")
      .eq("active", true),
    adminSupabase
      .from("service_region_area_aliases")
      .select("alias, canonical_area, region_code, active")
      .eq("active", true),
    adminSupabase
      .from("service_regions")
      .select("region_code, region_name, active")
      .eq("active", true),
    adminSupabase
      .from("pending_category_requests")
      .select("id, requested_category, created_at, status")
      .gte("created_at", range.startIso)
      .lt("created_at", range.endIso),
  ]);

  if (tasksRes.error) {
    console.error(
      "[admin/reports/monthly-demand] tasks read failed:",
      tasksRes.error
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch tasks for month" },
      { status: 500 }
    );
  }

  const regionNameByCode = new Map<string, string>();
  for (const row of (regionsRes.data ?? []) as Array<{
    region_code: string | null;
    region_name: string | null;
  }>) {
    const code = String(row.region_code ?? "").trim();
    const name = strOrNull(row.region_name);
    if (code && name) regionNameByCode.set(code, name);
  }

  const areaResolver = new Map<string, AreaResolution>();
  for (const row of (regionAreasRes.data ?? []) as Array<{
    canonical_area: string | null;
    region_code: string | null;
  }>) {
    const canonical = strOrNull(row.canonical_area);
    if (!canonical) continue;
    const code = String(row.region_code ?? "").trim();
    const region = code
      ? regionNameByCode.get(code) ?? UNMAPPED_REGION
      : UNMAPPED_REGION;
    areaResolver.set(normalizeAreaKey(canonical), {
      canonicalArea: canonical,
      region,
    });
  }
  for (const row of (regionAliasesRes.data ?? []) as Array<{
    alias: string | null;
    canonical_area: string | null;
    region_code: string | null;
  }>) {
    const alias = strOrNull(row.alias);
    const canonical = strOrNull(row.canonical_area);
    if (!alias || !canonical) continue;
    const code = String(row.region_code ?? "").trim();
    const region = code
      ? regionNameByCode.get(code) ?? UNMAPPED_REGION
      : UNMAPPED_REGION;
    areaResolver.set(normalizeAreaKey(alias), {
      canonicalArea: canonical,
      region,
    });
  }

  const tasks = (tasksRes.data ?? []) as Array<{
    created_at: string | null;
    category: string | null;
    area: string | null;
    status: string | null;
  }>;

  let totalKaam = 0;
  let noProviderMatchedCount = 0;
  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<
    string,
    { area: string; region: string; count: number }
  >();
  const regionCounts = new Map<string, number>();
  const regionCategoryCounts = new Map<string, number>(); // key `${region}::${category}`

  for (const task of tasks) {
    totalKaam += 1;
    const category = strOrNull(task.category);
    const area = strOrNull(task.area);
    const status = String(task.status ?? "").trim().toLowerCase();
    if (status === "no_providers_matched") noProviderMatchedCount += 1;

    if (category) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }

    if (area) {
      const resolved = areaResolver.get(normalizeAreaKey(area)) ?? {
        canonicalArea: area,
        region: UNMAPPED_REGION,
      };
      const bucketKey = normalizeAreaKey(resolved.canonicalArea);
      const existing = areaCounts.get(bucketKey);
      if (existing) {
        existing.count += 1;
      } else {
        areaCounts.set(bucketKey, {
          area: resolved.canonicalArea,
          region: resolved.region,
          count: 1,
        });
      }
      regionCounts.set(
        resolved.region,
        (regionCounts.get(resolved.region) ?? 0) + 1
      );
      if (category) {
        const k = `${resolved.region}::${category}`;
        regionCategoryCounts.set(k, (regionCategoryCounts.get(k) ?? 0) + 1);
      }
    }
  }

  const categoryDemand = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      percentage:
        totalKaam > 0
          ? Math.round((count / totalKaam) * 1000) / 10
          : 0,
    }));

  const areaDemand = Array.from(areaCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((row) => ({
      area: row.area,
      region: row.region,
      count: row.count,
    }));

  const regionDemand = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ region, count }));

  const regionCategoryDemand = Array.from(regionCategoryCounts.entries())
    .map(([key, count]) => {
      const idx = key.indexOf("::");
      const region = idx >= 0 ? key.slice(0, idx) : key;
      const category = idx >= 0 ? key.slice(idx + 2) : "";
      return { region, category, count };
    })
    .sort((a, b) => b.count - a.count);

  const newCategoryRequestsCount = (
    (pcrRes.data ?? []) as Array<{ status: string | null }>
  ).filter((row) => String(row.status ?? "").toLowerCase() !== "rejected")
    .length;

  const operationalIssues: Array<{
    type: string;
    count: number;
    note: string;
  }> = [];
  if (noProviderMatchedCount > 0) {
    operationalIssues.push({
      type: "no_providers_matched",
      count: noProviderMatchedCount,
      note: "Tasks created this month that found no eligible providers.",
    });
  }
  if (newCategoryRequestsCount > 0) {
    operationalIssues.push({
      type: "new_category_requests",
      count: newCategoryRequestsCount,
      note: "Categories requested this month that needed admin review.",
    });
  }

  return NextResponse.json({
    success: true,
    month: range.monthKey,
    summary: {
      totalKaam,
      topCategory: categoryDemand[0]?.category ?? null,
      topArea: areaDemand[0]?.area ?? null,
      topRegion: regionDemand[0]?.region ?? null,
      noProviderMatchedCount,
      newCategoryRequestsCount,
    },
    categoryDemand,
    areaDemand,
    regionDemand,
    regionCategoryDemand,
    operationalIssues,
  });
}
