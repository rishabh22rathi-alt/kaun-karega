import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  createRazorpayOrder,
  getPlanAmountPaise,
  getRazorpayCredentials,
  isPaidPlanCode,
  isPaymentEnabled,
} from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

/**
 * Stage 2: create a Razorpay order for the authenticated provider.
 *
 * Auth: signed kk_auth_session cookie. The caller's phone is resolved
 * to a provider_id via the same union pattern used elsewhere (10- vs
 * 12-digit phone forms both probed). Non-providers are rejected with
 * 403 — they cannot create payment orders.
 *
 * Amount is server-derived from PLAN_PRICING. Body fields beyond
 * `plan_code` are ignored.
 *
 * Returns { ok, order_id, key_id, amount, currency } on success. The
 * key_id is the PUBLIC half of the Razorpay credentials and is safe
 * to ship to the client; KEY_SECRET never leaves the server.
 *
 * This route never writes to provider_plans. Plan upgrades happen
 * only when the webhook receives payment.captured.
 */
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
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

  const amountPaise = getPlanAmountPaise(planCode);

  const orderResult = await createRazorpayOrder({
    amountPaise,
    currency: "INR",
    // receipt is opaque to Razorpay but visible in their dashboard —
    // include the provider id for support diagnostics. Capped at 40
    // chars (Razorpay's documented limit).
    receipt: `kk-${providerId}-${Date.now()}`.slice(0, 40),
    notes: {
      provider_id: providerId,
      plan_code: planCode,
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

  const { error: insertError } = await adminSupabase
    .from("payment_orders")
    .insert({
      order_id: order.id,
      provider_id: providerId,
      plan_code: planCode,
      amount_paise: amountPaise,
      currency: order.currency || "INR",
      status: "created",
    });

  if (insertError) {
    // The order exists at Razorpay but we couldn't record it. This is
    // not catastrophic — the webhook will still arrive and can be
    // reconciled — but it deserves a loud log so we don't quietly
    // accumulate orphan orders.
    console.error("[payments/create-order] payment_orders insert failed", {
      orderId: order.id,
      providerId,
      planCode,
      error: insertError.message,
    });
    return NextResponse.json(
      { ok: false, error: "ORDER_RECORD_FAILED" },
      { status: 500 }
    );
  }

  const creds = getRazorpayCredentials();
  // isPaymentEnabled() + createRazorpayOrder() succeeded above, so
  // creds is guaranteed present here, but null-check to satisfy TS
  // and stay safe against future refactors.
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
  });
}
