/**
 * Payment safety — validateCapturedAmount pure-logic spec.
 *
 * Runs in Node under the Playwright runner WITHOUT a dev server or DB.
 * Imports the pure helper via a relative path (no @/ alias, no adminSupabase)
 * so nothing constructs a Supabase client at import time.
 *
 * Pins the webhook's "did we get paid the right amount?" decision:
 *   - null / undefined / non-numeric / NaN captured amount → missing_amount
 *   - numeric but != order amount                          → mismatch
 *   - exact match                                          → valid
 * The webhook maps any invalid result to an admin alert + HTTP 200 (no
 * activation), so a wrong/absent amount can never silently grant a plan.
 */

import { test, expect } from "@playwright/test";

import { validateCapturedAmount } from "../../lib/payments/validateCapturedAmount";

test.describe("validateCapturedAmount (payment safety)", () => {
  test("exact match → valid", () => {
    expect(validateCapturedAmount(3658, 3658)).toEqual({
      valid: true,
      capturedPaise: 3658,
    });
  });

  test("numeric mismatch → invalid (reason mismatch, both amounts surfaced)", () => {
    expect(validateCapturedAmount(100, 3658)).toEqual({
      valid: false,
      reason: "mismatch",
      capturedPaise: 100,
      expectedPaise: 3658,
    });
  });

  test("null → invalid (missing_amount)", () => {
    expect(validateCapturedAmount(null, 3658)).toEqual({
      valid: false,
      reason: "missing_amount",
      capturedPaise: null,
      expectedPaise: 3658,
    });
  });

  test("undefined → invalid (missing_amount)", () => {
    expect(validateCapturedAmount(undefined, 3658)).toMatchObject({
      valid: false,
      reason: "missing_amount",
    });
  });

  test("non-numeric string → invalid (missing_amount)", () => {
    expect(validateCapturedAmount("3658", 3658)).toMatchObject({
      valid: false,
      reason: "missing_amount",
    });
  });

  test("NaN → invalid (missing_amount)", () => {
    expect(validateCapturedAmount(Number.NaN, 3658)).toMatchObject({
      valid: false,
      reason: "missing_amount",
    });
  });

  test("zero captured vs non-zero expected → mismatch (not missing)", () => {
    expect(validateCapturedAmount(0, 3658)).toMatchObject({
      valid: false,
      reason: "mismatch",
      capturedPaise: 0,
    });
  });
});
