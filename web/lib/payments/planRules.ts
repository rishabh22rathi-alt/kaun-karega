/**
 * Plan-rule discriminated union. The schema's max_regions integer is
 * fine for fixed-count plans (free=1, regions_5=5) but conflates "5
 * fixed regions" with "every region in the provider's city" — today
 * the "all_jodhpur" plan uses max_regions=99 as a magic number to
 * approximate that. This helper makes the distinction explicit so
 * call sites stop branching on string compares or magic numbers.
 *
 *   getPlanRule("free")        → { kind: "fixed", maxRegions: 1 }
 *   getPlanRule("regions_5")   → { kind: "fixed", maxRegions: 5 }
 *   getPlanRule("all_jodhpur") → { kind: "cityWide" }
 *
 * For cityWide, the register UI auto-selects every active region in
 * the provider's currently-selected city and the enforcement layer
 * skips the per-region count check entirely (the data shape IS the
 * limit). Internal plan names kept as-is to minimise blast radius;
 * display copy lives in ProviderPlanCard.
 */

import type { EffectivePlan } from "./effectivePlan";

export type PlanRule =
  | { kind: "fixed"; maxRegions: number }
  | { kind: "cityWide" };

// Plan codes considered "city-wide" (today: only one; future plans can
// be added here without touching the comparison logic).
const CITY_WIDE_PLAN_CODES = new Set<string>(["all_jodhpur"]);

export function isCityWidePlanCode(planCode: string): boolean {
  return CITY_WIDE_PLAN_CODES.has(planCode);
}

export function getPlanRule(planCode: string): PlanRule {
  if (isCityWidePlanCode(planCode)) return { kind: "cityWide" };
  if (planCode === "regions_5") return { kind: "fixed", maxRegions: 5 };
  // free / unknown / expired all collapse to the safest cap.
  return { kind: "fixed", maxRegions: 1 };
}

// Convenience for the common case: caller has an EffectivePlan from
// effectivePlan() and wants the rule. Wraps getPlanRule.
export function planRuleFromEffective(plan: EffectivePlan): PlanRule {
  return getPlanRule(plan.code);
}

// Monthly change-limit constants. Both kinds (region set, category set)
// share the same cap today. Edits that are saves but don't actually
// mutate the relevant field should NOT count — caller is responsible
// for diffing old vs new before logging.
export const MONTHLY_CHANGE_LIMIT = 3;
export type ChangeType = "region_change" | "category_change";
