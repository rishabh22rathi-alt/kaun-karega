/**
 * Server-only Razorpay helpers. Stage 2 payment rails.
 *
 * Threat model:
 *   - RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are server-only.
 *     This module MUST NOT be imported from any client component or
 *     client-bundled file. Grep before adding imports:
 *       `RAZORPAY_KEY_SECRET` should appear only under web/lib/payments/
 *       and web/app/api/payments/.
 *
 *   - Plan amount is server-derived. The client picks a `plan_code`;
 *     the amount comes from PLAN_PRICING below. Never accept an
 *     amount from the request body.
 *
 *   - Signature comparisons use `crypto.timingSafeEqual` to avoid
 *     timing oracles on signature verification.
 *
 * No app behavior changes until the route handlers in
 * web/app/api/payments/* are wired in this same stage.
 */

import crypto from "node:crypto";

// ─── Feature flags ─────────────────────────────────────────────────────────

/**
 * Master kill switch for Stage 2 payment rails. Read on every call (not
 * at module load) so flipping in Vercel env console takes effect without
 * a redeploy.
 *
 * Default: false. A misconfigured deploy that forgot to set this var
 * keeps payments off rather than accidentally accepting orders.
 */
export function isPaymentEnabled(): boolean {
  return String(process.env.PAYMENT_ENABLED || "").trim().toLowerCase() === "true";
}

// PAYMENT_ENFORCEMENT_ENABLED is reserved for Stage 3. Not read here.

// ─── Pricing ───────────────────────────────────────────────────────────────

/**
 * Plan price map in paise (₹1 = 100 paise). Source of truth.
 *
 *   regions_5     → ₹31   (3100 paise)  → max_regions=5
 *   all_jodhpur   → ₹101  (10100 paise) → max_regions=99
 *
 * Free plan is the implicit fallback (no row in provider_plans) and is
 * not represented here — it cannot be paid for.
 */
export const PLAN_PRICING = {
  regions_5: { amountPaise: 3100, maxRegions: 5 },
  all_jodhpur: { amountPaise: 10100, maxRegions: 99 },
} as const;

export type PaidPlanCode = keyof typeof PLAN_PRICING;

export function isPaidPlanCode(value: unknown): value is PaidPlanCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLAN_PRICING, value);
}

export function getPlanAmountPaise(planCode: PaidPlanCode): number {
  return PLAN_PRICING[planCode].amountPaise;
}

export function getPlanMaxRegions(planCode: PaidPlanCode): number {
  return PLAN_PRICING[planCode].maxRegions;
}

/**
 * Paid plan validity period. Stage-2 / MVP-3 decision: 30-day prepaid
 * one-shot orders. No subscriptions, no auto-renew, no mandates.
 */
export const PLAN_VALIDITY_DAYS = 30;

// ─── Credential accessors ──────────────────────────────────────────────────

type RazorpayCreds = { keyId: string; keySecret: string };

/**
 * Returns Razorpay key id + secret, or null if either is missing. The
 * null return is the safest failure mode for misconfigured deploys —
 * route handlers translate it into a 503 rather than crashing.
 */
export function getRazorpayCredentials(): RazorpayCreds | null {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export function getRazorpayWebhookSecret(): string | null {
  const v = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  return v ? v : null;
}

// ─── Razorpay Orders API ───────────────────────────────────────────────────

export type CreateRazorpayOrderInput = {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
};

export type RazorpayOrderResponse = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

/**
 * Create an order via Razorpay's REST API. We call REST directly to avoid
 * pulling in the `razorpay` npm package — fewer dependencies, no SDK
 * surprises across versions, and the API is small.
 *
 * Returns the Razorpay order on success or an error string on failure
 * (network, non-200, malformed body). Caller decides the HTTP response.
 */
export async function createRazorpayOrder(
  input: CreateRazorpayOrderInput
): Promise<{ ok: true; order: RazorpayOrderResponse } | { ok: false; error: string }> {
  const creds = getRazorpayCredentials();
  if (!creds) return { ok: false, error: "RAZORPAY_CREDENTIALS_MISSING" };

  const body = {
    amount: input.amountPaise,
    currency: input.currency || "INR",
    receipt: input.receipt,
    notes: input.notes,
    // payment_capture: 1 is the default for the v1/orders endpoint;
    // we keep auto-capture so payment.captured fires on the webhook.
  };

  const basicAuth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: `RAZORPAY_NETWORK_ERROR: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    raw = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `RAZORPAY_HTTP_${response.status}: ${JSON.stringify(raw ?? null)}`,
    };
  }

  const r = raw as Partial<RazorpayOrderResponse> | null;
  if (!r || typeof r.id !== "string" || typeof r.amount !== "number" || typeof r.currency !== "string") {
    return { ok: false, error: "RAZORPAY_MALFORMED_RESPONSE" };
  }

  return {
    ok: true,
    order: {
      id: r.id,
      amount: r.amount,
      currency: r.currency,
      status: typeof r.status === "string" ? r.status : "",
    },
  };
}

// ─── Signature verification ────────────────────────────────────────────────

/**
 * Constant-time HMAC-SHA256 verification.
 *
 * Returns false on any error (key missing, encoding error, length
 * mismatch). Callers should treat false as "untrusted, reject" — never
 * as "transient, retry."
 */
function verifyHmacSha256(
  secret: string,
  payload: string,
  providedSignatureHex: string
): boolean {
  if (!secret || !payload || !providedSignatureHex) return false;

  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    const expectedHex = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    expectedBuf = Buffer.from(expectedHex, "hex");
    providedBuf = Buffer.from(providedSignatureHex, "hex");
  } catch {
    return false;
  }

  // timingSafeEqual requires equal-length buffers; differing lengths
  // are an automatic failure but must be checked first to avoid throwing.
  if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

/**
 * Verify the Razorpay checkout redirect signature.
 *
 * Razorpay computes HMAC-SHA256 over `${orderId}|${paymentId}` using the
 * KEY_SECRET (not the webhook secret) and returns it as the
 * `razorpay_signature` field in the success callback.
 *
 * Returns false if KEY_SECRET is missing — callers should treat that as
 * a 503 (server misconfigured) rather than reporting it to the client.
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const creds = getRazorpayCredentials();
  if (!creds) return false;
  const payload = `${params.orderId}|${params.paymentId}`;
  return verifyHmacSha256(creds.keySecret, payload, params.signature);
}

/**
 * Verify the Razorpay webhook signature.
 *
 * IMPORTANT: this function takes the RAW REQUEST BODY (the exact bytes
 * Razorpay sent). The caller MUST read the body via `await req.text()`
 * BEFORE doing any JSON parsing, or any byte-level transformation will
 * break the HMAC comparison.
 *
 * Returns false if WEBHOOK_SECRET is missing.
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  signature: string;
}): boolean {
  const secret = getRazorpayWebhookSecret();
  if (!secret) return false;
  return verifyHmacSha256(secret, params.rawBody, params.signature);
}
