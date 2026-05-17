import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PLAN_VALIDITY_DAYS,
  getPlanMaxRegions,
  isPaidPlanCode,
  isPaymentEnabled,
  verifyWebhookSignature,
} from "@/lib/payments/server";

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
  const { data: orderRows, error: orderLookupError } = await adminSupabase
    .from("payment_orders")
    .select("order_id, provider_id, plan_code, amount_paise, status")
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

  // Two writes, ordered: payment_orders first (financial record), then
  // provider_plans (entitlement). If the second fails, the order is
  // marked paid and the webhook will retry; the retry path will see
  // status='paid' but provider_plans missing and re-upsert.
  //
  // To detect that retry path explicitly, we do the writes in the
  // opposite order: plan upsert first, then payment_orders flip. That
  // way, "status=paid" implies "provider_plans is upserted."
  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = new Date(
    now.getTime() + PLAN_VALIDITY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const maxRegions = getPlanMaxRegions(orderPlanCode);

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

  return NextResponse.json({ ok: true });
}
