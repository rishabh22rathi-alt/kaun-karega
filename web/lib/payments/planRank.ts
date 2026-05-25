/**
 * Plan ordering + change-classification helper.
 *
 * Phase 1: pure read-only utilities. No webhook or route handler reads
 * these yet — they exist so Phase 2 can branch on `classifyPlanChange`
 * without re-deriving rank from string compares or magic numbers.
 *
 * Rank is the primitive other helpers should branch on. Higher rank =
 * "larger" plan (more regions, costlier). Equal ranks of the same code
 * are renewals; equal ranks across different codes are not a thing
 * today (free=0, regions_5=1, all_jodhpur=2). An unknown plan code
 * collapses to rank 0 (the safest cap), matching how getPlanRule
 * handles unknowns in planRules.ts.
 *
 * `classifyPlanChange` is the single source of truth for "what does
 * picking plan X from plan Y mean?". Phase 2 wires this into the
 * create-order route to record `mode` on `payment_orders`, and into
 * the webhook to branch on that recorded mode. Keeping the function
 * here, not in server.ts, lets the client import the type union if it
 * ever needs to (today it does not).
 */

export const PLAN_RANK: Readonly<Record<string, number>> = Object.freeze({
  free: 0,
  regions_5: 1,
  all_jodhpur: 2,
});

export function getPlanRank(planCode: string | null | undefined): number {
  const code = String(planCode || "").trim();
  // Object.prototype.hasOwnProperty.call avoids prototype-pollution edge
  // cases where a key like "__proto__" could land in PLAN_RANK.
  if (Object.prototype.hasOwnProperty.call(PLAN_RANK, code)) {
    return PLAN_RANK[code]!;
  }
  // Unknown plan code → treat as free for ordering. Matches getPlanRule's
  // "collapse to safest cap" behavior so a typo'd plan_code does not
  // accidentally let a provider keep a higher tier.
  return 0;
}

/**
 * Plan-change classification used by the (Phase 2) create-order route
 * and webhook handler. Computed from the provider's *currently
 * effective* plan (after expiry collapse) and the requested target.
 *
 *   upgrade              — rank(target) > rank(current). Activates
 *                          immediately on webhook (Phase 2 behavior).
 *   renew                — rank(target) === rank(current), same code,
 *                          and current plan is active (not expired).
 *                          Webhook extends current_period_end.
 *   schedule_paid_lower  — rank(target) < rank(current), target is a
 *                          paid plan, and current plan is active.
 *                          Phase 2 webhook will write scheduled_*
 *                          instead of touching current_period_*.
 *   schedule_free        — rank(target) < rank(current), target is the
 *                          free plan, and current plan is active.
 *                          Phase 2 schedule-free endpoint (no payment)
 *                          will write scheduled_*.
 *
 * When the current plan has already expired (`currentActive=false`),
 * any target paid plan is `upgrade` (the provider is effectively on
 * free), and target=free is a no-op (`renew` is returned so callers
 * never see a "schedule_free → already-free" transition; they should
 * separately short-circuit on no-op selections before classifying).
 */
export type PlanChangeMode =
  | "upgrade"
  | "renew"
  | "schedule_paid_lower"
  | "schedule_free";

export function classifyPlanChange(params: {
  currentCode: string;
  targetCode: string;
  currentActive: boolean;
}): PlanChangeMode {
  const currentCode = String(params.currentCode || "free").trim() || "free";
  const targetCode = String(params.targetCode || "free").trim() || "free";
  const currentRank = getPlanRank(currentCode);
  const targetRank = getPlanRank(targetCode);

  // Expired or implicit-free current plan: any paid selection is an
  // upgrade (immediate activation). A target of free is a same-rank
  // case below and resolves to "renew" — callers should filter no-op
  // selections before invoking this helper.
  if (!params.currentActive) {
    if (targetRank > 0) return "upgrade";
    return "renew";
  }

  if (targetRank > currentRank) return "upgrade";

  if (targetRank === currentRank) {
    // Same-rank-same-code on an active plan is the renewal path
    // (extend period). Different codes with the same rank don't exist
    // today; if a future plan creates that case, classify as
    // upgrade-equivalent to be safe (always pick the more-recent code).
    if (targetCode === currentCode) return "renew";
    return "upgrade";
  }

  // targetRank < currentRank and current is active: scheduled lower.
  // Free vs paid target picks the right activation pathway.
  if (targetRank === 0) return "schedule_free";
  return "schedule_paid_lower";
}
