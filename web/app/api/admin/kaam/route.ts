import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  computeLifecycleStatus,
  LIFECYCLE_STEP,
  LIFECYCLE_TOTAL_STEPS,
  type LifecycleStatus,
} from "@/lib/admin/kaamLifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/kaam
//
// Admin feed of every created Kaam with a computed lifecycle label and
// a New-Service-Category attention flag. Read-only — no mutations to
// tasks / matches / notifications / chats / categories / pending_category_requests.
// The "both sides chatted → Completed/Closed" rule from the spec is
// display-only and never writes back.
//
// Lifecycle evidence sources (see web/lib/admin/kaamLifecycle.ts):
//   tasks.status / closed_at / closed_by / close_reason,
//   provider_task_matches.match_status,
//   notification_logs.status,
//   chat_messages.sender_type.
//
// New-Service-Category evidence — three OR'd signals:
//
//   1. tasks.status === "pending_category_review"
//      Literal value written by web/app/api/submit-approval-request/route.ts
//      whenever a user submits a request for a category that isn't on the
//      approved list. Authoritative for fresh rows.
//
//   2. A matching pending_category_requests row exists for the task's
//      user_phone + requested_category. Defensive — covers a hypothetical
//      future flow that creates the PCR row without flipping tasks.status.
//      Phones are compared on their last-10 digits because pcr.user_phone
//      is stored as session.phone (12-digit "91XXXXXXXXXX") while
//      tasks.phone is normalised to 10 digits at insert time. Only rows
//      with status="pending" count — approved/rejected PCRs are no longer
//      attention-worthy.
//
//   3. The task's category is not present in the active `categories`
//      set (case-insensitive). Catches legacy rows where tasks.status was
//      set to "submitted" before the category was later archived.
//
// All three are PURELY READ. This endpoint never inserts/updates/deletes.

const KAAM_LIMIT = 500;

// Upper bound on the analytics scan. Tasks.created_at + category are
// cheap reads; capping at 50k is well above expected growth for the
// next few quarters while still preventing a runaway response. If we
// ever exceed this, the `analyticsTruncated` flag in the response
// tells the UI so the dashboard can call out the cap.
const ANALYTICS_LIMIT = 50_000;

const NEW_SERVICE_CATEGORY_LABEL = "New Service Category";

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

type TaskRow = {
  task_id?: string | null;
  display_id?: string | number | null;
  phone?: string | null;
  category?: string | null;
  area?: string | null;
  status?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  close_reason?: string | null;
  selected_timeframe?: string | null;
};

type MatchRow = {
  task_id?: string | null;
  match_status?: string | null;
};

type NotificationRow = {
  task_id?: string | null;
  status?: string | null;
};

type MessageRow = {
  task_id?: string | null;
  sender_type?: string | null;
};

type PendingCategoryRequestRow = {
  user_phone?: string | null;
  requested_category?: string | null;
  status?: string | null;
};

type CategoryRow = {
  name?: string | null;
  active?: boolean | string | null;
};

type MonthlyKaamPoint = {
  month: string;
  monthKey: string;
  count: number;
};

type CategoryKaamPoint = {
  category: string;
  count: number;
  percentage: number;
};

type AreaCategoryDemandRow = {
  region: string;
  area: string;
  total: number;
  categories: Array<{ category: string; count: number }>;
};

// Bucket label for tasks whose area string doesn't resolve to a
// canonical region via service_region_areas / service_region_area_aliases.
// Surfaced as a normal region in the response so the admin still sees
// the demand it carries; the UI groups these under a visible "Unmapped"
// header.
const UNMAPPED_REGION = "Unmapped";

// Same area-text normaliser used by web/app/api/area-intelligence/resolve.
// Symmetric on both the alias side and the task.area side: trim,
// lowercase, collapse "-"/"_" to space, collapse whitespace runs.
function normalizeAreaKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type KaamResponseRow = {
  taskId: string;
  kaamNo: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  rawStatus: string | null;
  lifecycleStatus: LifecycleStatus;
  // 1-indexed step number for the progress badge in KaamTab. Matches
  // LIFECYCLE_STEP[lifecycleStatus] — kept on the response so the
  // frontend doesn't re-import the mapping.
  lifecycleStep: number;
  lifecycleTotalSteps: number;
  isNewServiceCategory: boolean;
  statusAttentionLabel: string | null;
  created_at: string | null;
  whenRequired: string | null;
};

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

// Resolved area entry — one per normalised raw-area key. canonicalArea
// is what the row is bucketed under; region is the resolved
// service_regions name or `UNMAPPED_REGION` when no mapping covers it.
type AreaResolution = {
  canonicalArea: string;
  region: string;
};

// Build the analytics aggregates from a flat (created_at, category, area)
// stream + a resolver from normalised raw-area key → canonical area +
// region. Pure — no DB calls.
function buildAnalytics(
  rows: Array<{
    created_at?: string | null;
    category?: string | null;
    area?: string | null;
  }>,
  areaResolver: Map<string, AreaResolution>
): {
  monthlyKaam: MonthlyKaamPoint[];
  categoryKaam: CategoryKaamPoint[];
  areaCategoryDemand: AreaCategoryDemandRow[];
  regionsCovered: number;
  areasCovered: number;
} {
  const monthCounts = new Map<string, { label: string; count: number }>();
  const categoryCounts = new Map<string, number>();
  // Per-canonical-area bucket: keyed by the normalized canonical area
  // (so "Sardar Pura" and "sardarpura-" land in the same bucket after
  // alias resolution). Each bucket carries display strings + per-
  // category counts.
  const areaCategoryCounts = new Map<
    string,
    {
      displayArea: string;
      region: string;
      total: number;
      categories: Map<string, number>;
    }
  >();
  let totalForPercentage = 0;

  for (const row of rows) {
    const created = strOrNull(row.created_at);
    if (created) {
      const ts = Date.parse(created);
      if (!Number.isNaN(ts)) {
        const date = new Date(ts);
        // monthKey is a sortable "YYYY-MM" — used both as the map key
        // and as the chronological sort field. Label is the human
        // string ("May 2026") rendered on the chart axis.
        const monthKey = `${date.getUTCFullYear()}-${String(
          date.getUTCMonth() + 1
        ).padStart(2, "0")}`;
        const label = MONTH_LABEL_FORMATTER.format(date);
        const existing = monthCounts.get(monthKey);
        if (existing) {
          existing.count += 1;
        } else {
          monthCounts.set(monthKey, { label, count: 1 });
        }
      }
    }
    const category = strOrNull(row.category);
    if (category) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      totalForPercentage += 1;
    }

    // Area × category demand. Resolve the raw task.area string through
    // the alias/canonical resolver first so "sardar pura" and the
    // canonical "Sardarpura" collapse into the same bucket. When the
    // resolver has no entry, fall back to the raw area as its own
    // canonical with region = UNMAPPED_REGION — the admin still sees
    // the demand, just flagged for region setup.
    const area = strOrNull(row.area);
    if (area && category) {
      const normalized = normalizeAreaKey(area);
      const resolved: AreaResolution = areaResolver.get(normalized) ?? {
        canonicalArea: area,
        region: UNMAPPED_REGION,
      };
      const bucketKey = normalizeAreaKey(resolved.canonicalArea);
      const bucket =
        areaCategoryCounts.get(bucketKey) ??
        (() => {
          const fresh = {
            displayArea: resolved.canonicalArea,
            region: resolved.region,
            total: 0,
            categories: new Map<string, number>(),
          };
          areaCategoryCounts.set(bucketKey, fresh);
          return fresh;
        })();
      bucket.total += 1;
      bucket.categories.set(
        category,
        (bucket.categories.get(category) ?? 0) + 1
      );
    }
  }

  const monthlyKaam: MonthlyKaamPoint[] = Array.from(monthCounts.entries())
    // Oldest → newest so the bar chart reads left-to-right as growth.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([monthKey, { label, count }]) => ({
      monthKey,
      month: label,
      count,
    }));

  const categoryKaam: CategoryKaamPoint[] = Array.from(
    categoryCounts.entries()
  )
    // Largest slice first — donut + legend read more naturally.
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      percentage:
        totalForPercentage > 0
          ? Math.round((count / totalForPercentage) * 1000) / 10
          : 0,
    }));

  // Sort: region asc (Unmapped last), then total demand desc within
  // region. Putting Unmapped at the bottom keeps admin focus on the
  // mapped regions while still surfacing the demand that needs setup.
  const areaCategoryDemand: AreaCategoryDemandRow[] = Array.from(
    areaCategoryCounts.values()
  )
    .sort((a, b) => {
      const aUnmapped = a.region === UNMAPPED_REGION;
      const bUnmapped = b.region === UNMAPPED_REGION;
      if (aUnmapped !== bUnmapped) return aUnmapped ? 1 : -1;
      if (a.region !== b.region) {
        return a.region < b.region ? -1 : 1;
      }
      if (a.total !== b.total) return b.total - a.total;
      return a.displayArea < b.displayArea ? -1 : 1;
    })
    .map((bucket) => ({
      region: bucket.region,
      area: bucket.displayArea,
      total: bucket.total,
      categories: Array.from(bucket.categories.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count })),
    }));

  const regionsCovered = new Set(
    areaCategoryDemand.map((row) => row.region)
  ).size;
  const areasCovered = areaCategoryDemand.length;

  return {
    monthlyKaam,
    categoryKaam,
    areaCategoryDemand,
    regionsCovered,
    areasCovered,
  };
}

function normalizePhone10(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function lowerKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isCategoryActive(row: CategoryRow): boolean {
  if (row.active === true) return true;
  if (typeof row.active === "string") {
    const v = row.active.trim().toLowerCase();
    return v === "yes" || v === "true";
  }
  return false;
}

function pickKaamNo(row: TaskRow): string | null {
  const displayRaw = row.display_id;
  if (
    displayRaw !== null &&
    displayRaw !== undefined &&
    String(displayRaw).trim()
  ) {
    return String(displayRaw).trim();
  }
  return strOrNull(row.task_id);
}

function groupByTaskId<T extends { task_id?: string | null }>(
  rows: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row.task_id ?? "").trim();
    if (!key) continue;
    const arr = map.get(key) ?? [];
    arr.push(row);
    map.set(key, arr);
  }
  return map;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Analytics scan — full task universe, but only the columns needed
  // for the month + category + area aggregates. Limit guards against
  // unbounded growth; the response surfaces `analyticsTruncated` so
  // the UI can footnote the chart if we ever hit it.
  //
  // Region mapping has three tables (all read here in parallel with
  // the analytics scan):
  //   service_region_areas        — canonical_area, region_code, active
  //   service_region_area_aliases — alias,         canonical_area + region_code, active
  //   service_regions             — region_code,   region_name, active
  // Aliases let the admin call "sardar pura" a synonym for canonical
  // "Sardarpura"; the demand matrix groups both under the canonical.
  // All four reads are non-fatal — failures degrade to UNMAPPED rows
  // rather than blanking the whole tile.
  const [analyticsRes, regionAreasRes, regionAliasesRes, regionsRes] =
    await Promise.all([
      adminSupabase
        .from("tasks")
        .select("created_at, category, area")
        .order("created_at", { ascending: false })
        .limit(ANALYTICS_LIMIT),
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
    ]);

  // head:true count — totalKaam reflects the full task universe, not
  // the windowed list returned below.
  const countRes = await adminSupabase
    .from("tasks")
    .select("task_id", { count: "exact", head: true });

  if (countRes.error) {
    console.error("[admin/kaam] tasks count error:", countRes.error);
    return NextResponse.json(
      { success: false, error: "Failed to count Kaam" },
      { status: 500 }
    );
  }
  const totalKaam = Number(countRes.count ?? 0);

  // Region-name lookup keyed by region_code.
  const regionNameByCode = new Map<string, string>();
  if (regionsRes.error) {
    console.warn(
      "[admin/kaam] service_regions read failed; areas will fall back to Unmapped",
      regionsRes.error
    );
  } else {
    for (const row of (regionsRes.data ?? []) as Array<{
      region_code: string | null;
      region_name: string | null;
    }>) {
      const code = String(row.region_code ?? "").trim();
      const name = strOrNull(row.region_name);
      if (code && name) regionNameByCode.set(code, name);
    }
  }

  // Build the master area resolver. Two passes:
  //   1. service_region_areas — every canonical area maps to itself
  //      (so a task.area that already matches a canonical resolves
  //      cleanly without going through the alias table).
  //   2. service_region_area_aliases — each alias maps to its
  //      canonical_area + region.
  // Alias rows win on collision because they're the more specific
  // mapping the admin explicitly created.
  const areaResolver = new Map<string, AreaResolution>();
  if (regionAreasRes.error) {
    console.warn(
      "[admin/kaam] service_region_areas read failed; canonical→canonical mappings skipped",
      regionAreasRes.error
    );
  } else {
    for (const row of (regionAreasRes.data ?? []) as Array<{
      canonical_area: string | null;
      region_code: string | null;
    }>) {
      const canonical = strOrNull(row.canonical_area);
      const code = String(row.region_code ?? "").trim();
      if (!canonical) continue;
      const region = code
        ? regionNameByCode.get(code) ?? UNMAPPED_REGION
        : UNMAPPED_REGION;
      areaResolver.set(normalizeAreaKey(canonical), {
        canonicalArea: canonical,
        region,
      });
    }
  }
  if (regionAliasesRes.error) {
    console.warn(
      "[admin/kaam] service_region_area_aliases read failed; alias→canonical resolution skipped",
      regionAliasesRes.error
    );
  } else {
    for (const row of (regionAliasesRes.data ?? []) as Array<{
      alias: string | null;
      canonical_area: string | null;
      region_code: string | null;
    }>) {
      const alias = strOrNull(row.alias);
      const canonical = strOrNull(row.canonical_area);
      const code = String(row.region_code ?? "").trim();
      if (!alias || !canonical) continue;
      const region = code
        ? regionNameByCode.get(code) ?? UNMAPPED_REGION
        : UNMAPPED_REGION;
      areaResolver.set(normalizeAreaKey(alias), {
        canonicalArea: canonical,
        region,
      });
    }
  }

  // Analytics — non-fatal. A failed read leaves the charts empty
  // rather than blanking the whole tile.
  let monthlyKaam: MonthlyKaamPoint[] = [];
  let categoryKaam: CategoryKaamPoint[] = [];
  let areaCategoryDemand: AreaCategoryDemandRow[] = [];
  let regionsCovered = 0;
  let areasCovered = 0;
  let analyticsTruncated = false;
  if (analyticsRes.error) {
    console.warn(
      "[admin/kaam] analytics scan failed; returning empty charts:",
      analyticsRes.error
    );
  } else {
    const rows = (analyticsRes.data ?? []) as Array<{
      created_at: string | null;
      category: string | null;
      area: string | null;
    }>;
    analyticsTruncated = rows.length >= ANALYTICS_LIMIT;
    const aggregates = buildAnalytics(rows, areaResolver);
    monthlyKaam = aggregates.monthlyKaam;
    categoryKaam = aggregates.categoryKaam;
    areaCategoryDemand = aggregates.areaCategoryDemand;
    regionsCovered = aggregates.regionsCovered;
    areasCovered = aggregates.areasCovered;
  }

  const listRes = await adminSupabase
    .from("tasks")
    .select(
      "task_id, display_id, phone, category, area, status, created_at, closed_at, closed_by, close_reason, selected_timeframe"
    )
    .order("created_at", { ascending: false })
    .limit(KAAM_LIMIT);

  if (listRes.error) {
    console.error("[admin/kaam] tasks list error:", listRes.error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch Kaam" },
      { status: 500 }
    );
  }

  const taskRows = (listRes.data ?? []) as TaskRow[];
  const taskIds = taskRows
    .map((row) => String(row.task_id ?? "").trim())
    .filter(Boolean);

  // Five reads run in parallel:
  //   - provider_task_matches / notification_logs / chat_messages back
  //     the lifecycle classifier.
  //   - categories backs the "category not in active set" signal.
  //   - pending_category_requests backs the "PCR row exists" signal.
  // All five are non-fatal — the per-task computation degrades to safe
  // defaults (lifecycle "Task Created", isNewServiceCategory false) when
  // a side read fails, so a transient outage on one table doesn't blank
  // out the whole tile.
  const [
    matchesRes,
    notificationsRes,
    messagesRes,
    categoriesRes,
    pcrRes,
  ] = await Promise.all([
    taskIds.length > 0
      ? adminSupabase
          .from("provider_task_matches")
          .select("task_id, match_status")
          .in("task_id", taskIds)
      : Promise.resolve({ data: [] as MatchRow[], error: null }),
    taskIds.length > 0
      ? adminSupabase
          .from("notification_logs")
          .select("task_id, status")
          .in("task_id", taskIds)
      : Promise.resolve({ data: [] as NotificationRow[], error: null }),
    taskIds.length > 0
      ? adminSupabase
          .from("chat_messages")
          .select("task_id, sender_type")
          .in("task_id", taskIds)
      : Promise.resolve({ data: [] as MessageRow[], error: null }),
    adminSupabase.from("categories").select("name, active"),
    adminSupabase
      .from("pending_category_requests")
      .select("user_phone, requested_category, status")
      .eq("status", "pending"),
  ]);

  if (matchesRes.error) {
    console.warn(
      "[admin/kaam] provider_task_matches fetch failed:",
      matchesRes.error
    );
  }
  if (notificationsRes.error) {
    console.warn(
      "[admin/kaam] notification_logs fetch failed:",
      notificationsRes.error
    );
  }
  if (messagesRes.error) {
    console.warn(
      "[admin/kaam] chat_messages fetch failed:",
      messagesRes.error
    );
  }
  if (categoriesRes.error) {
    console.warn(
      "[admin/kaam] categories fetch failed (new-service-category detection may degrade):",
      categoriesRes.error
    );
  }
  if (pcrRes.error) {
    console.warn(
      "[admin/kaam] pending_category_requests fetch failed (new-service-category detection may degrade):",
      pcrRes.error
    );
  }

  const matchesByTask = groupByTaskId<MatchRow>(
    (matchesRes.data ?? []) as MatchRow[]
  );
  const notificationsByTask = groupByTaskId<NotificationRow>(
    (notificationsRes.data ?? []) as NotificationRow[]
  );
  const messagesByTask = groupByTaskId<MessageRow>(
    (messagesRes.data ?? []) as MessageRow[]
  );

  // Active-categories set, lowercased + trimmed for case-insensitive
  // membership tests. Inactive rows are filtered out — an archived
  // category should still flag tasks that referenced it.
  const activeCategoryNames = new Set<string>();
  for (const row of (categoriesRes.data ?? []) as CategoryRow[]) {
    if (!isCategoryActive(row)) continue;
    const name = lowerKey(row.name);
    if (name) activeCategoryNames.add(name);
  }

  // Pending-PCR membership set, keyed by `${phone10}::${categoryLower}`.
  // Phones are normalised to last-10 digits because pcr.user_phone is
  // 12-digit ("91XXXXXXXXXX") while tasks.phone is 10-digit.
  const pendingPcrKeys = new Set<string>();
  for (const row of (pcrRes.data ?? []) as PendingCategoryRequestRow[]) {
    const phone10 = normalizePhone10(row.user_phone);
    const cat = lowerKey(row.requested_category);
    if (!phone10 || !cat) continue;
    pendingPcrKeys.add(`${phone10}::${cat}`);
  }

  const kaam: KaamResponseRow[] = taskRows.map((row) => {
    const taskId = strOrNull(row.task_id) ?? "";
    const rawStatus = strOrNull(row.status);

    const lifecycleStatus = computeLifecycleStatus({
      status: row.status ?? null,
      closedAt: row.closed_at ?? null,
      closedBy: row.closed_by ?? null,
      closeReason: row.close_reason ?? null,
      matchStatuses: (matchesByTask.get(taskId) ?? []).map(
        (m) => m.match_status ?? null
      ),
      notificationStatuses: (notificationsByTask.get(taskId) ?? []).map(
        (n) => n.status ?? null
      ),
      chatSenderTypes: (messagesByTask.get(taskId) ?? []).map(
        (m) => m.sender_type ?? null
      ),
    });

    // New-Service-Category — three OR'd signals.
    const statusFlagsPending =
      lowerKey(row.status) === "pending_category_review";
    const phone10 = normalizePhone10(row.phone);
    const categoryLower = lowerKey(row.category);
    const pcrRowExists =
      phone10 && categoryLower
        ? pendingPcrKeys.has(`${phone10}::${categoryLower}`)
        : false;
    // Only flag "not in active set" when we actually loaded a non-empty
    // category list — otherwise a failed categories read would mark every
    // task as a new category. The empty-set guard prevents that.
    const categoryNotActive =
      activeCategoryNames.size > 0 &&
      categoryLower.length > 0 &&
      !activeCategoryNames.has(categoryLower);

    const isNewServiceCategory =
      statusFlagsPending || pcrRowExists || categoryNotActive;

    return {
      taskId,
      kaamNo: pickKaamNo(row),
      phone: strOrNull(row.phone),
      category: strOrNull(row.category),
      area: strOrNull(row.area),
      rawStatus,
      lifecycleStatus,
      lifecycleStep: LIFECYCLE_STEP[lifecycleStatus],
      lifecycleTotalSteps: LIFECYCLE_TOTAL_STEPS,
      isNewServiceCategory,
      statusAttentionLabel: isNewServiceCategory
        ? NEW_SERVICE_CATEGORY_LABEL
        : null,
      created_at: strOrNull(row.created_at),
      whenRequired: strOrNull(row.selected_timeframe),
    };
  });

  return NextResponse.json({
    success: true,
    totalKaam,
    monthlyKaam,
    categoryKaam,
    areaCategoryDemand,
    regionsCovered,
    areasCovered,
    analyticsTruncated,
    kaam,
  });
}
