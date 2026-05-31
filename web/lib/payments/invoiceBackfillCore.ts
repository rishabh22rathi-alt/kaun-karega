/**
 * Phase 2.5: pure helpers for invoice recovery/backfill.
 *
 * No DB/client imports → unit-testable. The worker (invoiceBackfill.ts)
 * does the I/O; these functions hold the only branching logic worth
 * pinning in tests: which paid orders are missing an invoice, the exact
 * "missing" count, and how per-order outcomes roll up.
 */

export type BackfillOutcome = "issued" | "exists" | "skipped" | "failed";

/**
 * Paid orders that have no invoice yet, order-preserving.
 *
 * Callers pass paid orders oldest-first; preserving input order keeps
 * backfilled invoice numbers chronological. An order already present in
 * `invoicedOrderIds` is excluded — so a re-run after a successful issue
 * finds nothing (idempotent at the scan layer; the DB function is the
 * hard idempotency backstop).
 */
export function computeMissingOrderIds(
  paidOrders: Array<{ order_id: string }>,
  invoicedOrderIds: Iterable<string>
): string[] {
  const have = new Set<string>();
  for (const id of invoicedOrderIds) have.add(String(id));
  const out: string[] = [];
  for (const o of paidOrders) {
    const id = String(o?.order_id ?? "").trim();
    if (id && !have.has(id)) out.push(id);
  }
  return out;
}

/**
 * Exact count of paid orders missing an invoice.
 *
 * Relies on the invariant that every invoice references exactly one paid
 * order (invoices.payment_order_id is UNIQUE, and issuance only runs for
 * status='paid'), so invoiceCount == paid-orders-with-an-invoice and
 * missing == paidCount - invoiceCount. Clamped at 0 for safety.
 */
export function computeMissingCount(
  paidCount: number,
  invoiceCount: number
): number {
  return Math.max(0, (paidCount || 0) - (invoiceCount || 0));
}

export function summarizeOutcomes(outcomes: BackfillOutcome[]): {
  issued: number;
  existed: number;
  skipped: number;
  failed: number;
} {
  const s = { issued: 0, existed: 0, skipped: 0, failed: 0 };
  for (const o of outcomes) {
    if (o === "issued") s.issued += 1;
    else if (o === "exists") s.existed += 1;
    else if (o === "skipped") s.skipped += 1;
    else s.failed += 1;
  }
  return s;
}
