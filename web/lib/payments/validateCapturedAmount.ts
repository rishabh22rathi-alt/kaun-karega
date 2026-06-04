/**
 * Pure captured-amount validation for the Razorpay webhook (payment safety).
 *
 * The webhook must confirm we were paid EXACTLY what the order was created
 * for before activating a plan. Two failure modes, both treated as
 * "do not activate":
 *   - missing_amount: the captured amount is absent / not a finite number.
 *     A real payment.captured always carries a numeric `amount`; its
 *     absence is anomalous, so we refuse rather than activate blind.
 *   - mismatch: a numeric captured amount that differs from the order's
 *     amount_paise.
 *
 * No DB / no client imports → unit-testable in isolation. The webhook maps
 * an invalid result to an admin alert + HTTP 200 (the event is not
 * transient, so Razorpay should not retry it).
 */

export type CapturedAmountCheck =
  | { valid: true; capturedPaise: number }
  | {
      valid: false;
      reason: "missing_amount" | "mismatch";
      capturedPaise: number | null;
      expectedPaise: number;
    };

export function validateCapturedAmount(
  capturedAmountRaw: unknown,
  expectedPaise: number
): CapturedAmountCheck {
  if (typeof capturedAmountRaw !== "number" || !Number.isFinite(capturedAmountRaw)) {
    return {
      valid: false,
      reason: "missing_amount",
      capturedPaise: null,
      expectedPaise,
    };
  }
  if (capturedAmountRaw !== expectedPaise) {
    return {
      valid: false,
      reason: "mismatch",
      capturedPaise: capturedAmountRaw,
      expectedPaise,
    };
  }
  return { valid: true, capturedPaise: capturedAmountRaw };
}
