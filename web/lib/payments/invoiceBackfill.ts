import { adminSupabase } from "@/lib/supabase/admin";
import { isInvoiceLedgerEnabled } from "@/lib/payments/server";
import type { IssueInvoiceResult } from "@/lib/payments/issueInvoiceCore";
import {
  computeMissingCount,
  computeMissingOrderIds,
  type BackfillOutcome,
} from "@/lib/payments/invoiceBackfillCore";

/**
 * Phase 2.5: invoice recovery / backfill worker.
 *
 * Closes the Phase 2 gap where a soft-failed issuance was never retried:
 * a paid order could be left with no invoice forever. This worker scans
 * for paid orders missing an invoice and (re)issues them through the SAME
 * idempotent DB function the webhook uses — issue_invoice_for_paid_order.
 *
 * Mirrors the scheduled-plan-activation pattern (one shared runner, two
 * triggers): the bearer-auth cron at /api/cron/backfill-invoices and the
 * admin-cookie route at /api/admin/invoices/backfill both delegate here.
 *
 * Invariants this worker preserves (do not break):
 *   - Uses issue_invoice_for_paid_order() ONLY. Never inserts invoices,
 *     items, ledger or numbers directly.
 *   - Idempotent: the function returns 'exists' for already-issued orders;
 *     re-runs are safe and the scan skips invoiced orders anyway.
 *   - Gap-free numbering: the function allocates inside its own
 *     transaction. We process SEQUENTIALLY, oldest-first, so backfilled
 *     numbers stay in payment chronological order.
 *   - Respects KK_INVOICE_LEDGER_ENABLED: disabled → no scan, no writes.
 *   - Never throws at the batch level; per-order errors are caught,
 *     audited, and surfaced in `failures`.
 *
 * It does NOT touch the webhook, payment_orders.status, or invoice
 * numbering logic.
 */

// Bounded per run. Keeps the `.in()` URL small and runs cheap; a backlog
// larger than this is drained over successive runs (idempotent).
const BATCH_LIMIT = 200;

export type BackfillFailure = {
  order_id: string;
  outcome: "skipped" | "failed";
  error_code: string | null;
  error_message: string | null;
};

export type BackfillResult = {
  ok: boolean;
  enabled: boolean;
  scanned: number; // missing orders we attempted this run
  issued: number;
  existed: number; // already had an invoice (raced / idempotent)
  skipped: number;
  failed: number;
  failures: BackfillFailure[];
  scanError?: { code: string; message: string };
};

export type MissingInvoiceMetric = {
  ok: boolean;
  paidOrders: number;
  invoices: number;
  missing: number;
  error?: string;
};

type BackfillActor = "admin" | "system";

/**
 * Health metric: exact count of paid orders with no invoice. Does NOT
 * require the feature flag (read-only visibility, useful even while
 * issuance is disabled to show the backlog). Never throws.
 */
export async function countPaidOrdersMissingInvoice(): Promise<MissingInvoiceMetric> {
  const paid = await adminSupabase
    .from("payment_orders")
    .select("*", { count: "exact", head: true })
    .eq("status", "paid");
  if (paid.error) {
    return { ok: false, paidOrders: 0, invoices: 0, missing: 0, error: paid.error.message };
  }
  const inv = await adminSupabase
    .from("invoices")
    .select("*", { count: "exact", head: true });
  if (inv.error) {
    return {
      ok: false,
      paidOrders: paid.count ?? 0,
      invoices: 0,
      missing: 0,
      error: inv.error.message,
    };
  }
  const paidOrders = paid.count ?? 0;
  const invoices = inv.count ?? 0;
  return {
    ok: true,
    paidOrders,
    invoices,
    missing: computeMissingCount(paidOrders, invoices),
  };
}

async function writeBackfillAudit(args: {
  orderId: string;
  invoiceId: number | null;
  outcome: BackfillOutcome;
  actor: BackfillActor;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  const { error } = await adminSupabase.from("invoice_audit_events").insert({
    invoice_id: args.invoiceId,
    payment_order_id: args.orderId,
    event_type: "invoice_backfill",
    actor: args.actor,
    detail: {
      outcome: args.outcome,
      error_code: args.errorCode ?? null,
      error_message: args.errorMessage ?? null,
      source: "phase_2_5_backfill",
    },
  });
  if (error) {
    // Audit write failure must NOT throw — the invoice (if any) already
    // committed. Visibility gap only.
    console.warn("[invoiceBackfill] audit insert failed (non-fatal)", {
      orderId: args.orderId,
      message: error.message,
    });
  }
}

async function processOrder(
  orderId: string,
  actor: BackfillActor
): Promise<{ outcome: BackfillOutcome; failure?: BackfillFailure }> {
  let result: IssueInvoiceResult | null = null;
  try {
    const { data, error } = await adminSupabase.rpc("issue_invoice_for_paid_order", {
      p_order_id: orderId,
    });
    if (error) {
      await writeBackfillAudit({
        orderId,
        invoiceId: null,
        outcome: "failed",
        actor,
        errorCode: "RPC_ERROR",
        errorMessage: error.message,
      });
      return {
        outcome: "failed",
        failure: { order_id: orderId, outcome: "failed", error_code: "RPC_ERROR", error_message: error.message },
      };
    }
    result = (data ?? null) as IssueInvoiceResult | null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeBackfillAudit({
      orderId,
      invoiceId: null,
      outcome: "failed",
      actor,
      errorCode: "RPC_THREW",
      errorMessage: message,
    });
    return {
      outcome: "failed",
      failure: { order_id: orderId, outcome: "failed", error_code: "RPC_THREW", error_message: message },
    };
  }

  const outcome = String(result?.outcome ?? "");
  const invoiceId = typeof result?.invoice_id === "number" ? result.invoice_id : null;

  if (outcome === "issued" || outcome === "exists") {
    await writeBackfillAudit({ orderId, invoiceId, outcome, actor });
    return { outcome };
  }

  // 'skipped' (order not found / not paid) or 'failed' (no business
  // profile / provider missing) or anything unexpected.
  const mapped: BackfillOutcome = outcome === "skipped" ? "skipped" : "failed";
  await writeBackfillAudit({
    orderId,
    invoiceId: null,
    outcome: mapped,
    actor,
    errorCode: result?.error_code ?? (outcome ? `OUTCOME_${outcome.toUpperCase()}` : "RPC_MALFORMED"),
  });
  return {
    outcome: mapped,
    failure: {
      order_id: orderId,
      outcome: mapped,
      error_code: result?.error_code ?? (outcome ? `OUTCOME_${outcome.toUpperCase()}` : "RPC_MALFORMED"),
      error_message: null,
    },
  };
}

/**
 * Entry point. Scans paid orders missing an invoice and issues each via
 * the shared idempotent function. Never throws; returns a structured
 * summary for HTTP routes. `actor` records who triggered the run in the
 * audit detail ('admin' for the dashboard button, 'system' for cron).
 */
export async function runInvoiceBackfill(
  actor: BackfillActor = "system"
): Promise<BackfillResult> {
  if (!isInvoiceLedgerEnabled()) {
    // Flag off → do nothing (no scan, no writes). Safe default.
    return {
      ok: true,
      enabled: false,
      scanned: 0,
      issued: 0,
      existed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
  }

  // 1. Candidate paid orders, oldest-first (chronological numbering).
  const { data: paidRows, error: scanError } = await adminSupabase
    .from("payment_orders")
    .select("order_id, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (scanError) {
    return {
      ok: false,
      enabled: true,
      scanned: 0,
      issued: 0,
      existed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      scanError: { code: "SCAN_FAILED", message: scanError.message },
    };
  }

  const candidates = (paidRows ?? []) as Array<{ order_id: string }>;
  if (candidates.length === 0) {
    return { ok: true, enabled: true, scanned: 0, issued: 0, existed: 0, skipped: 0, failed: 0, failures: [] };
  }

  // 2. Which candidates already have an invoice?
  const orderIds = candidates.map((r) => String(r.order_id));
  const { data: invRows, error: invError } = await adminSupabase
    .from("invoices")
    .select("payment_order_id")
    .in("payment_order_id", orderIds);

  if (invError) {
    return {
      ok: false,
      enabled: true,
      scanned: 0,
      issued: 0,
      existed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      scanError: { code: "INVOICE_SCAN_FAILED", message: invError.message },
    };
  }

  const invoicedIds = (invRows ?? []).map((r) =>
    String((r as { payment_order_id: string }).payment_order_id)
  );
  const missing = computeMissingOrderIds(candidates, invoicedIds);

  // 3. Issue SEQUENTIALLY (oldest-first) so numbers stay chronological.
  let issued = 0;
  let existed = 0;
  let skipped = 0;
  let failed = 0;
  const failures: BackfillFailure[] = [];

  for (const orderId of missing) {
    const r = await processOrder(orderId, actor);
    if (r.outcome === "issued") issued += 1;
    else if (r.outcome === "exists") existed += 1;
    else if (r.outcome === "skipped") {
      skipped += 1;
      if (r.failure) failures.push(r.failure);
    } else {
      failed += 1;
      if (r.failure) failures.push(r.failure);
    }
  }

  return {
    ok: true,
    enabled: true,
    scanned: missing.length,
    issued,
    existed,
    skipped,
    failed,
    failures,
  };
}
