import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";

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
// Expected body:
//   { providerId: string, alias: string, canonicalCategory: string }
//
// Validation:
//   - providerId must be present and resolve to a real providers row.
//   - canonicalCategory must exist in `categories` with active=true and must
//     be a category the provider already has in provider_services. Providers
//     cannot pin aliases to categories they don't offer.
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
//   403 — alias does not match a category this provider offers
//   404 — provider or canonical category not found
//   409 — alias already exists
//   500 — DB error
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

  const providerId = String(body.providerId ?? "").trim();
  const aliasRaw = String(body.alias ?? "").trim();
  const canonicalRaw = String(body.canonicalCategory ?? "").trim();

  if (!providerId || !aliasRaw || !canonicalRaw) {
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

  // 1. Provider must exist.
  const { data: providerRow, error: providerErr } = await adminSupabase
    .from("providers")
    .select("provider_id")
    .eq("provider_id", providerId)
    .maybeSingle();
  if (providerErr) {
    console.error("[provider/aliases] provider lookup failed", providerErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  if (!providerRow) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND" },
      { status: 404 }
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
