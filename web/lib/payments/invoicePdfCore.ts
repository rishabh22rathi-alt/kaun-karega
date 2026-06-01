/**
 * Phase 3A: pure helpers for invoice PDF generation.
 *
 * No DB/client/jsPDF imports → unit-testable. The runner
 * (invoicePdfRunner.ts) does the I/O (claim, fetch, render, upload, write
 * back); the renderer (invoicePdf.ts) draws the document. This module
 * holds the only branching logic worth pinning in tests: the Storage
 * object key, which pdf_status values are claimable, the regenerate /
 * skip rules, and the attempts increment.
 *
 * Lifecycle (pdf_status): pending → generating → generated | failed.
 *   - 'pending'    : invoice issued, never rendered.
 *   - 'generating' : a worker has claimed it (claim transitions OUT of the
 *                    claimable set, which is what makes the conditional
 *                    UPDATE a mutual-exclusion lock — see the runner).
 *   - 'generated'  : PDF stored; skipped on a normal run, re-rendered only
 *                    when force=true (overwriting the same object key).
 *   - 'failed'     : last attempt errored; retried on the next run.
 */

// Private Supabase Storage bucket created by the Phase 1 migration.
export const PDF_BUCKET = "invoices";

// Signed-download link lifetime (seconds). Short by design — links are
// minted on demand by the admin download route.
export const SIGNED_URL_TTL_SECONDS = 60;

// Bounded per queue run. A larger backlog is drained over successive
// runs (each run is idempotent). Mirrors invoiceBackfill's BATCH_LIMIT.
export const PDF_BATCH_LIMIT = 100;

export type InvoicePdfStatus = "pending" | "generating" | "generated" | "failed";

export type SupplyType = "intra" | "inter";

/**
 * The invoice columns the renderer + runner read. A frozen snapshot — the
 * PDF renders these verbatim and NEVER recomputes GST or totals.
 */
export type InvoiceRecord = {
  id: number;
  invoice_number: string;
  financial_year: string;
  invoice_date: string;
  service_period_start: string;
  service_period_end: string;

  seller_gstin: string;
  seller_legal_name: string;
  seller_trade_name: string;
  seller_address: string;
  seller_state_code: string;

  buyer_name: string;
  buyer_phone: string;
  buyer_gstin: string | null;
  buyer_state_code: string;
  place_of_supply: string;

  supply_type: SupplyType;
  currency: string;

  taxable_value_paise: number;
  cgst_bps: number;
  sgst_bps: number;
  igst_bps: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_tax_paise: number;
  total_paise: number;

  pdf_status: InvoicePdfStatus;
  pdf_attempts: number;
};

export type InvoiceItemRecord = {
  line_no: number;
  description: string;
  sac_code: string;
  quantity: number;
  unit_price_paise: number;
  taxable_value_paise: number;
  gst_bps: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
};

/**
 * Storage object key for an invoice PDF.
 *
 *   financial_year + "/" + invoice_number (with "/" → "-") + ".pdf"
 *   KK/FY2026-27/000001 → FY2026-27/KK-FY2026-27-000001.pdf
 *
 * Stable across regenerations (force overwrites the same key), so any
 * stored pdf_storage_path / signed-download link stays valid.
 */
export function invoiceStoragePath(
  financialYear: string,
  invoiceNumber: string
): string {
  const safeNumber = String(invoiceNumber).replace(/\//g, "-");
  return `${financialYear}/${safeNumber}.pdf`;
}

/**
 * pdf_status values a claim may transition FROM.
 *
 * The runner claims with `UPDATE ... SET pdf_status='generating'
 * WHERE id=? AND pdf_status IN (claimableStatuses(force))`. Because the
 * claim ALWAYS moves the row to 'generating' (which is NOT in this set),
 * a second concurrent claim re-evaluates the WHERE after the first
 * commits, no longer matches, and updates zero rows — that is the
 * mutual-exclusion lock. 'generating' is therefore deliberately excluded
 * (including it would let two force-claims both match → no exclusion). A
 * row stuck in 'generating' from a crashed worker is a known limitation;
 * it is not auto-reclaimed here.
 */
export function claimableStatuses(force: boolean): InvoicePdfStatus[] {
  return force
    ? ["pending", "failed", "generated"]
    : ["pending", "failed"];
}

/**
 * A normal (non-force) run skips an already-generated invoice.
 */
export function shouldSkipAsGenerated(
  currentStatus: InvoicePdfStatus,
  force: boolean
): boolean {
  return !force && currentStatus === "generated";
}

/**
 * True when this is a forced re-render of an already-generated invoice —
 * the runner audits it as 'pdf_regenerated' (vs 'pdf_render_started').
 */
export function isRegeneration(
  currentStatus: InvoicePdfStatus,
  force: boolean
): boolean {
  return force && currentStatus === "generated";
}

/**
 * Attempts counter after a claim. Defensive against NULL/garbage.
 */
export function nextAttempts(current: number | null | undefined): number {
  const n = Number(current);
  return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) + 1;
}
