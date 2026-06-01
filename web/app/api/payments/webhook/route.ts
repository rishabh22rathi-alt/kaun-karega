import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PLAN_VALIDITY_DAYS,
  getPlanMaxRegions,
  isPaidPlanCode,
  isPaymentEnabled,
  verifyWebhookSignature,
} from "@/lib/payments/server";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";
import { reconcileProviderCoverage } from "@/lib/admin/reconcileProviderCoverage";
import { safeIssueInvoiceForPaidOrder } from "@/lib/payments/issueInvoice";
import { notifyAdmins } from "@/lib/notifications/notifyAdmins";

// Cache keys invalidated after every successful captured-payment write
// (both immediate-upgrade/renewal and scheduled_paid_lower branches).
// Centralised here so the two branches stay in sync if the key list ever
// grows. provider_plan_growth is the new admin dashboard surface;
// provider_stats keys were also under-invalidated by the webhook before
// this change (pre-existing gap that we close here too).
const PAYMENT_CACHE_INVALIDATION_KEYS = [
  "provider_plan_growth",
  "provider_stats",
  "provider_stats.by_category",
  "provider_stats.by_category.verified",
] as const;

// Soft-fail wrapper. A cache invalidation failure must NEVER cause us
// to return 5xx — that would trigger Razorpay's at-least-once retry
// policy on a payment that's already been recorded as paid, which is
// worse than the cache being stale for its natural TTL.
async function safeInvalidatePaymentCaches(): Promise<void> {
  try {
    await invalidateSnapshots([...PAYMENT_CACHE_INVALIDATION_KEYS]);
  } catch (err) {
    console.warn(
      "[payments/webhook] snapshot invalidation failed (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage 2: Razorpay webhook receiver. Source of truth for plan
 * activation.
 *
 * Required env var: RAZORPAY_WEBHOOK_SECRET. Set in the Razorpay
 * dashboard's webhook config; copy here.
 *
 * Authentication: HMAC-SHA256 over the RAW request body using
 * RAZORPAY_WEBHOOK_SECRET, compared constant-time against the
 * `x-razorpay-signature` header.
 *
 * IMPORTANT: we MUST read the body via request.text() BEFORE any JSON
 * parsing. Mutating the bytes (e.g. via request.json()) breaks the
 * signature comparison silently.
 *
 * Response policy (matters for Razorpay's at-least-once retry policy):
 *   - 400 on bad/missing signature   → do not retry; misconfigured.
 *   - 200 on valid signature, even   → "I have received it." Razorpay
 *         when we ignored the event       stops retrying.
 *   - 500 on DB write failure        → Razorpay retries up to 24h.
 *         Retry-safe because:
 *           • payment_webhook_events.event_id is unique-when-present
 *           • payment_orders.razorpay_payment_id is unique-when-present
 *           • plan upsert is idempotent on provider_id
 *
 * Idempotency rests on the unique indexes added in the Stage 1
 * migration. We do NOT pre-check for existence; we let Postgres reject
 * duplicates (23505) and treat that as success.
 */

const TYPE_PAYMENT_CAPTURED = "payment.captured";
const TYPE_PAYMENT_FAILED = "payment.failed";

type WebhookPayload = {
  id?: unknown;
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
        amount?: unknown;
        currency?: unknown;
        status?: unknown;
        notes?: Record<string, unknown> | null;
      } | null;
    } | null;
  } | null;
};

export async function POST(request: Request) {
  if (!isPaymentEnabled()) {
    return NextResponse.json(
      { ok: false, error: "PAYMENTS_DISABLED" },
      { status: 503 }
    );
  }

  // 1. Read the raw body. Must happen before any JSON parse so HMAC is
  //    computed over the bytes Razorpay actually signed.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[payments/webhook] failed to read body", err);
    return NextResponse.json(
      { ok: false, error: "BAD_BODY" },
      { status: 400 }
    );
  }

  // 2. Verify signature. Bad signature → 400, no audit log write.
  //    Reasoning: writing an audit row keyed on a forged event id would
  //    let an attacker poison the dedup table and block legitimate
  //    events with the same id. Reject before any persistence.
  const signatureHeader = request.headers.get("x-razorpay-signature") ?? "";
  const signatureOk = verifyWebhookSignature({
    rawBody,
    signature: signatureHeader,
  });
  if (!signatureOk) {
    console.warn("[payments/webhook] signature verification failed", {
      signatureHeaderPresent: Boolean(signatureHeader),
      bodyLength: rawBody.length,
    });
    return NextResponse.json(
      { ok: false, error: "BAD_SIGNATURE" },
      { status: 400 }
    );
  }

  // 3. Parse JSON. After-signature so a forged signature never reaches
  //    the parser.
  let parsed: WebhookPayload;
  try {
    parsed = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD_JSON" },
      { status: 400 }
    );
  }

  const eventId = typeof parsed.id === "string" ? parsed.id : null;
  const eventType = typeof parsed.event === "string" ? parsed.event : "";
  const paymentEntity = parsed.payload?.payment?.entity ?? null;
  const razorpayPaymentId =
    typeof paymentEntity?.id === "string" ? paymentEntity.id : null;
  const orderIdFromEvent =
    typeof paymentEntity?.order_id === "string" ? paymentEntity.order_id : null;

  // 4. Append to audit log. Unique constraint on event_id catches
  //    Razorpay retries. 23505 → already processed → return 200.
  const auditInsert = await adminSupabase.from("payment_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    order_id: orderIdFromEvent,
    razorpay_payment_id: razorpayPaymentId,
    signature_ok: true,
    raw_body: parsed,
  });

  if (auditInsert.error) {
    const code = (auditInsert.error as { code?: string }).code;
    if (code === "23505") {
      // Duplicate event_id — Razorpay retry. Return 200 so they stop.
      return NextResponse.json({ ok: true, deduped: true });
    }
    console.error("[payments/webhook] audit insert failed", auditInsert.error);
    // Return 500 so Razorpay retries; on retry the unique index will
    // catch us if the row actually did land.
    return NextResponse.json(
      { ok: false, error: "AUDIT_INSERT_FAILED" },
      { status: 500 }
    );
  }

  // 5. Branch on event type. Unknown events are audited above but
  //    cause no state change. Return 200 so Razorpay stops retrying.
  if (eventType !== TYPE_PAYMENT_CAPTURED && eventType !== TYPE_PAYMENT_FAILED) {
    return NextResponse.json({ ok: true, ignored: true, eventType });
  }

  if (!orderIdFromEvent) {
    console.warn("[payments/webhook] payment event missing order_id", {
      eventId,
      eventType,
    });
    return NextResponse.json({ ok: true, malformed: true });
  }

  // 6. Resolve the order row. provider_id and plan_code come from
  //    payment_orders, NOT from event.notes — defense in depth against
  //    a forged notes payload (notes are signed by Razorpay only as
  //    part of the whole event, but trusting our own DB row is safer
  //    and removes one class of mistakes).
  //
  //    Phase 2 additions in the select list: plan_change_mode tells
  //    the post-capture branch whether to write provider_plans.scheduled_*
  //    (scheduled_paid_lower) or update the active period (the legacy
  //    immediate path). scheduled_activates_at + scheduled_region_codes
  //    carry the schedule context recorded at order time.
  const { data: orderRows, error: orderLookupError } = await adminSupabase
    .from("payment_orders")
    .select(
      "order_id, provider_id, plan_code, amount_paise, status, plan_change_mode, scheduled_activates_at, scheduled_region_codes, current_plan_code_at_order"
    )
    .eq("order_id", orderIdFromEvent)
    .limit(1);

  if (orderLookupError) {
    console.error("[payments/webhook] order lookup failed", orderLookupError);
    return NextResponse.json(
      { ok: false, error: "ORDER_LOOKUP_FAILED" },
      { status: 500 }
    );
  }

  const orderRow = orderRows && orderRows.length > 0 ? orderRows[0] : null;
  if (!orderRow) {
    // We have a signed webhook for an order we never created. This is
    // odd (clock skew? deleted row? wrong webhook secret pointed at
    // wrong env?). Audit row is already written; return 200 so
    // Razorpay stops retrying.
    console.warn("[payments/webhook] order not found", {
      orderId: orderIdFromEvent,
      eventId,
    });
    return NextResponse.json({ ok: true, orderNotFound: true });
  }

  const providerId = String(orderRow.provider_id);
  const orderPlanCode = String(orderRow.plan_code);

  // ── payment.failed ────────────────────────────────────────────────
  if (eventType === TYPE_PAYMENT_FAILED) {
    if (orderRow.status === "paid") {
      // Already paid via a successful capture earlier. Don't downgrade
      // on a late-arriving failed event.
      return NextResponse.json({ ok: true, alreadyPaid: true });
    }
    const { error: failUpdateError } = await adminSupabase
      .from("payment_orders")
      .update({
        status: "failed",
        razorpay_payment_id: razorpayPaymentId,
        raw_webhook: parsed,
      })
      .eq("order_id", orderRow.order_id);

    if (failUpdateError) {
      console.error("[payments/webhook] payment_orders failed-update failed", failUpdateError);
      return NextResponse.json(
        { ok: false, error: "ORDER_FAIL_UPDATE_FAILED" },
        { status: 500 }
      );
    }
    // Phase A: in-app admin alert (soft-fail, deduped on order_id).
    await notifyAdmins("payment_failed", {
      payment_order_id: orderRow.order_id,
      provider_id: orderRow.provider_id,
      plan_code: orderRow.plan_code,
    });
    return NextResponse.json({ ok: true });
  }

  // ── payment.captured ──────────────────────────────────────────────
  if (orderRow.status === "paid") {
    // Already processed (likely a manual webhook replay). Idempotent.
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  // Defense in depth: confirm the captured amount matches what we
  // created the order for. Mismatch is suspicious but not fatal —
  // audit it and refuse to upgrade. We do not advance status either,
  // so the order stays in 'created' for manual review.
  const capturedAmount =
    typeof paymentEntity?.amount === "number" ? paymentEntity.amount : null;
  if (capturedAmount !== null && capturedAmount !== orderRow.amount_paise) {
    console.error("[payments/webhook] amount mismatch", {
      orderId: orderRow.order_id,
      expectedPaise: orderRow.amount_paise,
      capturedPaise: capturedAmount,
    });
    return NextResponse.json({ ok: true, amountMismatch: true });
  }

  if (!isPaidPlanCode(orderPlanCode)) {
    console.error("[payments/webhook] unknown plan_code on order", {
      orderId: orderRow.order_id,
      planCode: orderPlanCode,
    });
    return NextResponse.json({ ok: true, unknownPlanCode: true });
  }

  // Phase 2: branch on the classification recorded at order time. We
  // do NOT re-classify here — the order is the contract, and the
  // provider's effective plan may have shifted between order and
  // capture (e.g. their current_period_end passed during the few
  // seconds Razorpay was holding the payment).
  //
  // Legacy orders (created before Phase 2) have plan_change_mode=NULL.
  // Those fall through the default branch which preserves Stage 2
  // behaviour exactly: an immediate upsert of provider_plans.
  const recordedMode = String(
    (orderRow as { plan_change_mode?: string | null }).plan_change_mode ?? ""
  );
  const isScheduledLower = recordedMode === "scheduled_paid_lower";

  const now = new Date();
  const maxRegions = getPlanMaxRegions(orderPlanCode);

  // ── Scheduled paid lower: write provider_plans.scheduled_* + areas ─
  if (isScheduledLower) {
    // Phase 3.1 hardening: confirm the provider is currently on an
    // active paid plan before writing scheduled_* fields. Defends
    // against two failure modes that should be impossible by design
    // but would corrupt active state if they ever happened:
    //   (a) provider_plans row deleted between order and capture
    //   (b) current_period_end passed during the Razorpay hold window,
    //       collapsing the effective plan to free
    // In either case we refuse to advance. The order stays in
    // 'created' (Razorpay retries up to 24h, then admin reconciles
    // via the future "stuck payments" surface). Writing scheduled_*
    // onto a row that no longer represents an active paid plan would
    // be worse than the alternative.
    const { data: activePlanRow, error: activePlanError } = await adminSupabase
      .from("provider_plans")
      .select(
        "plan_code, max_regions, current_period_start, current_period_end"
      )
      .eq("provider_id", providerId)
      .maybeSingle();

    if (activePlanError) {
      console.error(
        "[payments/webhook] scheduled_paid_lower active-plan lookup failed",
        activePlanError
      );
      return NextResponse.json(
        { ok: false, error: "ACTIVE_PLAN_LOOKUP_FAILED" },
        { status: 500 }
      );
    }

    const effective = effectivePlan(activePlanRow ?? null);
    if (!effective.active || effective.code === "free") {
      console.error(
        "[payments/webhook] scheduled_paid_lower without active paid plan",
        {
          orderId: orderRow.order_id,
          providerId,
          effectiveCode: effective.code,
          effectiveActive: effective.active,
          currentPeriodEnd: effective.currentPeriodEnd,
        }
      );
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_NO_ACTIVE_PAID_PLAN" },
        { status: 500 }
      );
    }

    const scheduledActivatesAt = String(
      (orderRow as { scheduled_activates_at?: string | null })
        .scheduled_activates_at ?? ""
    );
    if (!scheduledActivatesAt) {
      // Should not happen — the create-order route requires it for
      // scheduled_paid_lower and the chk_payment_orders_scheduled_lower_
      // context CHECK constraint enforces it at the DB layer. Log and
      // refuse to advance.
      console.error("[payments/webhook] scheduled_paid_lower missing activates_at", {
        orderId: orderRow.order_id,
      });
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_CONTEXT_MISSING" },
        { status: 500 }
      );
    }

    const rawCodes = (orderRow as {
      scheduled_region_codes?: string[] | null;
    }).scheduled_region_codes;
    if (!Array.isArray(rawCodes) || rawCodes.length === 0) {
      console.error("[payments/webhook] scheduled_paid_lower missing region codes", {
        orderId: orderRow.order_id,
      });
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_REGION_CODES_MISSING" },
        { status: 500 }
      );
    }

    // Resolve provider's city_code so provider_scheduled_areas rows
    // carry the right (region_code, city_code) pair. We re-read instead
    // of trusting any cached value because the create-order route
    // already validated city + region at order time; the failure mode
    // here is "provider deleted all areas between order and capture".
    let providerCityCode = "";
    const { data: areaRows } = await adminSupabase
      .from("provider_areas")
      .select("city_code")
      .eq("provider_id", providerId);
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
      console.error("[payments/webhook] scheduled_paid_lower city unresolved", {
        orderId: orderRow.order_id,
      });
      return NextResponse.json(
        { ok: false, error: "PROVIDER_CITY_UNKNOWN" },
        { status: 500 }
      );
    }

    // Re-validate region codes against the active service_regions for
    // the city. Regions may have been deactivated between order and
    // capture; refuse activation rather than persisting stale codes.
    //
    // Phase 3.1: also fetch region_name so we can populate
    // provider_scheduled_areas.area (now NOT NULL via the
    // chk_provider_scheduled_areas_area_not_empty CHECK). Storing the
    // display name here lets the Phase 3.2 activation function copy
    // rows into provider_areas without an extra join under the lock.
    const { data: validRows, error: regionsErr } = await adminSupabase
      .from("service_regions")
      .select("region_code, region_name")
      .in("region_code", rawCodes)
      .eq("city_code", providerCityCode)
      .eq("active", true);
    if (regionsErr) {
      console.error("[payments/webhook] region revalidation failed", regionsErr);
      return NextResponse.json(
        { ok: false, error: "REGION_REVALIDATION_FAILED" },
        { status: 500 }
      );
    }
    const regionNameByCode = new Map<string, string>();
    for (const r of (validRows ?? []) as Array<{
      region_code?: string | null;
      region_name?: string | null;
    }>) {
      const code = String(r.region_code ?? "").trim();
      const name = String(r.region_name ?? "").trim();
      if (code && name) regionNameByCode.set(code, name);
    }
    if (regionNameByCode.size !== rawCodes.length) {
      console.error("[payments/webhook] some scheduled regions no longer valid", {
        orderId: orderRow.order_id,
        requested: rawCodes,
        valid: Array.from(regionNameByCode.keys()),
      });
      // Refuse to advance. Order stays in 'created' for manual review;
      // the provider's payment is recorded in payment_webhook_events
      // and razorpay_payment_id is null on payment_orders so support
      // can reconcile via the Razorpay dashboard.
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_REGIONS_DEACTIVATED" },
        { status: 500 }
      );
    }

    // Three writes, all idempotent:
    //   (a) provider_plans.scheduled_* via UPDATE keyed on provider_id
    //   (b) provider_scheduled_areas via UPSERT keyed on (provider, region)
    //   (c) payment_orders.status = 'paid'
    // Order: (a) → (b) → (c). If (c) fails, Razorpay retries; the retry
    // path sees status='created' AND already-set scheduled_* fields,
    // which (a)'s idempotent UPDATE re-issues harmlessly.

    const { error: planUpdateError } = await adminSupabase
      .from("provider_plans")
      .upsert(
        {
          // We must NOT clobber current plan_code/max_regions/period_*
          // for an active higher plan. UPSERT with these fields means
          // a brand-new provider with no row would land here on free
          // semantics — defensive: a true scheduled_paid_lower requires
          // an active paid plan, so a missing row indicates a bug
          // upstream. We branch here rather than blindly upsert.
          provider_id: providerId,
          // Preserve current period state by NOT including those
          // columns. PostgREST upsert with onConflict only touches
          // the columns we send.
          scheduled_plan_code: orderPlanCode,
          scheduled_max_regions: maxRegions,
          scheduled_activates_at: scheduledActivatesAt,
          scheduled_payment_order_id: orderRow.order_id,
          scheduled_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "provider_id" }
      );

    if (planUpdateError) {
      console.error(
        "[payments/webhook] scheduled provider_plans upsert failed",
        planUpdateError
      );
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_PLAN_UPSERT_FAILED" },
        { status: 500 }
      );
    }

    // Replace any pre-existing pending rows for this provider. The
    // create-order route rejects a second scheduled paid order while
    // one is queued, so the only way two attempts could overlap is a
    // retry of the same webhook. Delete-then-insert keeps the table
    // clean rather than leaving stale codes from a previous attempt.
    const { error: deletePendingError } = await adminSupabase
      .from("provider_scheduled_areas")
      .delete()
      .eq("provider_id", providerId);
    if (deletePendingError) {
      console.error(
        "[payments/webhook] provider_scheduled_areas delete failed",
        deletePendingError
      );
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_AREAS_DELETE_FAILED" },
        { status: 500 }
      );
    }

    // Phase 3.1: include area (region_name from service_regions) so
    // the activation function in Phase 3.2 can copy rows directly into
    // provider_areas without an extra join. The chk_provider_scheduled_
    // areas_area_not_empty CHECK constraint rejects NULL/empty here, so
    // the validation above (regionNameByCode.size === rawCodes.length)
    // is the only path that reaches this insert; defensive fallback to
    // the code is unreachable but kept for type safety.
    const pendingRows = rawCodes.map((code) => ({
      provider_id: providerId,
      region_code: code,
      city_code: providerCityCode,
      area: regionNameByCode.get(code) ?? code,
    }));
    const { error: insertPendingError } = await adminSupabase
      .from("provider_scheduled_areas")
      .insert(pendingRows);
    if (insertPendingError) {
      console.error(
        "[payments/webhook] provider_scheduled_areas insert failed",
        insertPendingError
      );
      return NextResponse.json(
        { ok: false, error: "SCHEDULED_AREAS_INSERT_FAILED" },
        { status: 500 }
      );
    }

    const { error: paidUpdateError } = await adminSupabase
      .from("payment_orders")
      .update({
        status: "paid",
        razorpay_payment_id: razorpayPaymentId,
        paid_at: now.toISOString(),
        raw_webhook: parsed,
      })
      .eq("order_id", orderRow.order_id);

    if (paidUpdateError) {
      console.error(
        "[payments/webhook] payment_orders paid-update failed (scheduled)",
        paidUpdateError
      );
      return NextResponse.json(
        { ok: false, error: "ORDER_PAID_UPDATE_FAILED" },
        { status: 500 }
      );
    }

    // Phase 2: GST invoice issuance. Payment-first + soft-fail — runs only
    // after status='paid' committed, gated by KK_INVOICE_LEDGER_ENABLED, and
    // can never break activation or trigger a Razorpay retry. Idempotent in
    // the DB function (no duplicate invoice on webhook replay).
    await safeIssueInvoiceForPaidOrder(orderRow.order_id);

    // Phase A: in-app admin alert (soft-fail, deduped on order_id; a
    // webhook retry never creates a second alert; never throws).
    await notifyAdmins("provider_paid_plan_subscribed", {
      payment_order_id: orderRow.order_id,
      provider_id: orderRow.provider_id,
      plan_code: orderRow.plan_code,
      amount_paise: orderRow.amount_paise,
    });

    // Cache invalidation after the scheduled_paid_lower writes commit.
    // Awaited (not fire-and-forget) so the L1+L2 purges complete before
    // we return — but soft-fail so a cache outage can never trigger a
    // Razorpay retry on an already-paid order.
    await safeInvalidatePaymentCaches();

    return NextResponse.json({ ok: true, scheduled: true });
  }

  // ── Immediate upgrade / renewal / legacy (mode IS NULL) ────────────
  // Two writes, ordered: plan upsert first, then payment_orders flip.
  // "status=paid" implies "provider_plans is upserted." If the second
  // fails, the order stays 'created' and Razorpay retries; the retry
  // path's idempotent plan upsert re-issues harmlessly.
  const periodStart = now.toISOString();
  const periodEnd = new Date(
    now.getTime() + PLAN_VALIDITY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error: planUpsertError } = await adminSupabase
    .from("provider_plans")
    .upsert(
      {
        provider_id: providerId,
        plan_code: orderPlanCode,
        max_regions: maxRegions,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        last_payment_id: razorpayPaymentId,
        updated_at: now.toISOString(),
      },
      { onConflict: "provider_id" }
    );

  if (planUpsertError) {
    console.error("[payments/webhook] provider_plans upsert failed", planUpsertError);
    return NextResponse.json(
      { ok: false, error: "PLAN_UPSERT_FAILED" },
      { status: 500 }
    );
  }

  const { error: paidUpdateError } = await adminSupabase
    .from("payment_orders")
    .update({
      status: "paid",
      razorpay_payment_id: razorpayPaymentId,
      paid_at: now.toISOString(),
      raw_webhook: parsed,
    })
    .eq("order_id", orderRow.order_id);

  if (paidUpdateError) {
    console.error("[payments/webhook] payment_orders paid-update failed", paidUpdateError);
    return NextResponse.json(
      { ok: false, error: "ORDER_PAID_UPDATE_FAILED" },
      { status: 500 }
    );
  }

  // Reconcile provider_areas against the just-activated plan so coverage
  // never drifts from entitlement. This is the auto-write for an immediate
  // all_jodhpur upgrade (the webhook does not otherwise touch
  // provider_areas) and a trim for an immediate downgrade/renewal. Strictly
  // best-effort: a reconcile failure must never trigger a Razorpay retry on
  // an already-paid order, so it is logged and swallowed. The admin
  // "Rebuild Provider Coverage" button is the manual backstop.
  try {
    const coverage = await reconcileProviderCoverage(providerId);
    if (!coverage.ok || coverage.errors.length > 0) {
      console.warn("[payments/webhook] coverage reconcile reported issues", {
        providerId,
        scanError: coverage.scanError ?? null,
        errors: coverage.errors,
        warnings: coverage.warnings,
      });
    }
  } catch (err) {
    console.warn(
      "[payments/webhook] coverage reconcile threw (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }

  // Phase 2: GST invoice issuance. Payment-first + soft-fail — runs only
  // after status='paid' committed, gated by KK_INVOICE_LEDGER_ENABLED, and
  // can never break activation or trigger a Razorpay retry. Idempotent in
  // the DB function (no duplicate invoice on webhook replay).
  await safeIssueInvoiceForPaidOrder(orderRow.order_id);

  // Phase A: in-app admin alert (soft-fail, deduped on order_id; a
  // webhook retry never creates a second alert; never throws).
  await notifyAdmins("provider_paid_plan_subscribed", {
    payment_order_id: orderRow.order_id,
    provider_id: orderRow.provider_id,
    plan_code: orderRow.plan_code,
    amount_paise: orderRow.amount_paise,
  });

  // Cache invalidation after immediate-upgrade / immediate-renewal /
  // legacy NULL-mode writes commit. Same soft-fail rules as the
  // scheduled branch — never block the 200 OK.
  await safeInvalidatePaymentCaches();

  return NextResponse.json({ ok: true });
}
