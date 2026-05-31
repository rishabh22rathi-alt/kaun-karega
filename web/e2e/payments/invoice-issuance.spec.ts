/**
 * Phase 2: GST invoice issuance — pure-logic spec.
 *
 * Runs in Node under the Playwright runner WITHOUT a dev server or DB.
 * Covers the parts of the 6 required scenarios that don't need Postgres:
 *   1. flag off  → no invoice attempt (rpc never called)
 *   3. idempotent "exists" outcome is treated as success
 *   4. issuance failure (rpc error OR throw) never propagates (soft-fail)
 *   5. GST split totals equal the captured amount
 * The DB-backed scenarios (2 created, 3 no-duplicate at the constraint
 * layer, 6 ledger+audit rows) are exercised by
 * supabase/tests/invoice_issuance_phase_2.test.sql (run against a DB).
 *
 * Imports the pure core via a relative path (no @/ alias, no adminSupabase)
 * so nothing tries to construct a Supabase client at import time.
 */

import { test, expect } from "@playwright/test";

import {
  runInvoiceIssuance,
  type InvoiceIssueRpc,
} from "../../lib/payments/issueInvoiceCore";

// Mirrors the GST arithmetic inside issue_invoice_for_paid_order so the
// expected ledger/invoice amounts are pinned. total is the GST-inclusive
// captured amount (Phase A); taxable/tax are derived so total = taxable+tax.
function deriveSplit(totalPaise: number, intra: boolean) {
  const taxable = Math.round(totalPaise / 1.18);
  const tax = totalPaise - taxable;
  if (intra) {
    const sgst = Math.floor(tax / 2);
    const cgst = tax - sgst;
    return { taxable, tax, cgst, sgst, igst: 0 };
  }
  return { taxable, tax, cgst: 0, sgst: 0, igst: tax };
}

test.describe("Phase 2 — invoice issuance core", () => {
  test("scenario 1: flag OFF → no invoice attempt", async () => {
    let calls = 0;
    const rpc: InvoiceIssueRpc = async () => {
      calls++;
      return { data: { outcome: "issued" }, error: null };
    };
    const r = await runInvoiceIssuance("order_x", { enabled: false, rpc });
    expect(calls).toBe(0); // rpc never invoked
    expect(r.attempted).toBe(false);
    expect(r.ok).toBe(true); // off is a safe success, not a failure
  });

  test("scenario 2 (wrapper): flag ON + issued → attempted & ok", async () => {
    let calls = 0;
    const rpc: InvoiceIssueRpc = async (id) => {
      calls++;
      expect(id).toBe("order_a");
      return {
        data: { ok: true, outcome: "issued", invoice_number: "KK/FY2026-27/000001" },
        error: null,
      };
    };
    const r = await runInvoiceIssuance("order_a", { enabled: true, rpc });
    expect(calls).toBe(1);
    expect(r).toMatchObject({ attempted: true, ok: true, outcome: "issued" });
  });

  test("scenario 3: duplicate → 'exists' treated as success (idempotent)", async () => {
    const rpc: InvoiceIssueRpc = async () => ({
      data: { ok: true, outcome: "exists", invoice_number: "KK/FY2026-27/000001" },
      error: null,
    });
    const r = await runInvoiceIssuance("order_dup", { enabled: true, rpc });
    expect(r).toMatchObject({ attempted: true, ok: true, outcome: "exists" });
  });

  test("scenario 4a: rpc error → soft-fail, never throws", async () => {
    const rpc: InvoiceIssueRpc = async () => ({
      data: null,
      error: { message: "boom" },
    });
    const r = await runInvoiceIssuance("order_err", { enabled: true, rpc });
    expect(r).toMatchObject({ attempted: true, ok: false });
  });

  test("scenario 4b: rpc throws → soft-fail, never throws", async () => {
    const rpc: InvoiceIssueRpc = async () => {
      throw new Error("network down");
    };
    let threw = false;
    let r;
    try {
      r = await runInvoiceIssuance("order_throw", { enabled: true, rpc });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false); // activation must never see an exception
    expect(r).toMatchObject({ attempted: true, ok: false });
  });

  test("scenario 4c: DB outcome 'skipped'/'failed' → ok:false (still no throw)", async () => {
    for (const outcome of ["skipped", "failed"] as const) {
      const rpc: InvoiceIssueRpc = async () => ({
        data: { ok: false, outcome, error_code: "X" },
        error: null,
      });
      const r = await runInvoiceIssuance("order_s", { enabled: true, rpc });
      expect(r).toMatchObject({ attempted: true, ok: false, outcome });
    }
  });

  test("scenario 5: totals equal captured amount (intra-state split)", async () => {
    // regions_5 captured = 3658 paise
    expect(deriveSplit(3658, true)).toEqual({
      taxable: 3100,
      tax: 558,
      cgst: 279,
      sgst: 279,
      igst: 0,
    });
    // all_jodhpur captured = 11918 paise
    expect(deriveSplit(11918, true)).toEqual({
      taxable: 10100,
      tax: 1818,
      cgst: 909,
      sgst: 909,
      igst: 0,
    });
    // invariant: taxable + tax === captured total for both
    for (const total of [3658, 11918]) {
      const s = deriveSplit(total, true);
      expect(s.taxable + s.tax).toBe(total);
      expect(s.cgst + s.sgst + s.igst).toBe(s.tax);
    }
  });

  test("scenario 5b: inter-state → IGST carries the whole tax", async () => {
    const s = deriveSplit(3658, false);
    expect(s).toEqual({ taxable: 3100, tax: 558, cgst: 0, sgst: 0, igst: 558 });
    expect(s.taxable + s.igst).toBe(3658);
  });
});
