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
// Approval gate (POST) — added in the provider-alias-approval slice:
//   The endpoint no longer trusts the client to send only approved terms.
//   Before insert, the alias text must EITHER equal the canonical category
//   name itself (the provider tapping the canonical chip) OR resolve to an
//   ACTIVE row in `category_aliases` (`active=true`) mapped to the same
//   canonical the provider offers. Pending (active=false) rows return
//   409 ALIAS_PENDING_REVIEW; unknown alias text returns
//   409 ALIAS_NOT_APPROVED; an active alias under a different canonical
//   returns 409 ALIAS_CATEGORY_MISMATCH. Behaviour-preserving for the
//   normal UI flow (chips loaded from the active alias list pass the
//   check); a forged or stale-tab payload now fails closed instead of
//   persisting an unapproved work term.
//
// Auth: cookie session → phone → providers.provider_id (same pattern as
// /api/provider/notifications and /api/provider/dashboard-profile).

const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");

function normalizePhone10(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Canonical-category equality key. The provider_services / categories /
// category_aliases tables all store their text as the admin entered it,
// which means a stray double-space, trailing whitespace, or mixed casing
// in the client payload would defeat a naive `.ilike("category", value)`
// equality. We collapse the three axes the human eye treats as identical:
//   - trim leading/trailing whitespace
//   - lowercase
//   - replace any run of whitespace (incl. tabs / newlines) with a single
//     space
// Comparison is via this key. The original `category` string from
// provider_services is still used verbatim when inserting into
// provider_work_terms so the canonical casing the provider actually has
// is preserved on the persisted row.
function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

  // Provider must actually offer the canonical they're tagging under. We
  // fetch ALL provider_services rows for the provider (no per-row text
  // filter) and match in JS using normalizeCategoryKey so whitespace and
  // casing drift between the client payload, the canonical row, and the
  // provider_services row don't trigger a false PROVIDER_DOES_NOT_OFFER_-
  // CATEGORY. The original DB string is preserved for the persisted
  // work-term row.
  const { data: psRows, error: psErr } = await adminSupabase
    .from("provider_services")
    .select("category")
    .eq("provider_id", providerId);
  if (psErr) {
    console.error("[provider/work-terms POST] ps lookup failed", psErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  const canonicalKey = normalizeCategoryKey(canonicalRaw);
  const providerCategories = (psRows || []).map((row) => ({
    raw: String((row as { category?: unknown }).category || ""),
    key: normalizeCategoryKey((row as { category?: unknown }).category),
  }));
  const matchedCategory = providerCategories.find(
    (entry) => entry.key === canonicalKey && entry.key.length > 0
  );
  if (!matchedCategory) {
    // Safe debug — no phone, no PII. Helps trace future drift between
    // what the client sends and what provider_services holds.
    console.warn("[provider/work-terms POST] PROVIDER_DOES_NOT_OFFER_CATEGORY", {
      providerId,
      requestedCanonical: canonicalRaw,
      normalizedRequestedKey: canonicalKey,
      providerOfferKeys: providerCategories.map((c) => c.key),
    });
    return NextResponse.json(
      { ok: false, error: "PROVIDER_DOES_NOT_OFFER_CATEGORY" },
      { status: 403 }
    );
  }
  const canonicalAsStored = matchedCategory.raw.trim();

  // Approval gate. The alias is allowed ONLY when:
  //   (a) its text equals the canonical category name itself (the provider
  //       tapping the canonical chip), OR
  //   (b) it resolves to an ACTIVE row in `category_aliases` whose
  //       canonical_category equals the canonical the provider offers.
  //
  // Both comparisons use normalizeCategoryKey so the same whitespace /
  // casing tolerance applies. The alias lookup itself stays case-
  // insensitive via .ilike, and the row's canonical_category is then
  // normalised in JS for the cross-canonical check.
  const aliasKey = normalizeCategoryKey(aliasRaw);
  const isCanonicalSelf = aliasKey === canonicalKey;
  if (!isCanonicalSelf) {
    const { data: aliasRow, error: aliasLookupErr } = await adminSupabase
      .from("category_aliases")
      .select("alias, canonical_category, active")
      .ilike("alias", aliasRaw)
      .maybeSingle();
    if (aliasLookupErr) {
      console.error(
        "[provider/work-terms POST] alias lookup failed",
        aliasLookupErr.message
      );
      return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
    }
    if (!aliasRow) {
      return NextResponse.json(
        { ok: false, error: "ALIAS_NOT_APPROVED" },
        { status: 409 }
      );
    }
    if (aliasRow.active !== true) {
      return NextResponse.json(
        { ok: false, error: "ALIAS_PENDING_REVIEW" },
        { status: 409 }
      );
    }
    const aliasCanonicalKey = normalizeCategoryKey(aliasRow.canonical_category);
    if (aliasCanonicalKey !== canonicalKey) {
      return NextResponse.json(
        { ok: false, error: "ALIAS_CATEGORY_MISMATCH" },
        { status: 409 }
      );
    }
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
      // Preserve the canonical casing from provider_services (the value
      // the admin / approval pipeline wrote there). The matched row is
      // resolved via the normalised key, but the inserted text keeps the
      // original spelling so downstream displays remain consistent.
      canonical_category: canonicalAsStored,
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
