import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PDF_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/payments/invoicePdfCore";

/**
 * Phase 3A — Admin invoice PDF download.
 *
 *   GET /api/admin/invoices/[id]/download — requireAdminSession.
 *
 * If the invoice PDF is generated, mint a short-lived (60 s) signed URL
 * for the private 'invoices' bucket and 302-redirect to it. The bucket is
 * never public; links are minted on demand. If the PDF is not yet
 * generated, return 409 so the caller can trigger generation first.
 *
 * No provider-facing download here — provider self-serve is a later phase.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return NextResponse.json(
      { ok: false, error: "INVALID_INVOICE_ID" },
      { status: 400 }
    );
  }

  const { data, error } = await adminSupabase
    .from("invoices")
    .select("pdf_status, pdf_storage_path")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "LOOKUP_FAILED", message: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "INVOICE_NOT_FOUND" },
      { status: 404 }
    );
  }

  const row = data as { pdf_status: string; pdf_storage_path: string | null };
  if (row.pdf_status !== "generated" || !row.pdf_storage_path) {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF_NOT_READY",
        message: "Invoice PDF has not been generated yet.",
        pdf_status: row.pdf_status,
      },
      { status: 409 }
    );
  }

  const signed = await adminSupabase.storage
    .from(PDF_BUCKET)
    .createSignedUrl(row.pdf_storage_path, SIGNED_URL_TTL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "SIGN_FAILED",
        message: signed.error?.message ?? "Could not mint signed URL.",
      },
      { status: 500 }
    );
  }

  return NextResponse.redirect(signed.data.signedUrl, 302);
}
