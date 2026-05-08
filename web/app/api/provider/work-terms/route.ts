import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getAuthSession } from "@/lib/auth";

// /api/provider/work-terms
//
// GET    → list { providerId, items: [{ alias, canonicalCategory, createdAt }] }
// POST   { alias, canonicalCategory }   → idempotent add (no-op if already saved)
// DELETE { alias }                      → remove by case-insensitive alias match
//
// Live (active) work-tag chips auto-save here when the provider taps them.
// Custom typed terms do NOT touch this endpoint — they go to
// /api/provider/aliases for admin review and are inserted into
// category_aliases with active=false. Once an admin approves a custom term,
// it becomes a live chip and the provider can tap it to save it here.
//
// Auth: cookie session → phone → providers.provider_id (same pattern as
// /api/provider/notifications and /api/provider/dashboard-profile).

const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");

function normalizePhone10(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function resolveProviderIdFromCookies(
  request: Request
): Promise<{ providerId: string; error?: { code: string; status: number } }> {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = await getAuthSession({ cookie: cookieHeader });
  const phone = normalizePhone10(String(session?.phone || ""));
  if (!session || phone.length !== 10) {
    return { providerId: "", error: { code: "AUTH_REQUIRED", status: 401 } };
  }
  const { data: providerRow, error } = await adminSupabase
    .from("providers")
    .select("provider_id")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    console.error(
      "[provider/work-terms] provider lookup failed",
      error.message
    );
    return { providerId: "", error: { code: "DB_ERROR", status: 500 } };
  }
  if (!providerRow) {
    return {
      providerId: "",
      error: { code: "PROVIDER_NOT_FOUND", status: 404 },
    };
  }
  return { providerId: String(providerRow.provider_id || "") };
}

export async function GET(request: Request) {
  const { providerId, error: authErr } = await resolveProviderIdFromCookies(
    request
  );
  if (authErr) {
    return NextResponse.json(
      { ok: false, error: authErr.code },
      { status: authErr.status }
    );
  }

  const { data, error } = await adminSupabase
    .from("provider_work_terms")
    .select("alias, canonical_category, created_at")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[provider/work-terms GET] failed", error.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    providerId,
    items: (data || []).map((row) => ({
      alias: row.alias,
      canonicalCategory: row.canonical_category,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const { providerId, error: authErr } = await resolveProviderIdFromCookies(
    request
  );
  if (authErr) {
    return NextResponse.json(
      { ok: false, error: authErr.code },
      { status: authErr.status }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  const aliasRaw = String(body.alias ?? "").trim();
  const canonicalRaw = String(body.canonicalCategory ?? "").trim();
  if (!aliasRaw || !canonicalRaw) {
    return NextResponse.json(
      { ok: false, error: "MISSING_FIELDS" },
      { status: 400 }
    );
  }
  if (aliasRaw.length > 80) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_TOO_LONG" },
      { status: 400 }
    );
  }

  // Provider must actually offer the canonical they're tagging under. This
  // mirrors the guard on /api/provider/aliases and prevents a provider from
  // claiming work terms for categories they don't have.
  const { data: psRow, error: psErr } = await adminSupabase
    .from("provider_services")
    .select("category")
    .eq("provider_id", providerId)
    .ilike("category", canonicalRaw)
    .maybeSingle();
  if (psErr) {
    console.error("[provider/work-terms POST] ps lookup failed", psErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  if (!psRow) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_DOES_NOT_OFFER_CATEGORY" },
      { status: 403 }
    );
  }

  // Idempotent: if a row already exists for (provider_id, lower(alias)),
  // return ok without inserting. The unique index would otherwise raise
  // 23505; we soft-handle that to keep callers simple.
  const { data: existing } = await adminSupabase
    .from("provider_work_terms")
    .select("alias")
    .eq("provider_id", providerId)
    .ilike("alias", aliasRaw)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      ok: true,
      already: true,
      alias: existing.alias,
    });
  }

  const { error: insertErr } = await adminSupabase
    .from("provider_work_terms")
    .insert({
      provider_id: providerId,
      alias: aliasRaw,
      canonical_category: psRow.category, // canonical casing from provider_services
    });
  if (insertErr) {
    console.error(
      "[provider/work-terms POST] insert failed",
      insertErr.message
    );
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, alias: aliasRaw });
}

// DELETE /api/provider/work-terms?alias=<urlencoded alias>
//
// Alias travels in the query string rather than the body. DELETE-with-body
// is supported by Next.js but is non-standard — proxies, edge runtimes, and
// some fetch implementations strip or fail to forward the body, which would
// surface as a generic "could not save" on the dashboard. Query params are
// unambiguous in transport.
export async function DELETE(request: Request) {
  const { providerId, error: authErr } = await resolveProviderIdFromCookies(
    request
  );
  if (authErr) {
    return NextResponse.json(
      { ok: false, error: authErr.code },
      { status: authErr.status }
    );
  }

  const url = new URL(request.url);
  const aliasRaw = String(url.searchParams.get("alias") || "").trim();
  if (!aliasRaw) {
    return NextResponse.json(
      { ok: false, error: "MISSING_FIELDS" },
      { status: 400 }
    );
  }

  const { error } = await adminSupabase
    .from("provider_work_terms")
    .delete()
    .eq("provider_id", providerId)
    .ilike("alias", aliasRaw);
  if (error) {
    console.error("[provider/work-terms DELETE] failed", error.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, alias: aliasRaw });
}
