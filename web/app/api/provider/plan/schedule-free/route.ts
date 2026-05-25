import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import { isScheduledPlansEnabled } from "@/lib/payments/server";

/**
 * Phase 3.2A — Schedule a paid → Free plan change.
 *
 * Business contract:
 *   - Provider must be on an active paid plan.
 *   - No payment is taken; this is a no-money state transition.
 *   - Current paid plan keeps running until current_period_end.
 *   - Free plan activates automatically at expiry via the Phase 3.2B
 *     cron + activate_scheduled_plan() RPC.
 *   - At activation the cron keeps the provider's oldest registered
 *     region (created_at ASC, region_code ASC) and deletes the rest.
 *
 * Locking semantics:
 *   - A scheduled PAID plan (scheduled_payment_order_id IS NOT NULL)
 *     is locked. Business rule #9: non-refundable, no cancellation.
 *     Free scheduling cannot replace a paid scheduled plan; we refuse
 *     with 409 PAID_SCHEDULED_LOCKED.
 *   - A scheduled FREE plan can be re-requested idempotently — the
 *     same call returns success with the existing activates_at.
 *   - A scheduled FREE plan CAN be replaced by a later paid scheduled
 *     plan (handled in /api/payments/create-order, not here).
 *
 * Auth: matches the create-order route pattern — signed session
 * cookie, phone normalised to 10 digits, providers row lookup union
 * over (phone, 91+phone). Service-role admin client for the
 * provider_plans read/write (RLS is service-role-only on that table).
 *
 * Feature gate: KK_SCHEDULED_PLANS_ENABLED. Off → 503 here, exactly
 * matching the create-order gate. Webhook activation paths (Phase 2)
 * trust recorded order context regardless of the flag's current state.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

type ScheduleFreeBody = {
  confirmed?: unknown;
};

export async function POST(request: Request) {
  // Phase 2 kill switch gates intake here. Already-scheduled rows
  // continue to activate via the Phase 3.2B cron regardless of this
  // flag — the cron consumes recorded intent, not new requests.
  if (!isScheduledPlansEnabled()) {
    return NextResponse.json(
      { ok: false, error: "SCHEDULED_PLANS_DISABLED" },
      { status: 503 }
    );
  }

  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
  });
  if (!session?.phone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  let body: ScheduleFreeBody = {};
  try {
    body = (await request.json()) as ScheduleFreeBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  // Strict equality with `true`, matching the agreed_terms gate on
  // create-order. A truthy-but-not-boolean value (e.g. "yes", 1) does
  // not pass. The client modal sends an explicit boolean after the
  // Confirm button click.
  if (body.confirmed !== true) {
    return NextResponse.json(
      { ok: false, error: "CONFIRMATION_REQUIRED" },
      { status: 400 }
    );
  }

  const phone10 = normalizePhone10(session.phone);
  if (phone10.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "INVALID_SESSION_PHONE" },
      { status: 400 }
    );
  }

  const { data: providerRows, error: providerLookupError } = await adminSupabase
    .from("providers")
    .select("provider_id, phone")
    .or(`phone.eq.${phone10},phone.eq.91${phone10}`)
    .limit(5);

  if (providerLookupError) {
    console.error(
      "[provider/plan/schedule-free] provider lookup failed",
      providerLookupError
    );
    return NextResponse.json(
      { ok: false, error: "PROVIDER_LOOKUP_FAILED" },
      { status: 500 }
    );
  }

  const providerRow = (providerRows ?? []).find(
    (r) => normalizePhone10(r.phone) === phone10
  );
  if (!providerRow?.provider_id) {
    return NextResponse.json(
      { ok: false, error: "NOT_A_PROVIDER" },
      { status: 403 }
    );
  }
  const providerId = String(providerRow.provider_id);

  // Load provider_plans with scheduled_* fields so effectivePlan() can
  // populate the scheduled passthrough. Failure here returns 500
  // rather than degrading to a default — misclassifying a transition
  // is worse than a transient outage on this endpoint.
  const { data: planRow, error: planLookupError } = await adminSupabase
    .from("provider_plans")
    .select(
      "plan_code, max_regions, current_period_start, current_period_end, scheduled_plan_code, scheduled_max_regions, scheduled_activates_at, scheduled_payment_order_id"
    )
    .eq("provider_id", providerId)
    .maybeSingle();

  if (planLookupError) {
    console.error(
      "[provider/plan/schedule-free] provider_plans lookup failed",
      planLookupError
    );
    return NextResponse.json(
      { ok: false, error: "PLAN_LOOKUP_FAILED" },
      { status: 500 }
    );
  }

  const effective = effectivePlan(planRow ?? null);

  // Must be on an active paid plan. Free providers and expired-paid
  // providers (whose effective plan has already collapsed to free)
  // have no current paid period to step down from. The Free CTA on
  // the client is disabled in those cases too; the server enforces
  // for defense in depth.
  if (!effective.active || effective.code === "free") {
    return NextResponse.json(
      { ok: false, error: "NOT_ACTIVE_PAID_PLAN" },
      { status: 409 }
    );
  }

  // Paid scheduled plans are locked. Business rule #9: non-refundable,
  // no cancellation. Free cannot replace a paid scheduled plan.
  if (effective.scheduled && effective.scheduled.paymentOrderId) {
    return NextResponse.json(
      {
        ok: false,
        error: "PAID_SCHEDULED_LOCKED",
        message:
          "A paid plan is already scheduled for your next cycle and cannot be cancelled.",
      },
      { status: 409 }
    );
  }

  // Idempotent re-request: Free already scheduled, no payment behind
  // it (scheduled_payment_order_id IS NULL by definition for Free).
  // Return success with the existing activates_at and skip the write.
  // The client may call this multiple times; the second call should
  // not error and should not refresh the activates_at timestamp.
  if (
    effective.scheduled &&
    effective.scheduled.code === "free" &&
    !effective.scheduled.paymentOrderId
  ) {
    return NextResponse.json({
      ok: true,
      scheduledPlan: {
        code: "free",
        maxRegions: effective.scheduled.maxRegions,
        activatesAt: effective.scheduled.activatesAt,
        paymentOrderId: null,
      },
    });
  }

  // currentPeriodEnd is guaranteed non-null for an active paid plan —
  // effectivePlan() only sets active=true when a row has a future
  // end date. Defensive null-check anyway; missing here would be a
  // misclassification bug in effectivePlan().
  if (!effective.currentPeriodEnd) {
    console.error(
      "[provider/plan/schedule-free] active paid plan missing period_end",
      { providerId, effectiveCode: effective.code }
    );
    return NextResponse.json(
      { ok: false, error: "MISSING_CURRENT_PERIOD_END" },
      { status: 500 }
    );
  }

  const activatesAt = effective.currentPeriodEnd;
  const now = new Date().toISOString();

  // UPDATE only the scheduled_* fields. Active fields (plan_code,
  // max_regions, current_period_start, current_period_end,
  // last_payment_id) are intentionally NOT touched — the current paid
  // plan must keep running until expiry. The
  // chk_provider_plans_scheduled_consistency CHECK at the DB layer
  // requires all four core scheduled_* fields to be set together.
  //
  // The .is("scheduled_payment_order_id", null) filter is defense in
  // depth: between our SELECT and this UPDATE a webhook for a paid
  // scheduled order could in theory promote the row's
  // scheduled_payment_order_id from NULL to a value. The filter
  // ensures we never overwrite a locked paid schedule even in that
  // microsecond race window. .select("provider_id") returns the
  // affected rows so we can distinguish "updated" from "filtered out".
  const { data: updatedRows, error: updateError } = await adminSupabase
    .from("provider_plans")
    .update({
      scheduled_plan_code: "free",
      scheduled_max_regions: 1,
      scheduled_activates_at: activatesAt,
      scheduled_payment_order_id: null,
      scheduled_at: now,
      updated_at: now,
    })
    .eq("provider_id", providerId)
    .is("scheduled_payment_order_id", null)
    .select("provider_id");

  if (updateError) {
    console.error(
      "[provider/plan/schedule-free] provider_plans update failed",
      updateError
    );
    return NextResponse.json(
      { ok: false, error: "SCHEDULE_FREE_UPDATE_FAILED" },
      { status: 500 }
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    // Zero rows updated. Either:
    //   (a) provider_plans row was deleted between SELECT and UPDATE
    //       (impossible by design — there's no app path that deletes
    //       a provider_plans row outside provider account deletion,
    //       which cascades and we'd have failed the providers lookup).
    //   (b) A webhook for a paid scheduled order promoted
    //       scheduled_payment_order_id from NULL to a value between
    //       our SELECT and our UPDATE. The provider should retry
    //       after that paid scheduled plan completes its cycle.
    return NextResponse.json(
      {
        ok: false,
        error: "RACE_CONFLICT",
        message:
          "A paid plan was scheduled at the same time. Please reload and try again.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    scheduledPlan: {
      code: "free",
      maxRegions: 1,
      activatesAt,
      paymentOrderId: null,
    },
  });
}
