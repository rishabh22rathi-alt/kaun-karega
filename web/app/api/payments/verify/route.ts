import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { isPaymentEnabled, verifyCheckoutSignature } from "@/lib/payments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage 2: verify the Razorpay checkout-success redirect signature.
 *
 * This endpoint is a UX nicety, not a state machine. It lets the
 * provider's success page confirm that the signature on the redirect
 * is genuine and ACK that we received the payment_id. It NEVER grants
 * the plan — the webhook (/api/payments/webhook) is the only source of
 * truth for plan activation, even when the webhook arrives after the
 * redirect.
 *
 * Behavior:
 *   - Bad signature → 400 (do not record).
 *   - Good signature → record razorpay_payment_id + razorpay_signature
 *     on the matching payment_orders row, but do not change status.
 *     The webhook will subsequently flip status to 'paid'.
 *   - Order not found → 404 (defensive; shouldn't happen if
 *     create-order ran).
 */
export async function POST(request: Request) {
  if (!isPaymentEnabled()) {
    return NextResponse.json(
      { ok: false, error: "PAYMENTS_DISABLED" },
      { status: 503 }
    );
  }

  // Auth: keep the redirect-verify endpoint behind the same session
  // gate as create-order, so a logged-out caller cannot use it as a
  // signature oracle.
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

  const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
  const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
  const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature.trim() : "";

  if (!orderId || !paymentId || !signature) {
    return NextResponse.json(
      { ok: false, error: "MISSING_FIELDS" },
      { status: 400 }
    );
  }

  const sigValid = verifyCheckoutSignature({ orderId, paymentId, signature });
  if (!sigValid) {
    return NextResponse.json(
      { ok: false, error: "BAD_SIGNATURE" },
      { status: 400 }
    );
  }

  // Annotate the order row with the verified redirect metadata. We do
  // NOT flip status here — webhook is the source of truth. If status
  // is already 'paid' (webhook landed first), this is still safe: it
  // just refreshes razorpay_signature on the same row.
  const { data: existingRows, error: lookupError } = await adminSupabase
    .from("payment_orders")
    .select("order_id, status")
    .eq("order_id", orderId)
    .limit(1);

  if (lookupError) {
    console.error("[payments/verify] order lookup failed", lookupError);
    return NextResponse.json(
      { ok: false, error: "ORDER_LOOKUP_FAILED" },
      { status: 500 }
    );
  }
  if (!existingRows || existingRows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  const { error: updateError } = await adminSupabase
    .from("payment_orders")
    .update({
      // Setting razorpay_payment_id here intentionally — partial UNIQUE
      // index on this column tolerates a second update with the same
      // value (UPDATE is not subject to the constraint on same-row
      // writes). The webhook may set it too; same value, no conflict.
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    })
    .eq("order_id", orderId);

  if (updateError) {
    console.error("[payments/verify] order update failed", updateError);
    return NextResponse.json(
      { ok: false, error: "ORDER_UPDATE_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    // Echo the order status so the success page can decide whether to
    // poll for the webhook-driven 'paid' transition.
    status: String(existingRows[0]?.status || "created"),
    message:
      "Signature verified. Plan activation will complete once the webhook is received.",
  });
}
