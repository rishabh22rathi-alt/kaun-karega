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
  // Phase 1 additions. Nullable across the board — populated by Phase 2
  // (create-order webhook branch / schedule-free endpoint). Older
  // callers that select only the four legacy columns still work: the
  // optional `?` lets them omit these fields entirely without the type
  // narrowing complaining.
  scheduled_plan_code?: string | null;
  scheduled_max_regions?: number | null;
  scheduled_activates_at?: string | null;
  scheduled_payment_order_id?: string | null;
};

export type ScheduledPlan = {
  code: string;
  maxRegions: number;
  activatesAt: string;
  paymentOrderId: string | null;
};

export type EffectivePlan = {
  code: string;
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
  // Phase 1 read-only surface. Always null until Phase 2 writes
  // scheduled_* columns. Phase 3's activation worker is the only thing
  // that clears these — this helper does NOT auto-activate even if
  // `scheduled_activates_at <= now()`. Read-time activation would
  // cause silent state changes from a "pure helper" that callers do
  // not expect.
  scheduled: ScheduledPlan | null;
};

const FREE_PLAN_BASE = {
  code: "free",
  maxRegions: 1,
  currentPeriodEnd: null as string | null,
  active: true,
};

function buildScheduled(row: ProviderPlanRow): ScheduledPlan | null {
  const code = String(row.scheduled_plan_code || "").trim();
  if (!code) return null;
  // Defensive: the DB CHECK constraint guarantees max_regions and
  // activates_at are both set when scheduled_plan_code is set, but the
  // type allows callers to pass a partial row from a SELECT that
  // omitted columns. Treat any missing piece as "no scheduled plan"
  // rather than throwing — keeps the helper trivially safe.
  const maxRegions =
    Number.isFinite(row.scheduled_max_regions) &&
    (row.scheduled_max_regions ?? 0) >= 1
      ? Number(row.scheduled_max_regions)
      : null;
  const activatesAt = row.scheduled_activates_at || null;
  if (maxRegions === null || !activatesAt) return null;
  return {
    code,
    maxRegions,
    activatesAt,
    paymentOrderId: row.scheduled_payment_order_id || null,
  };
}

export function effectivePlan(
  row: ProviderPlanRow | null | undefined,
  now: Date = new Date()
): EffectivePlan {
  if (!row) return { ...FREE_PLAN_BASE, scheduled: null };

  const code = String(row.plan_code || "").trim() || "free";
  const maxRegions = Number.isFinite(row.max_regions) && (row.max_regions ?? 0) >= 1
    ? Number(row.max_regions)
    : 1;
  const currentPeriodEnd = row.current_period_end || null;
  const scheduled = buildScheduled(row);

  // Expiry rule: paid plans always set current_period_end. When the
  // window passes, the effective plan reverts to free WITHOUT mutating
  // the row. The row remains the audit trail of "what they paid for
  // last" and the dashboard surface for "renew" CTAs.
  if (currentPeriodEnd) {
    const endMs = Date.parse(currentPeriodEnd);
    if (!Number.isFinite(endMs) || endMs <= now.getTime()) {
      return { ...FREE_PLAN_BASE, currentPeriodEnd, active: false, scheduled };
    }
    return { code, maxRegions, currentPeriodEnd, active: true, scheduled };
  }

  // No period_end set. Treat as active under the row's plan_code. This
  // matches the implicit "free" default (when there is no row, we
  // return FREE_PLAN_BASE above) and supports admin-issued perpetual
  // plans without forcing a future date.
  return { code, maxRegions, currentPeriodEnd: null, active: true, scheduled };
}
