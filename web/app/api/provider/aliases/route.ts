import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getAuthSession } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/provider/aliases
//
// Provider-side endpoint to request a new alias / work-tag under their
// canonical service category. Inserts into the SHARED `category_aliases`
// table with `active=false` so the matcher (resolveCategoryAlias filters
// `active=true`) and the public categories suggestion list (also gated to
// `active=true`) ignore the entry until an admin promotes it to active=true.
//
// This intentionally REUSES the existing alias infrastructure rather than
// adding a parallel "pending alias requests" table. The active flag is the
// approval gate.
//
// Auth (A8 fix):
//   - Caller MUST present a valid signed `kk_auth_session` cookie. The
//     session phone is the only trusted identity signal.
//   - The provider id used as `submitted_by_provider_id` is resolved from
//     the session phone — body.providerId is accepted only for backward
//     compatibility of the payload shape and is cross-checked against the
//     session-resolved id (mismatch → 403). Body never widens access.
//
// Expected body:
//   { alias: string, canonicalCategory: string, providerId?: string }
//
// Validation (post-auth):
//   - canonicalCategory must exist in `categories` with active=true and must
//     be a category the calling provider already has in provider_services.
//     Providers cannot pin aliases to categories they don't offer.
//   - alias must be non-empty after trim and must not already exist
//     (case-insensitive) in category_aliases — duplicates are rejected with
//     409 so the provider knows the term is already covered.
//   - alias must not collide with any active canonical category name (a
//     canonical wins over an alias by design — preserves /api/categories
//     dedupe contract).
//
// Response codes:
//   200 — created (active=false, awaiting admin review)
//   400 — invalid body
//   401 — no signed session
//   403 — session phone is not a registered provider, or body.providerId
//         disagrees with the session-resolved id, or alias category is not
//         offered by the calling provider
//   404 — canonical category not found
//   409 — alias already exists / collides with canonical
//   500 — DB error

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  // Step 1: verify signed session. The session phone is the sole authority
  // for which provider this submission belongs to.
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
  });
  const sessionPhone10 = normalizePhone10(session?.phone);
  if (!session || sessionPhone10.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // Step 2: resolve the provider row from the session phone. This row's
  // provider_id is the ONLY id used for the alias insert below.
  const { data: providerRows, error: providerLookupErr } = await adminSupabase
    .from("providers")
    .select("provider_id, phone")
    .or(`phone.eq.${sessionPhone10},phone.eq.91${sessionPhone10}`)
    .limit(5);
  if (providerLookupErr) {
    console.error(
      "[provider/aliases] provider lookup failed",
      providerLookupErr.message
    );
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  const providerRow = (providerRows || []).find(
    (row) => normalizePhone10(row.phone) === sessionPhone10
  );
  const providerId = String(providerRow?.provider_id || "").trim();
  if (!providerRow || !providerId) {
    return NextResponse.json(
      { ok: false, error: "NOT_A_REGISTERED_PROVIDER" },
      { status: 403 }
    );
  }

  // Step 3: cross-check body.providerId against the session-resolved id.
  // Body value is treated as a UI hint only — never used to widen access.
  const claimedProviderId = String(body.providerId ?? "").trim();
  if (claimedProviderId && claimedProviderId !== providerId) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_ID_MISMATCH" },
      { status: 403 }
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

  // 2. Canonical category must exist and be active.
  const { data: catRow, error: catErr } = await adminSupabase
    .from("categories")
    .select("name, active")
    .ilike("name", canonicalRaw)
    .eq("active", true)
    .maybeSingle();
  if (catErr) {
    console.error("[provider/aliases] category lookup failed", catErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  if (!catRow) {
    return NextResponse.json(
      { ok: false, error: "CANONICAL_CATEGORY_NOT_FOUND" },
      { status: 404 }
    );
  }
  const canonicalCategory = String(catRow.name || "").trim();

  // 3. Provider must actually offer this category (no pinning aliases to
  //    categories you don't have).
  const { data: psRow, error: psErr } = await adminSupabase
    .from("provider_services")
    .select("category")
    .eq("provider_id", providerId)
    .ilike("category", canonicalCategory)
    .maybeSingle();
  if (psErr) {
    console.error("[provider/aliases] provider_services lookup failed", psErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  if (!psRow) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_DOES_NOT_OFFER_CATEGORY" },
      { status: 403 }
    );
  }

  // 4. Alias must not collide with an existing canonical category name —
  //    canonicals always win in the suggestions dedupe.
  const { data: collidingCanonical } = await adminSupabase
    .from("categories")
    .select("name")
    .ilike("name", aliasRaw)
    .eq("active", true)
    .maybeSingle();
  if (collidingCanonical) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_COLLIDES_WITH_CANONICAL" },
      { status: 409 }
    );
  }

  // 5. Alias must not already exist (any state — active or pending).
  const { data: existingAlias } = await adminSupabase
    .from("category_aliases")
    .select("alias, canonical_category, active")
    .ilike("alias", aliasRaw)
    .maybeSingle();
  if (existingAlias) {
    return NextResponse.json(
      {
        ok: false,
        error: "ALIAS_ALREADY_EXISTS",
        existing: {
          alias: existingAlias.alias,
          canonicalCategory: existingAlias.canonical_category,
          active: existingAlias.active,
        },
      },
      { status: 409 }
    );
  }

  // 6. Insert as pending (active=false). alias_type='work_tag' so the
  //    register-page chip filter (which already filters by alias_type) can
  //    pick this up once an admin activates it.
  //    submitted_by_provider_id lets the admin approve/reject endpoint
  //    notify the specific submitter rather than fan-out to everyone in
  //    the canonical category.
  const insertPayload = {
    alias: aliasRaw,
    canonical_category: canonicalCategory,
    alias_type: "work_tag",
    active: false,
    submitted_by_provider_id: providerId,
  };
  const { data: inserted, error: insertErr } = await adminSupabase
    .from("category_aliases")
    .insert(insertPayload)
    .select("alias, canonical_category, alias_type, active")
    .single();
  if (insertErr) {
    console.error("[provider/aliases] insert failed", insertErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    alias: inserted,
    note: "Alias submitted for admin review. It will not appear in search until an admin sets active=true.",
  });
}
