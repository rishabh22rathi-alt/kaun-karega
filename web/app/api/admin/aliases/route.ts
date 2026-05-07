import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";

// GET  /api/admin/aliases?status=pending|active
// POST /api/admin/aliases  body: { action: "approve"|"reject", alias, reason? }
//
// NOTE on auth: this endpoint uses the service-role client and assumes the
// caller is already authenticated as admin via route-level protection on
// /admin/* pages (the existing pattern in this codebase). For a hardened
// build, gate with an X-Admin-Phone header check against the same admin
// allowlist used in /api/kk admin actions. Documented as TODO; not blocking
// for the alias-review feature.

const PENDING = "pending";
const ACTIVE = "active";

export async function GET(request: Request) {
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

  if (!aliasRaw || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { ok: false, error: "INVALID_ACTION" },
      { status: 400 }
    );
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
