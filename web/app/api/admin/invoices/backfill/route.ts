import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  countPaidOrdersMissingInvoice,
  runInvoiceBackfill,
} from "@/lib/payments/invoiceBackfill";

/**
 * Phase 2.5 — Admin invoice recovery.
 *
 * Primary recovery surface (Vercel Hobby has no frequent cron, so the
 * admin button is the reliable trigger). Delegates entirely to the shared
 * runInvoiceBackfill() — same behaviour as the bearer-auth cron at
 * /api/cron/backfill-invoices.
 *
 *   POST — requireAdminSession. Runs the backfill (actor='admin').
 *   GET  — requireAdminSession. Returns the health metric (paid orders
 *          missing an invoice) + the most recent backfill audit rows for
 *          the dashboard.
 *
 * Auth, idempotency, gap-free numbering, flag-gating, and audit writes
 * are all owned by the shared worker / the issue_invoice_for_paid_order
 * function. This route is a thin auth + JSON shell.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECENT_LIMIT = 20;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
    { status: 401 }
  );
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const result = await runInvoiceBackfill("admin");

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      { ok: false, error: result.scanError.code, message: result.scanError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: result.enabled,
    scanned: result.scanned,
    issued: result.issued,
    existed: result.existed,
    skipped: result.skipped,
    failed: result.failed,
    failures: result.failures,
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  // Health metric — paid orders missing an invoice (the dashboard tile).
  const metric = await countPaidOrdersMissingInvoice();

  // Recent backfill attempts for the audit panel.
  const { data, error } = await adminSupabase
    .from("invoice_audit_events")
    .select("id, invoice_id, payment_order_id, event_type, actor, detail, created_at")
    .eq("event_type", "invoice_backfill")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    console.error("[admin/invoices/backfill] recent rows read failed", {
      code: error.code,
      message: error.message,
    });
    // Still return the metric — the audit list is best-effort.
    return NextResponse.json({ ok: true, metric, recent: [] });
  }

  return NextResponse.json({ ok: true, metric, recent: data ?? [] });
}
