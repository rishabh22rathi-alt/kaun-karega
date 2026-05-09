import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Per-row admin mutations on `category_aliases`.
//   PATCH  /api/admin/aliases/[id]   body: { newAlias: string }
//   DELETE /api/admin/aliases/[id]
//
// PATCH renames a single alias row. Validates against:
//   1. another ACTIVE alias of the same canonical_category with the same
//      text (case-insensitive)  → 409 DUPLICATE_ACTIVE_ALIAS
//   2. an active canonical category whose name equals the new alias text
//      (case-insensitive)        → 409 ALIAS_COLLIDES_WITH_CANONICAL
//   alias_type, active, canonical_category and submitted_by_provider_id
//   are all preserved — only the `alias` text is changed.
//
// DELETE hard-deletes the row. category_aliases is referenced by alias
// TEXT elsewhere (provider_work_terms.alias, resolveCategoryAlias lookups),
// not by FK on id, so the delete does not cascade. Same as the existing
// reject flow at /api/admin/aliases POST which also hard-deletes.

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing alias id" },
      { status: 400 }
    );
  }

  let body: { newAlias?: unknown };
  try {
    body = (await request.json()) as { newAlias?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  const newAlias = String(body.newAlias ?? "").trim();
  if (!newAlias) {
    return NextResponse.json(
      { ok: false, error: "newAlias required" },
      { status: 400 }
    );
  }

  const { data: existing, error: lookupErr } = await adminSupabase
    .from("category_aliases")
    .select("id, alias, canonical_category, active")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json(
      { ok: false, error: lookupErr.message },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_NOT_FOUND" },
      { status: 404 }
    );
  }

  // No-op when the case-sensitive text is unchanged.
  if (newAlias === String((existing as { alias?: unknown }).alias ?? "")) {
    return NextResponse.json({ ok: true, alias: newAlias });
  }

  const canonical = String(
    (existing as { canonical_category?: unknown }).canonical_category ?? ""
  );

  // Collision with another ACTIVE alias under the same canonical.
  const { data: aliasCollision, error: aliasCollErr } = await adminSupabase
    .from("category_aliases")
    .select("id")
    .ilike("alias", newAlias)
    .eq("canonical_category", canonical)
    .eq("active", true)
    .neq("id", id)
    .limit(1);
  if (aliasCollErr) {
    return NextResponse.json(
      { ok: false, error: aliasCollErr.message },
      { status: 500 }
    );
  }
  if (aliasCollision && aliasCollision.length > 0) {
    return NextResponse.json(
      { ok: false, error: "DUPLICATE_ACTIVE_ALIAS" },
      { status: 409 }
    );
  }

  // Collision with an active canonical category name.
  const { data: canonicalCollision } = await adminSupabase
    .from("categories")
    .select("name")
    .ilike("name", newAlias)
    .eq("active", true)
    .maybeSingle();
  if (canonicalCollision) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_COLLIDES_WITH_CANONICAL" },
      { status: 409 }
    );
  }

  const { error: updateErr } = await adminSupabase
    .from("category_aliases")
    .update({ alias: newAlias })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, alias: newAlias });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing alias id" },
      { status: 400 }
    );
  }

  const { error } = await adminSupabase
    .from("category_aliases")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
