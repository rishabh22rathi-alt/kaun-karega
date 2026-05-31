import { adminSupabase } from "@/lib/supabase/admin";
import { effectivePlan, type ProviderPlanRow } from "@/lib/payments/effectivePlan";

/**
 * All Jodhpur search — Phase 1 helpers.
 *
 * Identify providers whose EFFECTIVE plan is `all_jodhpur` (active, not
 * expired). These back the "all-city task matches only active all_jodhpur
 * providers" rule that a LATER phase wires into matching — nothing here
 * touches the matching routes yet.
 *
 * Expiry is delegated to effectivePlan() so the semantics match the rest
 * of the system exactly: a row with plan_code='all_jodhpur' whose
 * current_period_end has passed collapses to effective code 'free' and is
 * correctly EXCLUDED.
 *
 * provider_plans is RLS service-role-only, so both helpers use
 * adminSupabase. Soft-fail: a lookup error yields an empty set / false
 * rather than throwing — a transient DB blip must never widen city-wide
 * matching beyond paid providers.
 */

const ALL_JODHPUR_PLAN_CODE = "all_jodhpur";

// The subset of provider_plans columns effectivePlan() needs, plus the id.
type PlanRowLite = ProviderPlanRow & { provider_id: string };

const PLAN_SELECT =
  "provider_id, plan_code, max_regions, current_period_start, current_period_end";

/**
 * Returns the set of provider_ids whose effective plan is active
 * all_jodhpur. Pass `candidateIds` to scope the lookup to a known match
 * set (the hot-path use: label/restrict an already-computed candidate
 * list without scanning the whole table).
 */
export async function getEffectiveCityWideProviderIds(
  candidateIds?: string[]
): Promise<Set<string>> {
  // An explicit empty candidate list means "nothing to check".
  if (candidateIds && candidateIds.length === 0) return new Set<string>();

  let query = adminSupabase
    .from("provider_plans")
    .select(PLAN_SELECT)
    .eq("plan_code", ALL_JODHPUR_PLAN_CODE);
  if (candidateIds && candidateIds.length > 0) {
    query = query.in("provider_id", candidateIds);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(
      "[cityWideProviders] getEffectiveCityWideProviderIds lookup failed; returning empty set",
      error.message || error
    );
    return new Set<string>();
  }

  const result = new Set<string>();
  for (const row of (data ?? []) as PlanRowLite[]) {
    const eff = effectivePlan(row);
    if (eff.active && eff.code === ALL_JODHPUR_PLAN_CODE) {
      const pid = String(row.provider_id || "").trim();
      if (pid) result.add(pid);
    }
  }
  return result;
}

/**
 * True iff the single provider's effective plan is active all_jodhpur.
 */
export async function isEffectiveAllJodhpur(providerId: string): Promise<boolean> {
  const pid = String(providerId || "").trim();
  if (!pid) return false;

  const { data, error } = await adminSupabase
    .from("provider_plans")
    .select(PLAN_SELECT)
    .eq("provider_id", pid)
    .maybeSingle();

  if (error) {
    console.warn(
      "[cityWideProviders] isEffectiveAllJodhpur lookup failed; returning false",
      error.message || error
    );
    return false;
  }
  if (!data) return false;

  const eff = effectivePlan(data as PlanRowLite);
  return eff.active && eff.code === ALL_JODHPUR_PLAN_CODE;
}

/**
 * Effective plan code per provider for a KNOWN candidate set. Providers
 * with no plan row are simply absent from the map; callers treat "absent"
 * as free. effectivePlan() already collapses an expired paid plan to
 * 'free'. Scoped to candidateIds so the matching hot path never scans the
 * whole table. Soft-fails to an empty map (everyone treated as region).
 */
export async function getEffectivePlanCodeMap(
  candidateIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!candidateIds || candidateIds.length === 0) return map;

  const { data, error } = await adminSupabase
    .from("provider_plans")
    .select(PLAN_SELECT)
    .in("provider_id", candidateIds);
  if (error) {
    console.warn(
      "[cityWideProviders] getEffectivePlanCodeMap lookup failed; treating all as free",
      error.message || error
    );
    return map;
  }
  for (const row of (data ?? []) as PlanRowLite[]) {
    const pid = String(row.provider_id || "").trim();
    if (!pid) continue;
    map.set(pid, effectivePlan(row).code);
  }
  return map;
}

export type MatchScope = "region" | "all_jodhpur";
export type MatchGroup =
  | "available_across_jodhpur"
  | "available_in_this_region"
  | "other_providers_in_this_area";

/** Coverage-origin label for a provider given its effective plan code. */
export function matchScopeForPlanCode(planCode: string | undefined): MatchScope {
  return planCode === ALL_JODHPUR_PLAN_CODE ? "all_jodhpur" : "region";
}

/** UI grouping bucket for a region-task match given the provider's plan. */
export function matchGroupForPlanCode(planCode: string | undefined): MatchGroup {
  if (planCode === ALL_JODHPUR_PLAN_CODE) return "available_across_jodhpur";
  if (planCode === "regions_5") return "available_in_this_region";
  return "other_providers_in_this_area";
}
