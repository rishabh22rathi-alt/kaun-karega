import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getProviderByPhoneFromSupabase } from "@/lib/admin/adminProviderReads";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// City-wide analytics are expensive (full 365-day task scan + per-category
// aggregation) and change slowly relative to the dashboard refresh rate. A
// small in-memory TTL cache amortizes the cost across provider sessions
// without affecting provider-specific sensitive fields (profile, matches,
// area_review_queue). Caches reset on every server restart/redeploy, so
// stale risk is bounded by CITY_ANALYTICS_TTL_MS and any code change.
const CITY_ANALYTICS_TTL_MS = 60_000;
const AREA_DEMAND_CACHE_MAX_ENTRIES = 64;

type CategoryDemandCacheEntry = {
  data: CategoryDemandByRange;
  expiresAt: number;
};

type AreaCountsCacheEntry = {
  counts: Array<{ areaName: string; count: number }>;
  expiresAt: number;
};

let categoryDemandCache: CategoryDemandCacheEntry | null = null;
const areaDemandCountsCache = new Map<string, AreaCountsCacheEntry>();

function categoriesCacheKey(categories: string[]): string {
  return Array.from(
    new Set((categories || []).map((c) => String(c || "").trim()).filter((c) => c.length > 0))
  )
    .sort()
    .join("|");
}

const PERF_DEBUG = process.env.NODE_ENV !== "production";

function perfMark(): number {
  return Date.now();
}

function perfLog(phase: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!PERF_DEBUG) return;
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[provider/dashboard-profile] perf ${phase} ${elapsedMs}ms${
      extra ? ` ${JSON.stringify(extra)}` : ""
    }`
  );
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

type ProviderMetrics = {
  TotalRequestsInMyCategories: number;
  TotalRequestsMatchedToMe: number;
  TotalRequestsRespondedByMe: number;
  TotalRequestsAcceptedByMe: number;
  TotalRequestsCompletedByMe: number;
  ResponseRate: number;
  AcceptanceRate: number;
};

type AreaDemandRow = {
  AreaName: string;
  RequestCount: number;
  IsSelectedByProvider?: boolean;
};

type CategoryDemandRow = {
  CategoryName: string;
  RequestCount: number;
};

type CategoryDemandByRange = {
  today: CategoryDemandRow[];
  last7Days: CategoryDemandRow[];
  last30Days: CategoryDemandRow[];
  last365Days: CategoryDemandRow[];
};

type ProviderCoverageArea = {
  Area: string;
  Status: string;
};

type ProviderPendingAreaRequest = {
  RequestedArea: string;
  Status: string;
  LastSeenAt: string;
};

type ProviderResolvedAreaRequest = {
  RequestedArea: string;
  ResolvedCanonicalArea: string;
  CoverageActive: boolean;
  Status: string;
  ResolvedAt: string;
};

type ProviderAreaCoverage = {
  ActiveApprovedAreas: ProviderCoverageArea[];
  PendingAreaRequests: ProviderPendingAreaRequest[];
  ResolvedOutcomes: ProviderResolvedAreaRequest[];
};

const EMPTY_AREA_COVERAGE: ProviderAreaCoverage = {
  ActiveApprovedAreas: [],
  PendingAreaRequests: [],
  ResolvedOutcomes: [],
};

type TaskCategoryTimestampRow = {
  category?: string | null;
  created_at?: string | null;
};

const EMPTY_CATEGORY_DEMAND_BY_RANGE: CategoryDemandByRange = {
  today: [],
  last7Days: [],
  last30Days: [],
  last365Days: [],
};

type RecentMatchedRequest = {
  TaskID: string;
  DisplayID: string;
  Category: string;
  Area: string;
  Details: string;
  CreatedAt: string;
  Accepted: boolean;
  Responded: boolean;
  ThreadID: string;
  Status: string;
  SelectedTimeframe: string;
  ServiceDate: string;
  TimeSlot: string;
};

type ProviderTaskMatchRow = {
  task_id?: string | null;
  match_status?: string | null;
  category?: string | null;
  area?: string | null;
  created_at?: string | null;
};

type TaskLookupRow = {
  task_id?: string | number | null;
  display_id?: string | number | null;
  category?: string | null;
  area?: string | null;
  details?: string | null;
  selected_timeframe?: string | null;
  created_at?: string | null;
  status?: string | null;
  service_date?: string | null;
  time_slot?: string | null;
};

const EMPTY_PROVIDER_METRICS: ProviderMetrics = {
  TotalRequestsInMyCategories: 0,
  TotalRequestsMatchedToMe: 0,
  TotalRequestsRespondedByMe: 0,
  TotalRequestsAcceptedByMe: 0,
  TotalRequestsCompletedByMe: 0,
  ResponseRate: 0,
  AcceptanceRate: 0,
};

// Aggregated provider metrics straight from Supabase. All five counts run in
// parallel via head-only count queries (no row payloads transferred). Any
// individual query failure is logged and its count is coerced to 0, so one
// missing/denied table never zeroes out the whole panel.
async function getProviderMetricsFromSupabase(
  supabase: ServerSupabase,
  providerId: string,
  categories: string[]
): Promise<ProviderMetrics> {
  if (!providerId) return EMPTY_PROVIDER_METRICS;

  const categoryList = Array.from(
    new Set(
      (categories || [])
        .map((c) => String(c || "").trim())
        .filter((c) => c.length > 0)
    )
  );

  const categoriesCountPromise =
    categoryList.length > 0
      ? supabase
          .from("tasks")
          .select("task_id", { count: "exact", head: true })
          .in("category", categoryList)
      : Promise.resolve({ count: 0, error: null } as {
          count: number | null;
          error: unknown;
        });

  const matchedCountPromise = supabase
    .from("provider_task_matches")
    .select("task_id", { count: "exact", head: true })
    .eq("provider_id", providerId);

  const respondedCountPromise = supabase
    .from("provider_task_matches")
    .select("task_id", { count: "exact", head: true })
    .eq("provider_id", providerId)
    .in("match_status", ["responded", "accepted"]);

  const acceptedCountPromise = supabase
    .from("tasks")
    .select("task_id", { count: "exact", head: true })
    .eq("assigned_provider_id", providerId);

  const completedCountPromise = supabase
    .from("tasks")
    .select("task_id", { count: "exact", head: true })
    .eq("assigned_provider_id", providerId)
    .in("status", ["closed", "completed"]);

  const [
    categoriesCountResult,
    matchedCountResult,
    respondedCountResult,
    acceptedCountResult,
    completedCountResult,
  ] = await Promise.all([
    categoriesCountPromise,
    matchedCountPromise,
    respondedCountPromise,
    acceptedCountPromise,
    completedCountPromise,
  ]);

  const readCount = (
    result: { count?: number | null; error?: unknown },
    label: string
  ): number => {
    if (result?.error) {
      const msg =
        result.error instanceof Error
          ? result.error.message
          : typeof result.error === "object" && result.error && "message" in result.error
            ? String((result.error as { message?: unknown }).message || "")
            : String(result.error);
      console.warn("[provider/dashboard-profile] metric query failed", { label, error: msg });
      return 0;
    }
    return Number(result?.count || 0);
  };

  const totalRequestsInMyCategories = readCount(categoriesCountResult, "TotalRequestsInMyCategories");
  const totalRequestsMatchedToMe = readCount(matchedCountResult, "TotalRequestsMatchedToMe");
  const totalRequestsRespondedByMe = readCount(respondedCountResult, "TotalRequestsRespondedByMe");
  const totalRequestsAcceptedByMe = readCount(acceptedCountResult, "TotalRequestsAcceptedByMe");
  const totalRequestsCompletedByMe = readCount(completedCountResult, "TotalRequestsCompletedByMe");

  const responseRate =
    totalRequestsMatchedToMe > 0
      ? Math.round((totalRequestsRespondedByMe / totalRequestsMatchedToMe) * 100)
      : 0;
  const acceptanceRate =
    totalRequestsMatchedToMe > 0
      ? Math.round((totalRequestsAcceptedByMe / totalRequestsMatchedToMe) * 100)
      : 0;

  return {
    TotalRequestsInMyCategories: totalRequestsInMyCategories,
    TotalRequestsMatchedToMe: totalRequestsMatchedToMe,
    TotalRequestsRespondedByMe: totalRequestsRespondedByMe,
    TotalRequestsAcceptedByMe: totalRequestsAcceptedByMe,
    TotalRequestsCompletedByMe: totalRequestsCompletedByMe,
    ResponseRate: responseRate,
    AcceptanceRate: acceptanceRate,
  };
}

// City-wide category demand, bucketed by four time ranges. Single query over
// the widest window (365 days) avoids N round-trips — rows are bucketed in
// memory against each range's start timestamp. Draft tasks are excluded (and
// rows with NULL status are kept, since .neq('status','draft') would drop
// them in Postgres three-valued logic).
async function getCategoryDemandByRangeFromSupabase(
  supabase: ServerSupabase,
  options: { bypassCache?: boolean } = {}
): Promise<CategoryDemandByRange> {
  const now = Date.now();

  // Serve from the city-wide TTL cache when fresh. Keys are not provider-
  // specific because this aggregate is identical across all providers.
  // E2E fixtures insert synthetic tasks just before calling this endpoint
  // and assert they appear immediately; bypass the cache for them.
  if (!options.bypassCache && categoryDemandCache && categoryDemandCache.expiresAt > now) {
    perfLog("categoryDemand cache-hit", now);
    return categoryDemandCache.data;
  }

  const startOfTodayMs = (() => {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const last7DaysMs = now - 7 * 24 * 60 * 60 * 1000;
  const last30DaysMs = now - 30 * 24 * 60 * 60 * 1000;
  const last365DaysMs = now - 365 * 24 * 60 * 60 * 1000;

  const since365Iso = new Date(last365DaysMs).toISOString();

  const queryStart = perfMark();
  const { data, error } = await supabase
    .from("tasks")
    .select("category, created_at")
    .gte("created_at", since365Iso)
    .or("status.is.null,status.neq.draft")
    .limit(10000);
  perfLog("categoryDemand query", queryStart, { rows: Array.isArray(data) ? data.length : 0 });

  if (error) {
    console.warn(
      "[provider/dashboard-profile] category demand query failed",
      error.message || error
    );
    return EMPTY_CATEGORY_DEMAND_BY_RANGE;
  }

  const rows: TaskCategoryTimestampRow[] = Array.isArray(data)
    ? (data as TaskCategoryTimestampRow[])
    : [];

  const todayCounts = new Map<string, number>();
  const last7Counts = new Map<string, number>();
  const last30Counts = new Map<string, number>();
  const last365Counts = new Map<string, number>();

  for (const row of rows) {
    const category = String(row.category || "").trim();
    if (!category) continue;

    const createdAt = String(row.created_at || "").trim();
    const createdMs = Date.parse(createdAt);
    if (!Number.isFinite(createdMs)) continue;

    if (createdMs >= last365DaysMs) {
      last365Counts.set(category, (last365Counts.get(category) || 0) + 1);
    }
    if (createdMs >= last30DaysMs) {
      last30Counts.set(category, (last30Counts.get(category) || 0) + 1);
    }
    if (createdMs >= last7DaysMs) {
      last7Counts.set(category, (last7Counts.get(category) || 0) + 1);
    }
    if (createdMs >= startOfTodayMs) {
      todayCounts.set(category, (todayCounts.get(category) || 0) + 1);
    }
  }

  const toSortedRows = (counts: Map<string, number>): CategoryDemandRow[] =>
    [...counts.entries()]
      .map(([CategoryName, RequestCount]) => ({ CategoryName, RequestCount }))
      .sort((a, b) => {
        if (b.RequestCount !== a.RequestCount) return b.RequestCount - a.RequestCount;
        return a.CategoryName.localeCompare(b.CategoryName);
      });

  const computed: CategoryDemandByRange = {
    today: toSortedRows(todayCounts),
    last7Days: toSortedRows(last7Counts),
    last30Days: toSortedRows(last30Counts),
    last365Days: toSortedRows(last365Counts),
  };

  categoryDemandCache = { data: computed, expiresAt: Date.now() + CITY_ANALYTICS_TTL_MS };
  return computed;
}

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function maskPhone(phone10: string): string {
  if (!phone10) return "-";
  return `******${phone10.slice(-4)}`;
}

function normalizeKey(value: string): string {
  return String(value || "").trim().toLowerCase();
}

// Provider-specific area coverage: currently-approved areas, pending admin
// review items, and resolved outcomes. Active areas come directly from the
// caller's providerAreas (already fetched for the dashboard). Pending and
// resolved rows come from area_review_queue scoped to this provider's
// registration. CoverageActive for resolved rows is derived locally by
// checking whether the resolved canonical area matches one of the provider's
// approved areas (normalized). Any query error degrades to empty pending/
// resolved arrays — never crashes the dashboard.
async function getProviderAreaCoverageFromSupabase(
  supabase: ServerSupabase,
  providerId: string,
  providerAreas: string[]
): Promise<ProviderAreaCoverage> {
  const activeApprovedAreas: ProviderCoverageArea[] = providerAreas
    .map((area) => String(area || "").trim())
    .filter((area) => area.length > 0)
    .map((area) => ({ Area: area, Status: "active" }));

  if (!providerId) {
    return { ...EMPTY_AREA_COVERAGE, ActiveApprovedAreas: activeApprovedAreas };
  }

  const activeAreaKeys = new Set(
    providerAreas.map(normalizeKey).filter((key) => key.length > 0)
  );

  type ReviewRow = {
    raw_area?: string | null;
    status?: string | null;
    last_seen_at?: string | null;
    resolved_canonical_area?: string | null;
    resolved_at?: string | null;
  };

  let reviewRows: ReviewRow[] = [];

  try {
    const { data, error } = await supabase
      .from("area_review_queue")
      .select("raw_area, status, last_seen_at, resolved_canonical_area, resolved_at")
      .eq("source_type", "provider_register")
      .eq("source_ref", providerId)
      .in("status", ["pending", "resolved"])
      .limit(500);

    if (error) {
      console.warn(
        "[provider/dashboard-profile] area_review_queue query failed",
        error.message || error
      );
    } else if (Array.isArray(data)) {
      reviewRows = data as ReviewRow[];
    }
  } catch (err) {
    console.warn(
      "[provider/dashboard-profile] area_review_queue exception",
      err instanceof Error ? err.message : err
    );
  }

  const pendingAreaRequests: ProviderPendingAreaRequest[] = [];
  const resolvedOutcomes: ProviderResolvedAreaRequest[] = [];

  for (const row of reviewRows) {
    const status = String(row.status || "").trim().toLowerCase();
    const rawArea = String(row.raw_area || "").trim();
    if (!rawArea) continue;

    if (status === "pending") {
      pendingAreaRequests.push({
        RequestedArea: rawArea,
        Status: status,
        LastSeenAt: String(row.last_seen_at || "").trim(),
      });
    } else if (status === "resolved") {
      const dbCanonical = String(row.resolved_canonical_area || "").trim();
      const coverageActive =
        dbCanonical.length > 0 && activeAreaKeys.has(normalizeKey(dbCanonical));
      // Translate DB vocabulary into the UI's expected Status. The DB only
      // writes `status = "resolved"`; the dashboard UI renders the raw→canonical
      // arrow form only when Status === "mapped". Treat a resolved row that
      // carries a canonical as a mapping outcome. Rejections (empty canonical)
      // fall back to raw_area so the outcome card still renders something
      // meaningful instead of an empty label.
      const isMapping = dbCanonical.length > 0 && normalizeKey(dbCanonical) !== normalizeKey(rawArea);
      const outcomeStatus = isMapping ? "mapped" : status;
      const outcomeCanonical = dbCanonical.length > 0 ? dbCanonical : rawArea;
      resolvedOutcomes.push({
        RequestedArea: rawArea,
        ResolvedCanonicalArea: outcomeCanonical,
        CoverageActive: coverageActive,
        Status: outcomeStatus,
        ResolvedAt: String(row.resolved_at || "").trim(),
      });
    }
  }

  pendingAreaRequests.sort((a, b) => {
    const ta = Date.parse(a.LastSeenAt) || 0;
    const tb = Date.parse(b.LastSeenAt) || 0;
    if (ta !== tb) return tb - ta;
    return a.RequestedArea.localeCompare(b.RequestedArea);
  });
  resolvedOutcomes.sort((a, b) => {
    const ta = Date.parse(a.ResolvedAt) || 0;
    const tb = Date.parse(b.ResolvedAt) || 0;
    if (ta !== tb) return tb - ta;
    return a.RequestedArea.localeCompare(b.RequestedArea);
  });

  return {
    ActiveApprovedAreas: activeApprovedAreas,
    PendingAreaRequests: pendingAreaRequests,
    ResolvedOutcomes: resolvedOutcomes,
  };
}

// City-wide area demand for the provider's service categories. Sources from
// tasks (not provider_task_matches) because match rows only exist after the
// matching pipeline runs — we need raw incoming request volume per area for
// the provider's categories. SelectedAreaDemand = AreaDemand restricted to
// the provider's selected areas (no zero-filling: UI shows the empty-state
// when a selected area has no demand).
// City-wide area-count aggregation keyed by the provider's service category
// list. Category-keyed (not provider-keyed) because the counts are identical
// for any two providers who share the same service set. Cached for
// CITY_ANALYTICS_TTL_MS; the per-provider "IsSelectedByProvider" decoration
// is applied by the caller on each request against fresh provider_areas.
async function getAreaDemandCountsByCategories(
  supabase: ServerSupabase,
  categoryList: string[],
  options: { bypassCache?: boolean } = {}
): Promise<Array<{ areaName: string; count: number }>> {
  const key = categoriesCacheKey(categoryList);
  if (!key) return [];

  const now = Date.now();
  if (!options.bypassCache) {
    const hit = areaDemandCountsCache.get(key);
    if (hit && hit.expiresAt > now) {
      perfLog("areaDemand cache-hit", now, { key });
      return hit.counts;
    }
  }

  const queryStart = perfMark();
  const { data, error } = await supabase
    .from("tasks")
    .select("area, status")
    .in("category", categoryList)
    .limit(10000);
  perfLog("areaDemand query", queryStart, {
    rows: Array.isArray(data) ? data.length : 0,
    categories: categoryList.length,
  });

  if (error) {
    console.warn(
      "[provider/dashboard-profile] area demand query failed",
      error.message || error
    );
    return [];
  }

  const rows: Array<{ area?: string | null; status?: string | null }> = Array.isArray(data)
    ? (data as Array<{ area?: string | null; status?: string | null }>)
    : [];

  const countsByArea = new Map<string, number>();
  for (const row of rows) {
    if (String(row.status || "").trim().toLowerCase() === "draft") continue;
    const area = String(row.area || "").trim();
    if (!area) continue;
    countsByArea.set(area, (countsByArea.get(area) || 0) + 1);
  }

  const counts = [...countsByArea.entries()].map(([areaName, count]) => ({ areaName, count }));

  if (areaDemandCountsCache.size >= AREA_DEMAND_CACHE_MAX_ENTRIES) {
    // Simple FIFO eviction — drop the oldest insertion to keep memory bounded.
    const firstKey = areaDemandCountsCache.keys().next().value;
    if (firstKey) areaDemandCountsCache.delete(firstKey);
  }
  areaDemandCountsCache.set(key, { counts, expiresAt: Date.now() + CITY_ANALYTICS_TTL_MS });

  return counts;
}

async function getAreaDemandFromSupabase(
  supabase: ServerSupabase,
  categories: string[],
  providerAreas: string[],
  options: { bypassCache?: boolean } = {}
): Promise<{ areaDemand: AreaDemandRow[]; selectedAreaDemand: AreaDemandRow[] }> {
  const categoryList = Array.from(
    new Set(
      (categories || [])
        .map((c) => String(c || "").trim())
        .filter((c) => c.length > 0)
    )
  );

  if (categoryList.length === 0) {
    return { areaDemand: [], selectedAreaDemand: [] };
  }

  const cityCounts = await getAreaDemandCountsByCategories(supabase, categoryList, options);

  const selectedAreaKeys = new Set(
    providerAreas.map((area) => normalizeKey(area)).filter((area) => area.length > 0)
  );

  const areaDemand: AreaDemandRow[] = cityCounts
    .map(({ areaName, count }) => ({
      AreaName: areaName,
      RequestCount: count,
      IsSelectedByProvider: selectedAreaKeys.has(normalizeKey(areaName)),
    }))
    .sort((a, b) => {
      if (b.RequestCount !== a.RequestCount) return b.RequestCount - a.RequestCount;
      return a.AreaName.localeCompare(b.AreaName);
    });

  return {
    areaDemand,
    selectedAreaDemand: areaDemand.filter((item) => item.IsSelectedByProvider),
  };
}

function buildRecentMatchedRequests(
  matchRows: ProviderTaskMatchRow[],
  tasksById: Map<string, TaskLookupRow>
): RecentMatchedRequest[] {
  return matchRows
    .map((row) => {
      const taskId = String(row.task_id || "").trim();
      if (!taskId) return null;

      const task = tasksById.get(taskId);
      const status = String(row.match_status || "").trim().toLowerCase();
      const createdAt = String(task?.created_at || row.created_at || "").trim();

      return {
        TaskID: taskId,
        DisplayID:
          task?.display_id !== null && task?.display_id !== undefined
            ? String(task.display_id).trim()
            : "",
        Category: String(task?.category || row.category || "").trim(),
        Area: String(task?.area || row.area || "").trim(),
        Details: String(task?.details || "").trim(),
        CreatedAt: createdAt,
        Accepted: status === "accepted",
        Responded: status === "responded" || status === "accepted",
        ThreadID: "",
        Status: String(task?.status || "").trim(),
        SelectedTimeframe: String(task?.selected_timeframe || "").trim(),
        ServiceDate: String(task?.service_date || "").trim(),
        TimeSlot: String(task?.time_slot || "").trim(),
      };
    })
    .filter((item): item is RecentMatchedRequest => item !== null && item.TaskID.length > 0)
    .sort((a, b) => {
      const ta = Date.parse(a.CreatedAt || "") || 0;
      const tb = Date.parse(b.CreatedAt || "") || 0;
      return tb - ta;
    })
    .slice(0, 20);
}

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  const session = getAuthSession({ cookie: cookieHeader });
  const rawSessionPhone = String(session?.phone || "");
  const normalizedPhone = normalizePhone10(rawSessionPhone);

  console.log("[provider/dashboard-profile] auth debug", {
    cookieNames,
    session: session
      ? {
          phoneMasked: maskPhone(normalizedPhone),
          verified: session.verified,
          createdAt: session.createdAt,
        }
      : null,
    rawSessionPhone,
    normalizedPhone,
  });

  if (!session || !normalizedPhone) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED_PROVIDER_SESSION",
        message: "Provider session missing or invalid. Please log in again.",
      },
      { status: 401 }
    );
  }

  const handlerStart = perfMark();
  try {
    const providerLookupStart = perfMark();
    const providerIdentity = await getProviderByPhoneFromSupabase(rawSessionPhone || normalizedPhone);
    const { data: provider, error: providerError } =
      providerIdentity.ok && providerIdentity.provider.ProviderID
        ? await adminSupabase
            .from("providers")
            .select("*")
            .eq("provider_id", providerIdentity.provider.ProviderID)
            .maybeSingle()
        : { data: null, error: null };
    perfLog("provider lookup", providerLookupStart);

    console.log("[provider/dashboard-profile] supabase provider response", {
      ok: !providerError,
      provider: provider
        ? {
            ProviderID: String(provider.provider_id || ""),
            Phone: String(provider.phone || ""),
          }
        : null,
      error: providerError?.message || null,
    });

    if (providerError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_REQUEST_FAILED",
          message: providerError.message || "Failed to load provider dashboard.",
        },
        { status: 500 }
      );
    }

    if (!provider) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_FAILED",
          message: "Logged-in provider profile could not be found for this phone number.",
          debug: {
            normalizedPhone,
          },
        },
        { status: 404 }
      );
    }

    const supabase = await createClient();

    const matchedPhone = normalizePhone10(String(provider.phone || ""));
    if (matchedPhone !== normalizedPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_PHONE_MISMATCH",
          message: "Provider lookup returned a mismatched phone number.",
          debug: {
            requestedPhone: normalizedPhone,
            matchedPhone,
            providerId: String(provider.provider_id || ""),
          },
        },
        { status: 409 }
      );
    }

    // These three provider-scoped lookups are independent — issue them in
    // parallel instead of three sequential round-trips. provider_task_matches
    // is non-fatal (warned + coerced to []), services/areas are required.
    const providerScopedStart = perfMark();
    const [servicesResult, areasResult, matchesResult] = await Promise.all([
      supabase
        .from("provider_services")
        .select("category")
        .eq("provider_id", provider.provider_id),
      supabase
        .from("provider_areas")
        .select("area")
        .eq("provider_id", provider.provider_id),
      supabase
        .from("provider_task_matches")
        .select("task_id, match_status, category, area, created_at")
        .eq("provider_id", provider.provider_id),
    ]);
    perfLog("provider-scoped parallel", providerScopedStart);

    const { data: providerServices, error: servicesError } = servicesResult;
    if (servicesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_SERVICES_LOOKUP_FAILED",
          message: servicesError.message || "Failed to load provider services.",
        },
        { status: 500 }
      );
    }

    const { data: providerAreas, error: areasError } = areasResult;
    if (areasError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_AREAS_LOOKUP_FAILED",
          message: areasError.message || "Failed to load provider areas.",
        },
        { status: 500 }
      );
    }

    const { data: matchRows, error: matchesError } = matchesResult;
    if (matchesError) {
      console.warn(
        "[provider/dashboard-profile] matches lookup failed",
        matchesError.message || matchesError
      );
    }

    const providerCategoryList = Array.isArray(providerServices)
      ? providerServices
          .map((item) => String(item.category || "").trim())
          .filter((c) => c.length > 0)
      : [];
    const providerAreaList = Array.isArray(providerAreas)
      ? providerAreas
          .map((item) => String(item.area || "").trim())
          .filter((area) => area.length > 0)
      : [];

    let metrics: ProviderMetrics = EMPTY_PROVIDER_METRICS;
    let categoryDemandByRange: CategoryDemandByRange = EMPTY_CATEGORY_DEMAND_BY_RANGE;
    let areaDemand: AreaDemandRow[] = [];
    let selectedAreaDemand: AreaDemandRow[] = [];
    let areaCoverage: ProviderAreaCoverage = {
      ...EMPTY_AREA_COVERAGE,
      ActiveApprovedAreas: providerAreaList.map((area) => ({ Area: area, Status: "active" })),
    };
    // E2E fixtures always use ZZ-prefixed provider IDs and insert dummy
    // city-wide tasks just before asserting on the API payload. Bypass the
    // TTL cache for them so they observe their own writes. Real providers
    // (no ZZ- prefix) get the full caching benefit.
    const isTestProvider = String(provider.provider_id || "").startsWith("ZZ-");
    const cacheOptions = { bypassCache: isTestProvider };

    const analyticsStart = perfMark();
    const [
      metricsResult,
      categoryDemandResult,
      areaDemandResult,
      areaCoverageResult,
    ] = await Promise.allSettled([
      getProviderMetricsFromSupabase(
        supabase,
        String(provider.provider_id || ""),
        providerCategoryList
      ),
      getCategoryDemandByRangeFromSupabase(supabase, cacheOptions),
      getAreaDemandFromSupabase(
        supabase,
        providerCategoryList,
        providerAreaList,
        cacheOptions
      ),
      getProviderAreaCoverageFromSupabase(
        supabase,
        String(provider.provider_id || ""),
        providerAreaList
      ),
    ]);
    perfLog("analytics parallel block", analyticsStart, { isTestProvider });

    if (metricsResult.status === "fulfilled") {
      metrics = metricsResult.value;
    } else {
      console.warn(
        "[provider/dashboard-profile] metrics compute failed",
        metricsResult.reason instanceof Error
          ? metricsResult.reason.message
          : metricsResult.reason
      );
    }

    if (categoryDemandResult.status === "fulfilled") {
      categoryDemandByRange = categoryDemandResult.value;
    } else {
      console.warn(
        "[provider/dashboard-profile] category demand compute failed",
        categoryDemandResult.reason instanceof Error
          ? categoryDemandResult.reason.message
          : categoryDemandResult.reason
      );
    }

    if (areaDemandResult.status === "fulfilled") {
      areaDemand = areaDemandResult.value.areaDemand;
      selectedAreaDemand = areaDemandResult.value.selectedAreaDemand;
    } else {
      console.warn(
        "[provider/dashboard-profile] area demand compute failed",
        areaDemandResult.reason instanceof Error
          ? areaDemandResult.reason.message
          : areaDemandResult.reason
      );
    }

    if (areaCoverageResult.status === "fulfilled") {
      areaCoverage = areaCoverageResult.value;
    } else {
      console.warn(
        "[provider/dashboard-profile] area coverage compute failed",
        areaCoverageResult.reason instanceof Error
          ? areaCoverageResult.reason.message
          : areaCoverageResult.reason
      );
    }

    const safeMatches: ProviderTaskMatchRow[] = Array.isArray(matchRows)
      ? (matchRows as ProviderTaskMatchRow[])
      : [];
    const taskIds = Array.from(
      new Set(
        safeMatches
          .map((row) => String(row.task_id || "").trim())
          .filter((taskId) => taskId.length > 0)
      )
    );
    const tasksById = new Map<string, TaskLookupRow>();

    if (taskIds.length > 0) {
      const tasksLookupStart = perfMark();
      const { data: taskRows, error: tasksError } = await supabase
        .from("tasks")
        .select(
          "task_id, display_id, category, area, details, selected_timeframe, created_at, status, service_date, time_slot"
        )
        .in("task_id", taskIds);
      perfLog("recent-matched tasks lookup", tasksLookupStart, { taskIds: taskIds.length });

      if (tasksError) {
        console.warn(
          "[provider/dashboard-profile] task lookup for matched requests failed",
          tasksError.message || tasksError
        );
      } else {
        for (const row of Array.isArray(taskRows) ? (taskRows as TaskLookupRow[]) : []) {
          const taskId = String(row.task_id || "").trim();
          if (!taskId) continue;
          tasksById.set(taskId, row);
        }
      }
    }

    const recentMatchedRequests = buildRecentMatchedRequests(safeMatches, tasksById);

    // Derive per-service approval status: "approved" if the category is in the
    // active master list, "pending" if a pending_category_requests row exists
    // for this provider, otherwise "inactive". Two reads in parallel; if
    // either errors, every service defaults to "approved" (fail-open — never
    // downgrade an existing approved chip on a transient DB blip).
    const [activeCategoriesResult, pendingCategoryRequestsResult] = await Promise.all([
      adminSupabase.from("categories").select("name").eq("active", true),
      adminSupabase
        .from("pending_category_requests")
        .select("requested_category")
        .eq("provider_id", String(provider.provider_id || ""))
        .eq("status", "pending"),
    ]);

    if (activeCategoriesResult.error) {
      console.warn(
        "[provider/dashboard-profile] active categories lookup failed",
        activeCategoriesResult.error.message || activeCategoriesResult.error
      );
    }
    if (pendingCategoryRequestsResult.error) {
      console.warn(
        "[provider/dashboard-profile] pending category requests lookup failed",
        pendingCategoryRequestsResult.error.message || pendingCategoryRequestsResult.error
      );
    }

    const serviceStatusLookupsFailed = Boolean(
      activeCategoriesResult.error || pendingCategoryRequestsResult.error
    );
    const activeCategoryKeys = new Set(
      (activeCategoriesResult.data || [])
        .map((row) => String((row as { name?: unknown }).name || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const pendingCategoryKeys = new Set(
      (pendingCategoryRequestsResult.data || [])
        .map((row) =>
          String((row as { requested_category?: unknown }).requested_category || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );

    perfLog("handler total", handlerStart);
    return NextResponse.json({
      ok: true,
      provider: {
        ProviderID: String(provider.provider_id || ""),
        ProviderName: String(provider.full_name || ""),
        Phone: String(provider.phone || ""),
        Verified: String(provider.verified || ""),
        OtpVerified: "yes",
        OtpVerifiedAt: new Date(session.createdAt).toISOString(),
        LastLoginAt: String(provider.created_at || ""),
        PendingApproval: String(provider.status || "").trim().toLowerCase() === "pending" ? "yes" : "no",
        Status: String(provider.status || ""),
        DuplicateNameReviewStatus: String(provider.duplicate_name_review_status || ""),
        Services: Array.isArray(providerServices)
          ? providerServices.map((item) => {
              const category = String(item.category || "");
              const key = category.trim().toLowerCase();
              let Status: "approved" | "pending" | "inactive" = "approved";
              if (!serviceStatusLookupsFailed) {
                if (!activeCategoryKeys.has(key)) {
                  Status = pendingCategoryKeys.has(key) ? "pending" : "inactive";
                }
              }
              return { Category: category, Status };
            })
          : [],
        Areas: Array.isArray(providerAreas)
          ? providerAreas.map((item) => ({
              Area: String(item.area || ""),
            }))
          : [],
        AreaCoverage: areaCoverage,
        Analytics: {
          Summary: {
            ProviderID: String(provider.provider_id || ""),
            Categories: providerCategoryList,
            Areas: providerAreaList,
          },
          AreaDemand: areaDemand,
          SelectedAreaDemand: selectedAreaDemand,
          CategoryDemandByRange: categoryDemandByRange,
          RecentMatchedRequests: recentMatchedRequests,
          Metrics: metrics,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PROVIDER_LOOKUP_REQUEST_FAILED",
        message: error?.message || "Failed to load provider dashboard.",
      },
      { status: 500 }
    );
  }
}
