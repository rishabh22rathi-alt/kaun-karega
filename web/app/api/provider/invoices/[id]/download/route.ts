import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PDF_BUCKET,
  pdfContentDisposition,
} from "@/lib/payments/invoicePdfCore";

/**
 * Provider invoice PDF view / download.
 *
 *   GET /api/provider/invoices/[id]/download
 *
 * Security (the critical gate — unchanged):
 *   1. Session-only identity → resolve provider_id from the session phone.
 *   2. Load the invoice and verify invoice.provider_id === resolved id.
 *      A non-owned (or non-existent) invoice → 404, so ownership is not
 *      even leaked.
 *
 * Then stream the PDF bytes straight from the private 'invoices' bucket
 * with an explicit Content-Disposition (no cross-origin signed-URL
 * redirect — see the admin route for why that was unreliable). The bucket
 * stays private; no URL is ever exposed to the client.
 *
 * ?disposition=inline (default)  → Content-Disposition: inline ("View").
 * ?disposition=attachment        → Content-Disposition: attachment
 *                                   ("Download").
 *
 * Does not change payment, webhook, issuance, or PDF generation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

export async function GET(request: Request, context: RouteContext) {
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
  });
  const sessionPhone = normalizePhone10(String(session?.phone || ""));
  if (!session || !sessionPhone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED_PROVIDER_SESSION" },
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

  // Resolve the caller's provider_id from the session (never the client).
  const { data: providerRow, error: providerErr } = await adminSupabase
    .from("providers")
    .select("provider_id")
    .or(`phone.eq.${sessionPhone},phone.eq.91${sessionPhone}`)
    .limit(1)
    .maybeSingle();

  if (providerErr) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_LOOKUP_FAILED", message: providerErr.message },
      { status: 500 }
    );
  }
  const providerId = (providerRow as { provider_id?: string } | null)?.provider_id;
  if (!providerId) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND" },
      { status: 403 }
    );
  }

  const { data, error } = await adminSupabase
    .from("invoices")
    .select("provider_id, pdf_status, pdf_storage_path")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "LOOKUP_FAILED", message: error.message },
      { status: 500 }
    );
  }

  const invoice = data as
    | { provider_id: string; pdf_status: string; pdf_storage_path: string | null }
    | null;

  // Not found OR not owned → identical 404 (do not leak existence).
  if (!invoice || invoice.provider_id !== providerId) {
    return NextResponse.json(
      { ok: false, error: "INVOICE_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (invoice.pdf_status !== "generated") {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF_NOT_READY",
        message: "Invoice PDF has not been generated yet.",
        pdf_status: invoice.pdf_status,
      },
      { status: 409 }
    );
  }
  if (!invoice.pdf_storage_path) {
    return NextResponse.json(
      {
        ok: false,
        error: "PDF_PATH_MISSING",
        message: "Invoice is marked generated but has no stored PDF path.",
      },
      { status: 409 }
    );
  }

  const filename = invoice.pdf_storage_path.split("/").pop() || "invoice.pdf";
  const download = await adminSupabase.storage
    .from(PDF_BUCKET)
    .download(invoice.pdf_storage_path);

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
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
