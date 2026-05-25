import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  createRazorpayOrder,
  getPlanAmountPaise,
  getPlanMaxRegions,
  getRazorpayCredentials,
  isPaidPlanCode,
  isPaymentEnabled,
  isScheduledPlansEnabled,
} from "@/lib/payments/server";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import { classifyPlanChange, type PlanChangeMode } from "@/lib/payments/planRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

/**
 * Stage 2 / Phase 2: create a Razorpay order for the authenticated provider.
 *
 * Phase 2 additions:
 *   - Body now requires `agreed_terms: true`. The client surfaces a
 *     payment-terms popup before this call; the server enforces the
 *     contract so a missing/forged client can't bypass consent.
 *   - Body may include `scheduled_region_codes: string[]` for the
 *     scheduled-paid-lower case (e.g. ₹101 → ₹31). Must be exactly the
 *     target plan's max_regions count, deduplicated, and each code must
 *     be an active service_region in the provider's city.
 *   - Server classifies the change against the provider's current
 *     effective plan and records the classification on the
 *     payment_orders row. The webhook trusts that recorded mode rather
 *     than re-classifying at capture time.
 *   - scheduled_paid_lower orders require KK_SCHEDULED_PLANS_ENABLED.
 *     If the flag is off, classify rejects the order before any
 *     Razorpay call is made. Immediate upgrade/renewal flows are
 *     unaffected by the flag.
 *
 * This route still does NOT write to provider_plans. The webhook is
 * the sole writer to provider_plans (active OR scheduled fields).
 */

type CreateOrderBody = {
  plan_code?: unknown;
  agreed_terms?: unknown;
  scheduled_region_codes?: unknown;
};

export async function POST(request: Request) {
  if (!isPaymentEnabled()) {
    return NextResponse.json(
      { ok: false, error: "PAYMENTS_DISABLED" },
      { status: 503 }
    );
  }

  const session = await getAuthSession({ cookie: request.headers.get("cookie") ?? "" });
  if (!session?.phone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  let body: CreateOrderBody;
  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  const planCode = typeof body.plan_code === "string" ? body.plan_code.trim() : "";
  if (!isPaidPlanCode(planCode)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_PLAN_CODE" },
      { status: 400 }
    );
  }

  // Phase 2: payment terms consent gate. Strict equality with `true`
  // so a truthy-but-not-boolean ("yes", 1) does NOT pass. The client
  // sends an explicit boolean after the modal checkbox click.
  if (body.agreed_terms !== true) {
    return NextResponse.json(
      { ok: false, error: "TERMS_NOT_AGREED" },
      { status: 400 }
    );
  }

  // Resolve provider_id from session phone. Union both phone forms
  // because providers table historically stores either.
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
    console.error("[payments/create-order] provider lookup failed", providerLookupError);
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

  // ── Classify the plan change ────────────────────────────────────────
  // Load the provider's current plan state. Service-role admin client
  // because provider_plans has RLS enabled (service-role only). A
  // failure here would force "no row → free" semantics; we treat the
  // failure as 500 instead because misclassifying an order is worse
  // than a transient outage on the order endpoint.
  const { data: planRow, error: planLookupError } = await adminSupabase
    .from("provider_plans")
    .select(
      "plan_code, max_regions, current_period_start, current_period_end, scheduled_plan_code, scheduled_max_regions, scheduled_activates_at, scheduled_payment_order_id"
    )
    .eq("provider_id", providerId)
    .maybeSingle();

  if (planLookupError) {
    console.error("[payments/create-order] provider_plans lookup failed", planLookupError);
    return NextResponse.json(
      { ok: false, error: "PLAN_LOOKUP_FAILED" },
      { status: 500 }
    );
  }

  const currentPlan = effectivePlan(planRow ?? null);
  const planChangeMode: PlanChangeMode = classifyPlanChange({
    currentCode: currentPlan.code,
    targetCode: planCode,
    currentActive: currentPlan.active,
  });

  // Free is not a paid-purchase target — classifyPlanChange returns
  // schedule_free for paid → free transitions. That path is a separate
  // (no-payment) endpoint that Phase 2 does not implement; reject any
  // create-order request that lands there so we never accept money
  // for a transition we can't represent.
  if (planChangeMode === "scheduled_free") {
    return NextResponse.json(
      { ok: false, error: "FREE_SCHEDULE_NOT_PAID" },
      { status: 400 }
    );
  }

  // Scheduled-plan supersession policy (Phase 2 + Phase 3.1).
  //
  // The discriminator between "paid scheduled" and "free scheduled" is
  // scheduled_payment_order_id: it is set ONLY by the webhook when a
  // paid order captures (Phase 2). A scheduled FREE entry has
  // scheduled_payment_order_id IS NULL (the future Phase 3.2 schedule-
  // free endpoint never sets it).
  //
  //   - Paid scheduled is LOCKED once it lands. Business rule #9:
  //     non-refundable, no cancellation. A second paid order layered
  //     on top would create ambiguity about which order's terms apply
  //     at activation. Reject with 409.
  //
  //   - Free scheduled is NOT locked (there is no payment behind it).
  //     A new scheduled_paid_lower request supersedes it cleanly:
  //     paid wins because once the paid payment captures it becomes
  //     locked, at which point a still-queued free schedule would be
  //     moot anyway. We clear the scheduled_* fields HERE — before
  //     the Razorpay order is even created — so the row consistently
  //     reflects "no scheduled change" between create-order and
  //     webhook capture. The webhook will then write the new paid
  //     scheduled_* via upsert.
  //
  // The clear UPDATE is gated on scheduled_payment_order_id IS NULL
  // as a defense-in-depth check against racing with a webhook that
  // just promoted a different paid order's schedule between our SELECT
  // and our UPDATE — the .is() filter ensures we never touch a paid
  // scheduled plan.
  if (
    planChangeMode === "scheduled_paid_lower" &&
    currentPlan.scheduled
  ) {
    if (currentPlan.scheduled.paymentOrderId) {
      // Paid scheduled is locked → reject the new paid order.
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_PLAN_ALREADY_QUEUED" },
        { status: 409 }
      );
    }
    // Free scheduled exists → clear it before creating the new paid
    // order. The webhook will write the new scheduled_* values on
    // payment.captured.
    const { error: clearScheduledFreeError } = await adminSupabase
      .from("provider_plans")
      .update({
        scheduled_plan_code: null,
        scheduled_max_regions: null,
        scheduled_activates_at: null,
        scheduled_at: null,
        // scheduled_payment_order_id was already null on a free
        // schedule; the row-level filter below double-protects us.
        updated_at: new Date().toISOString(),
      })
      .eq("provider_id", providerId)
      .is("scheduled_payment_order_id", null);
    if (clearScheduledFreeError) {
      console.error(
        "[payments/create-order] failed to clear scheduled_free before paid",
        clearScheduledFreeError
      );
      return NextResponse.json(
        { ok: false, error: "FAILED_TO_CLEAR_SCHEDULED_FREE" },
        { status: 500 }
      );
    }
  }

  // Feature-flag gate for the scheduled-paid-lower path. Immediate
  // upgrade/renewal flows are unaffected and continue to work even
  // when the flag is off.
  if (
    planChangeMode === "scheduled_paid_lower" &&
    !isScheduledPlansEnabled()
  ) {
    return NextResponse.json(
      { ok: false, error: "SCHEDULED_PLANS_DISABLED" },
      { status: 503 }
    );
  }

  // ── Scheduled paid lower: validate the future-region selection ─────
  let validatedScheduledRegionCodes: string[] | null = null;
  let scheduledActivatesAt: string | null = null;

  if (planChangeMode === "scheduled_paid_lower") {
    // current_period_end is the activation moment. By definition of
    // scheduled_paid_lower, currentPlan.active is true, which means
    // current_period_end is in the future. Defensive check anyway.
    if (!currentPlan.currentPeriodEnd) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CURRENT_PERIOD_END" },
        { status: 500 }
      );
    }
    scheduledActivatesAt = currentPlan.currentPeriodEnd;

    const rawCodes = body.scheduled_region_codes;
    if (!Array.isArray(rawCodes)) {
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_REGION_CODES_REQUIRED" },
        { status: 400 }
      );
    }

    // Dedupe + normalise. Cap-format check is light (non-empty,
    // bounded length) since region_code is opaque to this route —
    // the service_regions lookup below is the authoritative validator.
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const v of rawCodes) {
      const s = String(v ?? "").trim();
      if (!s || s.length > 64 || seen.has(s)) continue;
      seen.add(s);
      cleaned.push(s);
    }

    const requiredCount = getPlanMaxRegions(planCode);
    if (cleaned.length !== requiredCount) {
      return NextResponse.json(
        {
          ok: false,
          error: "SCHEDULED_REGION_COUNT_MISMATCH",
          required: requiredCount,
          received: cleaned.length,
        },
        { status: 400 }
      );
    }

    // Resolve provider's city_code so we validate regions against the
    // right catalogue. Mirror dashboard-profile's logic: first non-null
    // city_code on the provider's areas, with no implicit fallback —
    // a provider with no areas yet cannot schedule a region-bound
    // plan in Phase 2.
    const { data: areaRows } = await adminSupabase
      .from("provider_areas")
      .select("city_code")
      .eq("provider_id", providerId);
    let providerCityCode = "";
    if (Array.isArray(areaRows)) {
      for (const row of areaRows as Array<{ city_code?: string | null }>) {
        const candidate = String(row?.city_code ?? "").trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(candidate)) {
          providerCityCode = candidate;
          break;
        }
      }
    }
    if (!providerCityCode) {
      return NextResponse.json(
        { ok: false, error: "PROVIDER_CITY_UNKNOWN" },
        { status: 400 }
      );
    }

    // Validate every selected code exists, is active, and belongs to
    // the provider's city. A single round-trip; PostgREST's `in.()` is
    // server-side filtered.
    const { data: validRows, error: regionsErr } = await adminSupabase
      .from("service_regions")
      .select("region_code")
      .in("region_code", cleaned)
      .eq("city_code", providerCityCode)
      .eq("active", true);

    if (regionsErr) {
      console.error("[payments/create-order] service_regions lookup failed", regionsErr);
      return NextResponse.json(
        { ok: false, error: "REGION_LOOKUP_FAILED" },
        { status: 500 }
      );
    }

    const validCodes = new Set(
      (validRows ?? []).map((r) => String(r.region_code ?? ""))
    );
    if (validCodes.size !== cleaned.length) {
      const invalid = cleaned.filter((c) => !validCodes.has(c));
      return NextResponse.json(
        { ok: false, error: "INVALID_REGION_CODES", invalid },
        { status: 400 }
      );
    }

    validatedScheduledRegionCodes = cleaned;
  }

  const amountPaise = getPlanAmountPaise(planCode);

  const orderResult = await createRazorpayOrder({
    amountPaise,
    currency: "INR",
    receipt: `kk-${providerId}-${Date.now()}`.slice(0, 40),
    notes: {
      provider_id: providerId,
      plan_code: planCode,
      // Recorded in Razorpay's audit view so support diagnostics can
      // see the intended mode without joining payment_orders.
      plan_change_mode: planChangeMode,
    },
  });

  if (!orderResult.ok) {
    console.error("[payments/create-order] razorpay error", orderResult.error);
    return NextResponse.json(
      { ok: false, error: "RAZORPAY_ORDER_FAILED" },
      { status: 502 }
    );
  }

  const order = orderResult.order;
  const now = new Date();

  const { error: insertError } = await adminSupabase
    .from("payment_orders")
    .insert({
      order_id: order.id,
      provider_id: providerId,
      plan_code: planCode,
      amount_paise: amountPaise,
      currency: order.currency || "INR",
      status: "created",
      plan_change_mode: planChangeMode,
      current_plan_code_at_order: currentPlan.code,
      current_period_end_at_order: currentPlan.currentPeriodEnd,
      scheduled_activates_at: scheduledActivatesAt,
      scheduled_region_codes: validatedScheduledRegionCodes,
      agreed_terms_at: now.toISOString(),
    });

  if (insertError) {
    console.error("[payments/create-order] payment_orders insert failed", {
      orderId: order.id,
      providerId,
      planCode,
      planChangeMode,
      error: insertError.message,
    });
    return NextResponse.json(
      { ok: false, error: "ORDER_RECORD_FAILED" },
      { status: 500 }
    );
  }

  const creds = getRazorpayCredentials();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "CREDENTIALS_MISSING_POST_ORDER" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    key_id: creds.keyId,
    amount: amountPaise,
    currency: order.currency || "INR",
    // Echo the server classification so the client can render
    // post-payment copy ("activation queued for {date}") without
    // re-deriving the mode. Defensive only; the client never branches
    // its own logic on this field.
    plan_change_mode: planChangeMode,
  });
}
