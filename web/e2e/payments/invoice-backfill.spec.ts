/**
 * Phase 2.5: invoice backfill — pure-logic spec.
 *
 * Runs in Node without a server/DB. Covers the new branching logic:
 * which paid orders are missing an invoice (recovery target + scan-layer
 * idempotency), the exact missing-count metric, and outcome roll-up.
 *
 * DB-level behaviour (the worker actually calling
 * issue_invoice_for_paid_order, the function's own idempotency, audit
 * rows) is covered by the function's idempotency in
 * supabase/tests/invoice_issuance_phase_2.test.sql — the backfill only
 * routes missing orders through that same function.
 */

import { test, expect } from "@playwright/test";

import {
  computeMissingOrderIds,
  computeMissingCount,
  summarizeOutcomes,
  type BackfillOutcome,
} from "../../lib/payments/invoiceBackfillCore";

test.describe("Phase 2.5 — invoice backfill core", () => {
  test("missing = paid orders with no invoice, order preserved", () => {
    const paid = [{ order_id: "a" }, { order_id: "b" }, { order_id: "c" }];
    expect(computeMissingOrderIds(paid, ["b"])).toEqual(["a", "c"]);
    // oldest-first order preserved (keeps backfilled numbers chronological)
    expect(computeMissingOrderIds(paid, [])).toEqual(["a", "b", "c"]);
  });

  test("idempotent at scan layer: fully-invoiced batch → nothing to do", () => {
    const paid = [{ order_id: "a" }, { order_id: "b" }];
    expect(computeMissingOrderIds(paid, ["a", "b"])).toEqual([]);
    // a re-run right after issuing 'a' only leaves 'b'
    expect(computeMissingOrderIds(paid, ["a"])).toEqual(["b"]);
  });

  test("missing-set ignores blank/dupe ids defensively", () => {
    const paid = [{ order_id: " a " }, { order_id: "" }, { order_id: "b" }];
    // blank dropped; surrounding whitespace trimmed for the membership test
    expect(computeMissingOrderIds(paid, ["a"])).toEqual(["b"]);
  });

  test("missing count = paidOrders - invoices, clamped at 0", () => {
    expect(computeMissingCount(5, 2)).toBe(3);
    expect(computeMissingCount(0, 0)).toBe(0);
    // never negative even if counts look inconsistent
    expect(computeMissingCount(2, 5)).toBe(0);
  });

  test("outcome roll-up tallies issued/existed/skipped/failed", () => {
    const outcomes: BackfillOutcome[] = [
      "issued",
      "exists",
      "issued",
      "failed",
      "skipped",
      "exists",
    ];
    expect(summarizeOutcomes(outcomes)).toEqual({
      issued: 2,
      existed: 2,
      skipped: 1,
      failed: 1,
    });
  });
});
