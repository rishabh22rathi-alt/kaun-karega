/**
 * Phase 3A: invoice PDF generation worker.
 *
 * Reads an ISSUED invoice (Phase 2 leaves pdf_status='pending'), renders
 * the GST tax-invoice PDF, uploads it to the private 'invoices' Storage
 * bucket, and writes back the pdf_* lifecycle fields. Mirrors the
 * Phase 2.5 backfill design (one shared runner, thin auth routes):
 *   - admin button   → /api/admin/invoices/pdf      (actor 'admin')
 *   - optional cron   → /api/cron/generate-invoice-pdfs (actor 'system')
 *
 * Invariants (do not break):
 *   - Renders ONLY from stored invoice snapshots; never recomputes GST.
 *   - Touches ONLY pdf_* columns on invoices (the immutability trigger
 *     rejects anything else) — so it cannot alter an issued invoice.
 *   - Idempotent: a 'generated' invoice is skipped unless force=true.
 *   - Race-safe: a conditional UPDATE claims the row (pending/failed →
 *     generating). Only one worker can win; the rest skip.
 *   - Never throws at the batch level; a per-invoice failure is caught,
 *     recorded (pdf_status='failed', pdf_last_error) and the batch
 *     continues.
 *
 * Service-role Supabase only (the invoices table + bucket are RLS-locked
 * with no policies). Gated by KK_INVOICE_LEDGER_ENABLED, same as issuance
 * and backfill — if the invoice system is off, no PDFs are produced.
 */

import { adminSupabase } from "@/lib/supabase/admin";
import { isInvoiceLedgerEnabled } from "@/lib/payments/server";
import { renderInvoicePdf } from "@/lib/payments/invoicePdf";
import { notifyAdmins } from "@/lib/notifications/notifyAdmins";
import {
  PDF_BATCH_LIMIT,
  PDF_BUCKET,
  claimableStatuses,
  invoiceStoragePath,
  isRegeneration,
  nextAttempts,
  shouldSkipAsGenerated,
  type InvoiceItemRecord,
  type InvoiceRecord,
} from "@/lib/payments/invoicePdfCore";

export type PdfActor = "admin" | "system";
export type PdfItemOutcome = "rendered" | "skipped" | "failed";

export type PdfFailure = {
  invoice_id: number;
  invoice_number: string | null;
  error_code: string;
  error_message: string | null;
};

export type PdfRunResult = {
  ok: boolean;
  enabled: boolean;
  rendered: number;
  skipped: number;
  failed: number;
  failures: PdfFailure[];
  scanError?: { code: string; message: string };
};

// pdf_last_error is free-text but we keep it bounded.
const MAX_ERROR_LEN = 500;

// The exact invoice columns the renderer needs (frozen snapshot).
const INVOICE_COLS =
  "id, invoice_number, financial_year, invoice_date, service_period_start, service_period_end, " +
  "seller_gstin, seller_legal_name, seller_trade_name, seller_address, seller_state_code, " +
  "buyer_name, buyer_phone, buyer_gstin, buyer_state_code, place_of_supply, " +
  "supply_type, currency, taxable_value_paise, cgst_bps, sgst_bps, igst_bps, " +
  "cgst_paise, sgst_paise, igst_paise, total_tax_paise, total_paise, pdf_status, pdf_attempts";

async function writePdfAudit(args: {
  invoiceId: number;
  eventType:
    | "pdf_render_started"
    | "pdf_render_succeeded"
    | "pdf_render_failed"
    | "pdf_regenerated";
  actor: PdfActor;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await adminSupabase.from("invoice_audit_events").insert({
    invoice_id: args.invoiceId,
    event_type: args.eventType,
    actor: args.actor,
    detail: args.detail ?? null,
  });
  if (error) {
    // Visibility gap only — never fail the render over an audit insert.
    console.warn("[invoicePdf] audit insert failed (non-fatal)", {
      invoiceId: args.invoiceId,
      eventType: args.eventType,
      message: error.message,
    });
  }
}

type ProcessResult = { outcome: PdfItemOutcome; failure?: PdfFailure };

/**
 * Mark an OWNED (already-claimed) invoice as failed and record the error.
 * Only called after a successful claim, so we will not clobber another
 * worker's row.
 */
async function markFailed(
  invoice: Pick<InvoiceRecord, "id" | "invoice_number">,
  actor: PdfActor,
  code: string,
  message: string | null
): Promise<ProcessResult> {
  const lastError = `${code}: ${message ?? ""}`.slice(0, MAX_ERROR_LEN);
  const { error } = await adminSupabase
    .from("invoices")
    .update({ pdf_status: "failed", pdf_last_error: lastError })
    .eq("id", invoice.id);
  if (error) {
    console.warn("[invoicePdf] failed-status write failed (non-fatal)", {
      invoiceId: invoice.id,
      message: error.message,
    });
  }
  await writePdfAudit({
    invoiceId: invoice.id,
    eventType: "pdf_render_failed",
    actor,
    detail: { error_code: code, error_message: message ?? null },
  });
  // Phase A: in-app admin alert (soft-fail, deduped on invoice_id; never
  // throws — cannot affect PDF generation flow).
  await notifyAdmins("invoice_pdf_failed", {
    invoice_id: String(invoice.id),
    invoice_number: invoice.invoice_number,
    error_code: code,
    error_message: message,
  });
  return {
    outcome: "failed",
    failure: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      error_code: code,
      error_message: message ?? null,
    },
  };
}

async function processInvoice(
  invoiceId: number,
  force: boolean,
  actor: PdfActor
): Promise<ProcessResult> {
  // 1. Load the invoice snapshot.
  const { data: invRow, error: loadErr } = await adminSupabase
    .from("invoices")
    .select(INVOICE_COLS)
    .eq("id", invoiceId)
    .maybeSingle();

  if (loadErr) {
    return {
      outcome: "failed",
      failure: {
        invoice_id: invoiceId,
        invoice_number: null,
        error_code: "LOAD_FAILED",
        error_message: loadErr.message,
      },
    };
  }
  if (!invRow) {
    return {
      outcome: "failed",
      failure: {
        invoice_id: invoiceId,
        invoice_number: null,
        error_code: "INVOICE_NOT_FOUND",
        error_message: null,
      },
    };
  }

  const invoice = invRow as unknown as InvoiceRecord;

  // 2. Idempotency: a generated invoice is left untouched unless forced.
  if (shouldSkipAsGenerated(invoice.pdf_status, force)) {
    return { outcome: "skipped" };
  }

  const regenerate = isRegeneration(invoice.pdf_status, force);

  // 3. Race-safe claim. The conditional UPDATE moves the row OUT of the
  //    claimable set (→ 'generating'); a concurrent claim then matches
  //    zero rows. Whoever gets the row back owns the render.
  const { data: claimedRows, error: claimErr } = await adminSupabase
    .from("invoices")
    .update({
      pdf_status: "generating",
      pdf_attempts: nextAttempts(invoice.pdf_attempts),
      pdf_last_error: null,
    })
    .eq("id", invoiceId)
    .in("pdf_status", claimableStatuses(force))
    .select("id");

  if (claimErr) {
    return {
      outcome: "failed",
      failure: {
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        error_code: "CLAIM_FAILED",
        error_message: claimErr.message,
      },
    };
  }
  if (!claimedRows || claimedRows.length === 0) {
    // Another worker owns it, or it left the claimable set since we read.
    return { outcome: "skipped" };
  }

  await writePdfAudit({
    invoiceId,
    eventType: regenerate ? "pdf_regenerated" : "pdf_render_started",
    actor,
    detail: { force, attempt: nextAttempts(invoice.pdf_attempts) },
  });

  // 4. Line items.
  const { data: itemRows, error: itemErr } = await adminSupabase
    .from("invoice_items")
    .select(
      "line_no, description, sac_code, quantity, unit_price_paise, taxable_value_paise, " +
        "gst_bps, cgst_paise, sgst_paise, igst_paise, line_total_paise"
    )
    .eq("invoice_id", invoiceId)
    .order("line_no", { ascending: true });

  if (itemErr) {
    return markFailed(invoice, actor, "ITEMS_LOAD_FAILED", itemErr.message);
  }
  const items = (itemRows ?? []) as unknown as InvoiceItemRecord[];
  if (items.length === 0) {
    return markFailed(invoice, actor, "NO_INVOICE_ITEMS", null);
  }

  // 5. Render (in-memory; no filesystem).
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = renderInvoicePdf(invoice, items);
  } catch (err) {
    return markFailed(
      invoice,
      actor,
      "RENDER_FAILED",
      err instanceof Error ? err.message : String(err)
    );
  }

  // 6. Upload (overwrite-on-regenerate via upsert + stable key).
  const path = invoiceStoragePath(invoice.financial_year, invoice.invoice_number);
  const { error: uploadErr } = await adminSupabase.storage
    .from(PDF_BUCKET)
    .upload(path, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) {
    return markFailed(invoice, actor, "UPLOAD_FAILED", uploadErr.message);
  }

  // 7. Finalise — only pdf_* columns (allowed by the immutability trigger).
  const { error: doneErr } = await adminSupabase
    .from("invoices")
    .update({
      pdf_status: "generated",
      pdf_storage_path: path,
      pdf_generated_at: new Date().toISOString(),
      pdf_last_error: null,
    })
    .eq("id", invoiceId);
  if (doneErr) {
    return markFailed(invoice, actor, "FINALIZE_FAILED", doneErr.message);
  }

  await writePdfAudit({
    invoiceId,
    eventType: "pdf_render_succeeded",
    actor,
    detail: { storage_path: path, regenerated: regenerate },
  });

  return { outcome: "rendered" };
}

function emptyResult(enabled: boolean): PdfRunResult {
  return { ok: true, enabled, rendered: 0, skipped: 0, failed: 0, failures: [] };
}

function rollup(results: ProcessResult[]): PdfRunResult {
  let rendered = 0;
  let skipped = 0;
  let failed = 0;
  const failures: PdfFailure[] = [];
  for (const r of results) {
    if (r.outcome === "rendered") rendered += 1;
    else if (r.outcome === "skipped") skipped += 1;
    else {
      failed += 1;
      if (r.failure) failures.push(r.failure);
    }
  }
  return { ok: true, enabled: true, rendered, skipped, failed, failures };
}

/**
 * Entry point. Two modes:
 *   - invoiceId provided → render that single invoice (force optional).
 *   - invoiceId omitted  → drain the queue (pdf_status <> 'generated'),
 *     oldest-first, bounded by PDF_BATCH_LIMIT, force ignored.
 *
 * Never throws; returns a structured summary for the HTTP routes.
 */
export async function runInvoicePdfGeneration(opts: {
  invoiceId?: number;
  force?: boolean;
  actor: PdfActor;
}): Promise<PdfRunResult> {
  if (!isInvoiceLedgerEnabled()) {
    return emptyResult(false);
  }

  // Single-invoice mode.
  if (typeof opts.invoiceId === "number" && Number.isFinite(opts.invoiceId)) {
    const r = await processInvoice(opts.invoiceId, opts.force === true, opts.actor);
    return rollup([r]);
  }

  // Queue mode — everything not yet generated, oldest-first.
  const { data, error } = await adminSupabase
    .from("invoices")
    .select("id")
    .neq("pdf_status", "generated")
    .order("issued_at", { ascending: true })
    .limit(PDF_BATCH_LIMIT);

  if (error) {
    return {
      ok: false,
      enabled: true,
      rendered: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      scanError: { code: "SCAN_FAILED", message: error.message },
    };
  }

  const ids = (data ?? []).map((r) => Number((r as { id: number }).id));
  const results: ProcessResult[] = [];
  // Sequential — keeps the run cheap and avoids contending on Storage.
  for (const id of ids) {
    results.push(await processInvoice(id, false, opts.actor));
  }
  return rollup(results);
}
