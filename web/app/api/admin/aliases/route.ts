import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/adminAuth";

// GET  /api/admin/aliases?status=pending|active
// POST /api/admin/aliases  body: { action: "approve"|"reject", alias, reason? }
//
// Auth: every entry point goes through `requireAdminSession`, which verifies
// the signed `kk_auth_session` cookie phone against the `admins` table
// (active=true). Inactive or non-admin sessions get 401. The service-role
// client below is only used after the gate has passed.

const PENDING = "pending";
const ACTIVE = "active";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const status = (
    new URL(request.url).searchParams.get("status") || PENDING
  ).toLowerCase();
  const wantPending = status !== ACTIVE;

  const { data, error } = await adminSupabase
    .from("category_aliases")
    .select(
      "alias, canonical_category, active, alias_type, created_at, submitted_by_provider_id"
    )
    .eq("active", !wantPending)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[admin/aliases GET] failed", error.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  // Hydrate provider name + phone for each row that has a submitter, so the
  // admin UI can show "submitted by Ramesh / 98XXXXXX01" without an extra
  // round-trip per row.
  const submitterIds = Array.from(
    new Set(
      (data || [])
        .map((r) => String(r.submitted_by_provider_id || "").trim())
        .filter(Boolean)
    )
  );
  let providersById: Record<string, { name: string; phone: string }> = {};
  if (submitterIds.length > 0) {
    // providers schema uses `full_name`, not `name`. Earlier code referenced
    // a non-existent `name` column and 500'd on load.
    const { data: providers } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .in("provider_id", submitterIds);
    for (const p of providers || []) {
      providersById[String(p.provider_id || "")] = {
        name: String(p.full_name || ""),
        phone: String(p.phone || ""),
      };
    }
  }

  const rows = (data || []).map((r) => {
    const providerKey = String(r.submitted_by_provider_id || "");
    const submitter = providerKey ? providersById[providerKey] : undefined;
    return {
      alias: r.alias,
      canonicalCategory: r.canonical_category,
      active: r.active,
      aliasType: r.alias_type,
      createdAt: r.created_at,
      submittedByProviderId: r.submitted_by_provider_id || null,
      submittedByName: submitter?.name || null,
      submittedByPhone: submitter?.phone || null,
    };
  });

  return NextResponse.json({ ok: true, aliases: rows });
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
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

  const action = String(body.action ?? "").toLowerCase();
  const aliasRaw = String(body.alias ?? "").trim();
  const reason = String(body.reason ?? "").trim();

  if (
    !aliasRaw ||
    (action !== "approve" && action !== "reject" && action !== "create")
  ) {
    return NextResponse.json(
      { ok: false, error: "INVALID_ACTION" },
      { status: 400 }
    );
  }

  // Admin-initiated alias create. Independent code path — it does NOT
  // share the approve/reject "find existing pending row by alias text"
  // lookup below, because for `create` no row exists yet. Validation,
  // collision checks, and insert are inline so the approve/reject paths
  // stay byte-identical to before this change.
  if (action === "create") {
    const canonicalCategoryRaw = String(
      (body as { canonicalCategory?: unknown }).canonicalCategory ?? ""
    ).trim();
    const aliasTypeRaw = String(
      (body as { aliasType?: unknown }).aliasType ?? ""
    )
      .trim()
      .toLowerCase();

    if (aliasRaw.length > 80) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ALIAS" },
        { status: 400 }
      );
    }
    // Hardcoded allowlist. Anything outside this set is rejected so the
    // homepage / provider register filters that branch on alias_type stay
    // stable. Adding a new type is an explicit edit here.
    const allowedAliasTypes = new Set([
      "search",
      "local_name",
      "work_tag",
    ]);
    if (!allowedAliasTypes.has(aliasTypeRaw)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ALIAS_TYPE" },
        { status: 400 }
      );
    }
    if (!canonicalCategoryRaw) {
      return NextResponse.json(
        { ok: false, error: "CANONICAL_NOT_FOUND" },
        { status: 404 }
      );
    }

    // Resolve canonical to its as-stored casing so the inserted row's
    // canonical_category matches categories.name verbatim. Keeps the
    // public /api/categories?include=aliases join (which lowercases +
    // collapses whitespace on both sides) deterministic.
    const { data: canonicalRow, error: canonicalErr } = await adminSupabase
      .from("categories")
      .select("name")
      .ilike("name", canonicalCategoryRaw)
      .eq("active", true)
      .maybeSingle();
    if (canonicalErr) {
      console.error(
        "[admin/aliases POST create] canonical lookup failed",
        canonicalErr.message
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }
    if (!canonicalRow) {
      return NextResponse.json(
        { ok: false, error: "CANONICAL_NOT_FOUND" },
        { status: 404 }
      );
    }
    const canonicalAsStored = String(canonicalRow.name || "");

    // Same two safety checks the approve branch enforces (lines below),
    // duplicated inline rather than refactored into a shared helper so
    // the existing approve/reject SQL is untouched.
    // 1) No active alias row with the same text under any canonical.
    const { data: dupAlias, error: dupErr } = await adminSupabase
      .from("category_aliases")
      .select("alias")
      .ilike("alias", aliasRaw)
      .eq("active", true)
      .limit(1);
    if (dupErr) {
      console.error(
        "[admin/aliases POST create] duplicate-alias lookup failed",
        dupErr.message
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }
    if (dupAlias && dupAlias.length > 0) {
      return NextResponse.json(
        { ok: false, error: "DUPLICATE_ACTIVE_ALIAS" },
        { status: 409 }
      );
    }

    // 2) Alias text must not equal an active canonical category name.
    const { data: canonicalCollision, error: canonicalCollErr } =
      await adminSupabase
        .from("categories")
        .select("name")
        .ilike("name", aliasRaw)
        .eq("active", true)
        .maybeSingle();
    if (canonicalCollErr) {
      console.error(
        "[admin/aliases POST create] canonical collision lookup failed",
        canonicalCollErr.message
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }
    if (canonicalCollision) {
      return NextResponse.json(
        { ok: false, error: "ALIAS_COLLIDES_WITH_CANONICAL" },
        { status: 409 }
      );
    }

    // Insert. submitted_by_provider_id stays NULL — admin-initiated rows
    // are not provider submissions, so the notification fan-out (which
    // only runs on approve/reject) is deliberately skipped here. The
    // provider_work_terms table is also intentionally not touched.
    const { error: insertErr } = await adminSupabase
      .from("category_aliases")
      .insert({
        alias: aliasRaw,
        canonical_category: canonicalAsStored,
        alias_type: aliasTypeRaw,
        active: true,
        submitted_by_provider_id: null,
      });
    if (insertErr) {
      console.error(
        "[admin/aliases POST create] insert failed",
        insertErr.message
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      action: "created",
      alias: aliasRaw,
      canonicalCategory: canonicalAsStored,
      aliasType: aliasTypeRaw,
    });
  }

  // Look up the alias row case-insensitively. We need the canonical category
  // and submitted_by_provider_id for notifications.
  const { data: aliasRow, error: lookupErr } = await adminSupabase
    .from("category_aliases")
    .select(
      "alias, canonical_category, active, alias_type, submitted_by_provider_id"
    )
    .ilike("alias", aliasRaw)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/aliases POST] lookup failed", lookupErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  if (!aliasRow) {
    return NextResponse.json(
      { ok: false, error: "ALIAS_NOT_FOUND" },
      { status: 404 }
    );
  }

  const canonical = String(aliasRow.canonical_category || "");
  const submittedBy = String(aliasRow.submitted_by_provider_id || "");

  if (action === "approve") {
    // Safety: prevent duplicate ACTIVE alias rows for the same string.
    const { data: existingActive } = await adminSupabase
      .from("category_aliases")
      .select("alias")
      .ilike("alias", aliasRaw)
      .eq("active", true)
      .neq("alias", aliasRow.alias)
      .limit(1);
    if (existingActive && existingActive.length > 0) {
      return NextResponse.json(
        { ok: false, error: "DUPLICATE_ACTIVE_ALIAS" },
        { status: 409 }
      );
    }

    // Safety: alias must not collide with an active canonical category name.
    // Canonicals always win in the suggestion / search dedupe.
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

    // Promote: active=false → active=true. resolveCategoryAlias picks it up
    // immediately on the next search.
    const { error: updateErr } = await adminSupabase
      .from("category_aliases")
      .update({ active: true })
      .ilike("alias", aliasRaw);
    if (updateErr) {
      console.error("[admin/aliases POST] approve failed", updateErr.message);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }

    await fanOutNotifications({
      submittedByProviderId: submittedBy,
      canonical,
      type: "alias_approved",
      title: "Work term approved",
      message: `Your work term “${aliasRow.alias}” was approved under ${canonical}.`,
      payload: {
        alias: aliasRow.alias,
        canonicalCategory: canonical,
      },
    });

    return NextResponse.json({
      ok: true,
      action: "approved",
      alias: aliasRow.alias,
    });
  }

  // reject — currently we delete the inactive row. (No `status='rejected'`
  // column on category_aliases; adding one would let us preserve the
  // submission for audit. See migration TODO in
  // 20260507120000_alias_review_and_notifications.sql for the upgrade path.)
  const { error: deleteErr } = await adminSupabase
    .from("category_aliases")
    .delete()
    .ilike("alias", aliasRaw)
    .eq("active", false);
  if (deleteErr) {
    console.error("[admin/aliases POST] reject failed", deleteErr.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  await fanOutNotifications({
    submittedByProviderId: submittedBy,
    canonical,
    type: "alias_rejected",
    title: "Work term not approved",
    message: `Your work term “${aliasRow.alias}” was not approved.${reason ? ` Reason: ${reason}` : ""}`,
    payload: {
      alias: aliasRow.alias,
      canonicalCategory: canonical,
      reason: reason || null,
    },
  });

  return NextResponse.json({
    ok: true,
    action: "rejected",
    alias: aliasRow.alias,
  });
}

// Fan-out helper.
//   - If submitted_by_provider_id is known → notify only that provider.
//   - Otherwise (legacy rows pre-migration, NULL submitter) → notify every
//     provider currently offering the canonical category. Less precise but
//     bounds the surprise.
async function fanOutNotifications(params: {
  submittedByProviderId: string;
  canonical: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
}) {
  let providerIds: string[] = [];

  if (params.submittedByProviderId) {
    providerIds = [params.submittedByProviderId];
  } else if (params.canonical) {
    const { data: providers } = await adminSupabase
      .from("provider_services")
      .select("provider_id")
      .ilike("category", params.canonical);
    providerIds = Array.from(
      new Set(
        (providers || [])
          .map((r) => String(r.provider_id || "").trim())
          .filter(Boolean)
      )
    );
  }

  if (providerIds.length === 0) return;

  const rows = providerIds.map((provider_id) => ({
    provider_id,
    type: params.type,
    title: params.title,
    message: params.message,
    href: "/provider/dashboard",
    payload_json: params.payload,
  }));

  const { error: insertErr } = await adminSupabase
    .from("provider_notifications")
    .insert(rows);
  if (insertErr) {
    console.error(
      "[admin/aliases POST] notification insert failed",
      insertErr.message
    );
    // Soft-fail: alias state change already succeeded; not surfacing the
    // notification error to the admin. The UI shows the alias state; the
    // missing notification is recoverable but not blocking.
  }
}
