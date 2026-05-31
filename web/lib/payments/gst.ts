/**
 * Phase A: GST math for paid provider plans.
 *
 * Pure, dependency-free, and safe to import from BOTH server route
 * handlers and client components (no `node:crypto`, no "server-only").
 *
 * Pricing is GST-EXCLUSIVE: the plan base (₹31 / ₹101) is the taxable
 * value and 18% GST is added on top, so Razorpay charges base + GST
 * (₹36.58 / ₹119.18). This module is the single source of truth for
 * that arithmetic so the amount we CHARGE (server) and the amount we
 * SHOW before payment (client) can never drift.
 *
 * Intra-state (Rajasthan — the only case today) splits GST into
 * CGST 9% + SGST 9%; the split is computed here so an invoice can later
 * reuse the exact same paise without re-deriving.
 */

export const GST_RATE_BPS = 1800; // 18%, in basis points

export type GstBreakdown = {
  basePaise: number; // taxable value (GST-exclusive)
  gstBps: number; // 1800
  gstPaise: number; // total GST = round(base * gstBps / 10000)
  cgstPaise: number; // intra-state half (absorbs the odd paise)
  sgstPaise: number; // intra-state half
  totalPaise: number; // base + gst — the amount Razorpay charges
};

/**
 * Compute the GST breakdown for a GST-exclusive base amount in paise.
 *
 * Rounding rule (fixed so the constraints reconcile exactly):
 *   gst   = round(base * gstBps / 10000)
 *   sgst  = floor(gst / 2)
 *   cgst  = gst - sgst        // CGST absorbs the odd paise
 *   total = base + gst
 * Guarantees: cgst + sgst === gst and base + gst === total, always.
 */
export function computeGstBreakdown(
  basePaise: number,
  gstBps: number = GST_RATE_BPS
): GstBreakdown {
  const safeBase = Math.max(0, Math.round(basePaise));
  const gstPaise = Math.round((safeBase * gstBps) / 10_000);
  const sgstPaise = Math.floor(gstPaise / 2);
  const cgstPaise = gstPaise - sgstPaise;
  return {
    basePaise: safeBase,
    gstBps,
    gstPaise,
    cgstPaise,
    sgstPaise,
    totalPaise: safeBase + gstPaise,
  };
}

/**
 * Format paise as a 2-decimal rupee string for display, e.g.
 * 3658 → "36.58", 3100 → "31.00". Callers prepend the ₹ symbol.
 */
export function formatPaiseToRupees(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
