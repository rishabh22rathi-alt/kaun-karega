import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { runInvoicePdfGeneration } from "@/lib/payments/invoicePdfRunner";

/**
 * Phase 3A — Admin invoice PDF generation.
 *
 * Primary production trigger (no Vercel cron dependency). Delegates to the
 * shared runInvoicePdfGeneration() — same worker the optional bearer cron
 * at /api/cron/generate-invoice-pdfs uses.
 *
 *   POST  — requireAdminSession.
 *     body { invoice_id?: number, force?: boolean }
 *       invoice_id present → render that invoice (force re-renders an
 *                            already-generated one, overwriting the file).
 *       invoice_id absent  → drain the pending queue.
 *     → { ok, enabled, rendered, skipped, failed, failures }
 *
 * Claim/idempotency/audit/immutability are owned by the runner and the DB.
 * This route is a thin auth + JSON shell.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
    { status: 401 }
  );
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  // Empty body is valid (= queue mode), so a JSON parse error is non-fatal.
  let body: { invoice_id?: unknown; force?: unknown } = {};
  try {
    body = (await request.json()) as { invoice_id?: unknown; force?: unknown };
  } catch {
    body = {};
  }

  const invoiceId =
    typeof body.invoice_id === "number" && Number.isFinite(body.invoice_id)
      ? Math.floor(body.invoice_id)
      : undefined;
  const force = body.force === true;

  const result = await runInvoicePdfGeneration({
    invoiceId,
    force,
    actor: "admin",
  });

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      { ok: false, error: result.scanError.code, message: result.scanError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: result.enabled,
    rendered: result.rendered,
    skipped: result.skipped,
    failed: result.failed,
    failures: result.failures,
  });
}
