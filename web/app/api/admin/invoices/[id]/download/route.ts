import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PDF_BUCKET,
  pdfContentDisposition,
} from "@/lib/payments/invoicePdfCore";

/**
 * Phase 3A — Admin invoice PDF view / download.
 *
 *   GET /api/admin/invoices/[id]/download — requireAdminSession.
 *
 * Streams the PDF bytes straight from the private 'invoices' bucket with
 * an explicit Content-Disposition. We do NOT 302-redirect to a Supabase
 * signed URL: that depended on the browser following a cross-origin
 * redirect to the storage host (and on SUPABASE_URL being the public
 * origin), which proved unreliable. Streaming server-side is
 * deterministic, keeps the bucket private (no URL is ever exposed), and
 * leaves auth/ownership unchanged.
 *
 * ?disposition=inline (default)  → Content-Disposition: inline ("View").
 * ?disposition=attachment        → Content-Disposition: attachment
 *                                   ("Download" saves the file).
 *
 * Error JSON: UNAUTHORIZED · INVALID_INVOICE_ID · LOOKUP_FAILED ·
 *   INVOICE_NOT_FOUND · PDF_NOT_READY · PDF_PATH_MISSING · PDF_FETCH_FAILED.
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

  // inline (default) → view in browser; attachment → force download.
  const disposition = new URL(request.url).searchParams.get("disposition");

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
  if (row.pdf_status !== "generated") {
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
  if (!row.pdf_storage_path) {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF_PATH_MISSING",
        message: "Invoice is marked generated but has no stored PDF path.",
      },
      { status: 409 }
    );
  }

  const filename = row.pdf_storage_path.split("/").pop() || "invoice.pdf";
  const download = await adminSupabase.storage
    .from(PDF_BUCKET)
    .download(row.pdf_storage_path);

  if (download.error || !download.data) {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF_FETCH_FAILED",
        message: download.error?.message ?? "Could not read the PDF from storage.",
      },
      { status: 502 }
    );
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": pdfContentDisposition(disposition, filename),
      "Content-Length": String(bytes.byteLength),
      // Private financial document — never cache in shared caches.
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
