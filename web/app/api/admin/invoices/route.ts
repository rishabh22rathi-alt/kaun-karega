import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

/**
 * Admin invoice list — read-only.
 *
 *   GET /api/admin/invoices?status=<pdf_status>&limit=<n>
 *
 * Powers the Admin Dashboard "Invoices" tab. Returns invoice header rows
 * (frozen snapshots already on the invoices table — no join needed) so
 * the tab can render number / provider / amounts / pdf_status and wire
 * the existing generate (POST /api/admin/invoices/pdf) and download
 * (GET /api/admin/invoices/[id]/download) routes.
 *
 * Does NOT touch payment, webhook, issuance, or the PDF engine.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const VALID_STATUSES = ["pending", "generating", "generated", "failed"] as const;

const COLUMNS =
  "id, invoice_number, provider_id, buyer_name, buyer_phone, plan_code, " +
  "invoice_date, issued_at, taxable_value_paise, total_tax_paise, total_paise, " +
  "pdf_status, pdf_last_error, pdf_storage_path, pdf_generated_at, pdf_attempts";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }

  const url = new URL(request.url);

  // Optional pdf_status filter (ignored unless it's a known value).
  const statusParam = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const status = (VALID_STATUSES as readonly string[]).includes(statusParam)
    ? statusParam
    : null;

  // Bounded limit.
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  let query = adminSupabase
    .from("invoices")
    .select(COLUMNS)
    .order("issued_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("pdf_status", status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { ok: false, error: "INVOICES_QUERY_FAILED", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    invoices: data ?? [],
    fetchedAt: new Date().toISOString(),
  });
}
