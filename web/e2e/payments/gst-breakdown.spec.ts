/**
 * Phase A: GST-exclusive pricing math.
 *
 * Pure-logic spec — no page navigation, so it runs in Node under the
 * Playwright runner WITHOUT a dev server. Imports the shared helper via
 * a relative path (not the @/ alias) so it resolves without tsconfig
 * path mapping in the test bundler.
 *
 * Asserts the exact paise the create-order route sends to Razorpay and
 * stores in payment_orders.amount_paise:
 *   regions_5   → 3658 paise
 *   all_jodhpur → 11918 paise
 * and the CGST/SGST split + rupee formatting the UI shows.
 */

import { test, expect } from "@playwright/test";

import {
  GST_RATE_BPS,
  computeGstBreakdown,
  formatPaiseToRupees,
} from "../../lib/payments/gst";

// Base amounts mirror PLAN_PRICING in lib/payments/server.ts. The route
// computes computePlanCharge(planCode) = computeGstBreakdown(base), so
// asserting on these bases is equivalent to asserting the route output.
const REGIONS_5_BASE = 3100; // ₹31
const ALL_JODHPUR_BASE = 10100; // ₹101

test.describe("Phase A — GST breakdown", () => {
  test("rate is 18%", () => {
    expect(GST_RATE_BPS).toBe(1800);
  });

  test("regions_5 (₹31) charges 3658 paise (base 3100 + GST 558)", () => {
    const b = computeGstBreakdown(REGIONS_5_BASE);
    expect(b.basePaise).toBe(3100);
    expect(b.gstPaise).toBe(558);
    expect(b.cgstPaise).toBe(279);
    expect(b.sgstPaise).toBe(279);
    expect(b.totalPaise).toBe(3658);
    // invariants the invoice CHECK constraints will rely on
    expect(b.cgstPaise + b.sgstPaise).toBe(b.gstPaise);
    expect(b.basePaise + b.gstPaise).toBe(b.totalPaise);
  });

  test("all_jodhpur (₹101) charges 11918 paise (base 10100 + GST 1818)", () => {
    const b = computeGstBreakdown(ALL_JODHPUR_BASE);
    expect(b.basePaise).toBe(10100);
    expect(b.gstPaise).toBe(1818);
    expect(b.cgstPaise).toBe(909);
    expect(b.sgstPaise).toBe(909);
    expect(b.totalPaise).toBe(11918);
    expect(b.cgstPaise + b.sgstPaise).toBe(b.gstPaise);
    expect(b.basePaise + b.gstPaise).toBe(b.totalPaise);
  });

  test("UI rupee labels: ₹31 + GST ₹5.58 = ₹36.58", () => {
    const b = computeGstBreakdown(REGIONS_5_BASE);
    expect(formatPaiseToRupees(b.basePaise)).toBe("31.00");
    expect(formatPaiseToRupees(b.gstPaise)).toBe("5.58");
    expect(formatPaiseToRupees(b.totalPaise)).toBe("36.58");
  });

  test("UI rupee labels: ₹101 + GST ₹18.18 = ₹119.18", () => {
    const b = computeGstBreakdown(ALL_JODHPUR_BASE);
    expect(formatPaiseToRupees(b.basePaise)).toBe("101.00");
    expect(formatPaiseToRupees(b.gstPaise)).toBe("18.18");
    expect(formatPaiseToRupees(b.totalPaise)).toBe("119.18");
  });

  test("odd-paise GST still reconciles (CGST absorbs the extra paise)", () => {
    // Guard for any FUTURE base whose 18% GST is an odd paise count.
    // base 105 → GST round(18.9)=19 → SGST 9, CGST 10, sum 19.
    const b = computeGstBreakdown(105);
    expect(b.gstPaise).toBe(19);
    expect(b.sgstPaise).toBe(9);
    expect(b.cgstPaise).toBe(10);
    expect(b.cgstPaise + b.sgstPaise).toBe(b.gstPaise);
  });
});
