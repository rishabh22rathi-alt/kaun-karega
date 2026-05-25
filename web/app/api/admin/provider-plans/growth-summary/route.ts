import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import { respondWithCachedAdminPayload } from "@/lib/admin/snapshotCache";

/**
 * Commit B — Provider Plan Growth summary endpoint.
 *
 * Read-only admin analytics. Returns the totals/scheduled/expiring/
 * revenue snapshot the Provider Plan Growth dashboard tab renders.
 *
 * Auth: requireAdminSession (cookie + session-version validation). 401
 * for any non-admin caller. Service-role Supabase only.
 *
 * Caching: read-through L1+L2 via respondWithCachedAdminPayload with
 *   key:        provider_plan_growth      (matches the key Commit A wires
 *                                          invalidation for)
 *   ttlSeconds: 300                       (5-minute TTL — plan/revenue is
 *                                          money-adjacent; tighter than
 *                                          provider_stats's 6h because
 *                                          staleness cost is higher)
 *   refresh:    ?refresh=1 forces recompute
 *
 * Privacy: response carries counts only. No phone numbers, provider
 * IDs, payment IDs, or any row-level data.
 *
 * Counting logic (see spec Commit B for the full table):
 *   - totalProviders   = COUNT(*) FROM providers
 *   - regions5         = WHERE plan_code='regions_5'   AND current_period_end > now
 *   - allJodhpur       = WHERE plan_code='all_jodhpur' AND current_period_end > now
 *   - expiredPaid      = WHERE plan_code != 'free'     AND current_period_end <= now
 *                        (sub-slice of free, surfaced for visibility)
 *   - activePaid       = regions5 + allJodhpur
 *   - free             = totalProviders - activePaid
 *                        (implicit free + row-free + expired-paid all collapse here)
 *   - scheduled.*      = WHERE scheduled_plan_code = ?      (no time filter)
 *   - scheduled.dueNow = WHERE scheduled_plan_code IS NOT NULL AND scheduled_activates_at <= now
 *   - expiring.next3Days / next7Days = paid plans whose current_period_end
 *                        falls inside the window; next7Days INCLUDES the
 *                        next3Days set by definition.
 *   - expiring.expiredButNotActivated = paid expired AND scheduled_plan_code IS NULL
 *
 * Revenue is computed from PLAN_PRICING amounts (₹31 / ₹101) per active
 * provider per 30-day cycle. The UI labels this as "Per-cycle gross
 * (₹/30d)", not MRR — see notes[] in the response.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Plan amounts in rupees. Mirror PLAN_PRICING (web/lib/payments/server.ts)
// expressed in ₹ for response rendering. If pricing ever changes, that
// constant moves; this revenue formula picks it up via the local copy.
const PLAN_PRICE_RUPEES = {
  regions_5: 31,
  all_jodhpur: 101,
} as const;

const CACHE_KEY = "provider_plan_growth";
const TTL_SECONDS = 300;

const NOTES = [
  "Revenue is per 30-day cycle, not calendar month.",
  "Free count includes expired paid providers (effective free).",
  "Providers on ₹101 with scheduled ₹31 are counted as active ₹101 until activation.",
  "Scheduled counts are next-cycle movement only.",
  "Expiring next 7 days includes the next 3 days.",
];

type GrowthSummary = {
  totals: {
    totalProviders: number;
    free: number;
    regions5: number;
    allJodhpur: number;
    expiredPaid: number;
    activePaid: number;
  };
  scheduled: {
    free: number;
    regions5: number;
    allJodhpur: number;
    dueNow: number;
  };
  expiring: {
    next3Days: number;
    next7Days: number;
    expiredButNotActivated: number;
  };
  revenue: {
    currentMonthlyEstimate: number;
    regions5Revenue: number;
    allJodhpurRevenue: number;
    paidProviderCount: number;
    freeToPaidConversionPercent: number;
  };
  notes: string[];
};

// Supabase's `.select(col, { count: 'exact', head: true })` returns
// `{ count: number | null, error: PostgrestError | null }`. We never
// need the data — only the count. Wrap in a strict helper so any
// per-query failure surfaces as a thrown Error with the label baked
// in, and the read-through cache treats the whole compute as failed.
async function countOrThrow(
  promise: PromiseLike<{ count: number | null; error: unknown }>,
  label: string
): Promise<number> {
  const { count, error } = await promise;
  if (error) {
    const message =
      (error as { message?: unknown })?.message != null
        ? String((error as { message?: unknown }).message)
        : String(error);
    throw new Error(`growth-summary count failed (${label}): ${message}`);
  }
  return count ?? 0;
}

function isoOffsetDays(base: Date, days: number): string {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function computeProviderPlanGrowth(): Promise<GrowthSummary> {
  const now = new Date();
  const nowIso = now.toISOString();
  const threeDaysIso = isoOffsetDays(now, 3);
  const sevenDaysIso = isoOffsetDays(now, 7);

  // 11 parallel count-only queries. Each is a `head:true` so no rows
  // come back — Postgres returns just the count. Index-backed via
  // provider_plans (PK on provider_id) + idx_provider_plans_current_
  // period_end (partial on current_period_end where not null). All
  // queries complete in ~tens of milliseconds on typical workloads.
  const [
    totalProviders,
    regions5Active,
    allJodhpurActive,
    expiredPaid,
    scheduledFree,
    scheduledRegions5,
    scheduledAllJodhpur,
    scheduledDueNow,
    expiring3d,
    expiring7d,
    expiredNotActivated,
  ] = await Promise.all([
    countOrThrow(
      adminSupabase
        .from("providers")
        .select("provider_id", { count: "exact", head: true }),
      "totalProviders"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .eq("plan_code", "regions_5")
        .gt("current_period_end", nowIso),
      "regions5Active"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .eq("plan_code", "all_jodhpur")
        .gt("current_period_end", nowIso),
      "allJodhpurActive"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .neq("plan_code", "free")
        .lte("current_period_end", nowIso),
      "expiredPaid"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .eq("scheduled_plan_code", "free"),
      "scheduledFree"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .eq("scheduled_plan_code", "regions_5"),
      "scheduledRegions5"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .eq("scheduled_plan_code", "all_jodhpur"),
      "scheduledAllJodhpur"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .not("scheduled_plan_code", "is", null)
        .lte("scheduled_activates_at", nowIso),
      "scheduledDueNow"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .neq("plan_code", "free")
        .gt("current_period_end", nowIso)
        .lte("current_period_end", threeDaysIso),
      "expiring3d"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .neq("plan_code", "free")
        .gt("current_period_end", nowIso)
        .lte("current_period_end", sevenDaysIso),
      "expiring7d"
    ),
    countOrThrow(
      adminSupabase
        .from("provider_plans")
        .select("provider_id", { count: "exact", head: true })
        .neq("plan_code", "free")
        .lte("current_period_end", nowIso)
        .is("scheduled_plan_code", null),
      "expiredNotActivated"
    ),
  ]);

  // Derived totals. activePaid is the sum of the two active-paid codes;
  // free is whatever's left of the provider population. Bounded by
  // Math.max(0, ...) so a transient inconsistency (e.g. a provider row
  // deleted mid-batch) can't produce a negative number on screen.
  const activePaid = regions5Active + allJodhpurActive;
  const free = Math.max(0, totalProviders - activePaid);

  // Revenue. Counts × per-cycle price. UI labels this as
  // "Per-cycle gross (₹/30d)" — never MRR — because PLAN_VALIDITY_DAYS
  // is 30 and renewals are rolling, not calendar-aligned.
  const regions5Revenue = regions5Active * PLAN_PRICE_RUPEES.regions_5;
  const allJodhpurRevenue = allJodhpurActive * PLAN_PRICE_RUPEES.all_jodhpur;
  const currentMonthlyEstimate = regions5Revenue + allJodhpurRevenue;

  // Conversion %. Denominator is the full provider population (matches
  // the spec). Round to 1 decimal place via integer arithmetic to avoid
  // floating-point representation artifacts in the JSON.
  const freeToPaidConversionPercent =
    totalProviders > 0
      ? Math.round((activePaid / totalProviders) * 1000) / 10
      : 0;

  return {
    totals: {
      totalProviders,
      free,
      regions5: regions5Active,
      allJodhpur: allJodhpurActive,
      expiredPaid,
      activePaid,
    },
    scheduled: {
      free: scheduledFree,
      regions5: scheduledRegions5,
      allJodhpur: scheduledAllJodhpur,
      dueNow: scheduledDueNow,
    },
    expiring: {
      next3Days: expiring3d,
      next7Days: expiring7d,
      expiredButNotActivated: expiredNotActivated,
    },
    revenue: {
      currentMonthlyEstimate,
      regions5Revenue,
      allJodhpurRevenue,
      paidProviderCount: activePaid,
      freeToPaidConversionPercent,
    },
    notes: NOTES,
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }

  // Delegate to the shared cache wrapper. It handles ?refresh=1 query
  // parsing, L1+L2 read-through, stampede coalescing, and produces the
  // `{ ok: true, data, cache }` envelope the UI expects. `adminPhone`
  // is recorded into admin_cached_snapshots.computed_by for audit.
  return respondWithCachedAdminPayload<GrowthSummary>({
    request,
    key: CACHE_KEY,
    ttlSeconds: TTL_SECONDS,
    adminPhone: auth.admin.phone ?? null,
    logLabel: CACHE_KEY,
    compute: computeProviderPlanGrowth,
  });
}
