import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

/**
 * Provider "My Invoices" — list the authenticated provider's own invoices.
 *
 * Security model (mirrors /api/provider/plan):
 *   - Session is the ONLY identity source. provider_id is resolved
 *     server-side from the session phone; the client NEVER supplies it.
 *   - Returns ONLY invoices whose provider_id equals the resolved id.
 *
 * Read-only. Does not touch payment, webhook, issuance, or PDF generation.
 * PDFs are produced by the admin Phase 3A flow; this route only reports
 * their pdf_status and lets the client link to the per-invoice download
 * route (which re-checks ownership before signing).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

export async function GET(request: Request) {
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

  // Resolve provider_id from the session phone. The 91-prefixed legacy
  // form is unioned in case any old row stored the 12-digit value.
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

  // Logged in but no provider row = nothing to show. Empty list (not an
  // error) so the page renders its "No invoices yet." state cleanly.
  const providerId = (providerRow as { provider_id?: string } | null)?.provider_id;
  if (!providerId) {
    return NextResponse.json({ ok: true, invoices: [] });
  }

  // Own invoices only, newest first (idx_invoices_provider_issued).
  const { data, error } = await adminSupabase
    .from("invoices")
    .select(
      "id, invoice_number, invoice_date, plan_code, taxable_value_paise, " +
        "total_tax_paise, total_paise, pdf_status"
    )
    .eq("provider_id", providerId)
    .order("issued_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "INVOICES_QUERY_FAILED", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, invoices: data ?? [] });
}
