import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PDF_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/payments/invoicePdfCore";

/**
 * Provider invoice PDF download.
 *
 *   GET /api/provider/invoices/[id]/download
 *
 * Security (the critical gate):
 *   1. Session-only identity → resolve provider_id from the session phone.
 *   2. Load the invoice and verify invoice.provider_id === resolved id.
 *      A non-owned (or non-existent) invoice → 404, so ownership is not
 *      even leaked. Only after that do we mint a signed URL.
 *   3. The 'invoices' bucket stays private; we 302 to a short-lived
 *      (SIGNED_URL_TTL_SECONDS) signed URL minted server-side.
 *
 * Mirrors the admin download route plus the ownership check. Does not
 * change payment, webhook, issuance, or PDF generation.
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

  if (invoice.pdf_status !== "generated" || !invoice.pdf_storage_path) {
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

  const signed = await adminSupabase.storage
    .from(PDF_BUCKET)
    .createSignedUrl(invoice.pdf_storage_path, SIGNED_URL_TTL_SECONDS);

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
