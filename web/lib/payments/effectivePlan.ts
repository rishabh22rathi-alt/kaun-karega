/**
 * Pure helper that resolves a `provider_plans` row (or its absence)
 * into the effective plan state for downstream consumers.
 *
 * Single source of truth for the rules:
 *   - Absence of a row             → free, max_regions=1, active=true
 *   - Row with no period_end       → use the row's plan_code as-is,
 *                                     active=true (legacy / admin-set)
 *   - Row with period_end >  now() → active paid plan
 *   - Row with period_end <= now() → expired; effective plan is free
 *
 * Stage 2 callers: dashboard-profile route only. Stage 3 will add the
 * registration / update / matching enforcement call sites.
 *
 * No DB access here — caller fetches the row and passes it in. Keeps
 * this module trivially testable and side-effect-free.
 */

export type ProviderPlanRow = {
  plan_code: string | null;
  max_regions: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

export type EffectivePlan = {
  code: string;
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
};

const FREE_PLAN: EffectivePlan = {
  code: "free",
  maxRegions: 1,
  currentPeriodEnd: null,
  active: true,
};

export function effectivePlan(
  row: ProviderPlanRow | null | undefined,
  now: Date = new Date()
): EffectivePlan {
  if (!row) return FREE_PLAN;

  const code = String(row.plan_code || "").trim() || "free";
  const maxRegions = Number.isFinite(row.max_regions) && (row.max_regions ?? 0) >= 1
    ? Number(row.max_regions)
    : 1;
  const currentPeriodEnd = row.current_period_end || null;

  // Expiry rule: paid plans always set current_period_end. When the
  // window passes, the effective plan reverts to free WITHOUT mutating
  // the row. The row remains the audit trail of "what they paid for
  // last" and the dashboard surface for "renew" CTAs.
  if (currentPeriodEnd) {
    const endMs = Date.parse(currentPeriodEnd);
    if (!Number.isFinite(endMs) || endMs <= now.getTime()) {
      return { ...FREE_PLAN, currentPeriodEnd, active: false };
    }
    return { code, maxRegions, currentPeriodEnd, active: true };
  }

  // No period_end set. Treat as active under the row's plan_code. This
  // matches the implicit "free" default (when there is no row, we
  // return FREE_PLAN above) and supports admin-issued perpetual plans
  // without forcing a future date.
  return { code, maxRegions, currentPeriodEnd: null, active: true };
}
