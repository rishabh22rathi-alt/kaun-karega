import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import { readThroughSnapshotCache } from "@/lib/admin/snapshotCache";

// Dedicated read for the admin dashboard's "Pending Category Requests"
// section — isolated from /api/admin/stats so a failure in any sibling
// query (providers, categories, etc.) cannot hide this list.
//
// Enriched with provider name + provider_id by joining `providers` on
// normalized last-10-digit phone (providers / requests may store as
// "91XXXXXXXXXX" or "XXXXXXXXXX" interchangeably).

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// Lazily backfill `pending_category_requests` rows for orphan-leaked
// provider_services entries (rows whose category has no corresponding
// `categories` row AT ALL and no matching pending_category_requests row
// for the same provider_id + category key).
//
// Why this fires from the admin read path: the dashboard-profile route
// already synthesizes Status="pending" for orphans so the provider sees
// "Under Review", but the lifecycle (approve / reject + notification +
// provider_services upsert on approve) lives in `pending_category_requests`.
// Without a real request row, the admin queue can't show the item and
// approvals can't fire. Backfilling here keeps `pending_category_requests`
// as the single source of truth without requiring a manual cron run.
//
// Idempotent: skips when a row already exists. Soft-fail: insert errors
// are logged but never block the read response.
async function backfillOrphanPendingRequests(): Promise<void> {
  try {
    // 1) Full canonical set (any active state). A provider_services row
    //    whose category is in this set is NOT an orphan — it's either
    //    approved or admin-deactivated.
    const { data: catRows, error: catErr } = await adminSupabase
      .from("categories")
      .select("name");
    if (catErr) {
      console.warn(
        "[admin/pending-category-requests] backfill: categories fetch failed; skipping",
        catErr.message
      );
      return;
    }
    const knownCategoryKeys = new Set(
      (catRows || [])
        .map((row) => normalizeCategoryKey((row as { name?: unknown }).name))
        .filter(Boolean)
    );

    // 2) provider_services rows — candidate orphans = those whose
    //    category is NOT in knownCategoryKeys.
    const { data: serviceRows, error: servicesErr } = await adminSupabase
      .from("provider_services")
      .select("provider_id, category");
    if (servicesErr) {
      console.warn(
        "[admin/pending-category-requests] backfill: provider_services fetch failed; skipping",
        servicesErr.message
      );
      return;
    }
    const orphanCandidates: Array<{ providerId: string; category: string }> = [];
    for (const row of serviceRows || []) {
      const providerId = String(
        (row as { provider_id?: unknown }).provider_id || ""
      ).trim();
      const category = String(
        (row as { category?: unknown }).category || ""
      ).trim();
      const key = normalizeCategoryKey(category);
      if (!providerId || !category || !key) continue;
      if (knownCategoryKeys.has(key)) continue;
      orphanCandidates.push({ providerId, category });
    }
    if (orphanCandidates.length === 0) return;

    // 3) Existing pending_category_requests rows for those (provider_id,
    //    category) pairs — any status. We must skip backfilling when ANY
    //    state (pending/rejected/approved/closed/archived) already exists
    //    for that pair, otherwise we'd duplicate a closed request.
    const providerIds = Array.from(
      new Set(orphanCandidates.map((o) => o.providerId))
    );
    const { data: existingRows, error: existingErr } = await adminSupabase
      .from("pending_category_requests")
      .select("provider_id, requested_category, status")
      .in("provider_id", providerIds);
    if (existingErr) {
      console.warn(
        "[admin/pending-category-requests] backfill: existing-requests fetch failed; skipping",
        existingErr.message
      );
      return;
    }
    const existingKey = (providerId: string, category: string) =>
      `${providerId}::${normalizeCategoryKey(category)}`;
    const existingPairs = new Set(
      (existingRows || []).map((row) =>
        existingKey(
          String((row as { provider_id?: unknown }).provider_id || ""),
          String((row as { requested_category?: unknown }).requested_category || "")
        )
      )
    );
    const missing = orphanCandidates.filter(
      (o) => !existingPairs.has(existingKey(o.providerId, o.category))
    );
    if (missing.length === 0) return;

    // 4) Insert the missing orphan rows. Provider name/phone are no longer
    //    written here (those columns don't exist on the live table) — the
    //    read path enriches name/phone from provider_id, so no per-provider
    //    fetch is needed at backfill time.
    const nowIso = new Date().toISOString();
    // Write ONLY columns that exist on the live table: provider_id,
    // requested_category, status, created_at. The table has no
    // request_id / provider_name / phone columns — including them made the
    // whole batch insert fail (PGRST204), so orphan provider categories
    // were never backfilled. provider_name / phone are enriched at read
    // time from provider_id; user_phone is omitted so these rows read as
    // provider-originated.
    const insertPayload = missing.map((m) => ({
      provider_id: m.providerId,
      requested_category: m.category,
      status: "pending",
      created_at: nowIso,
    }));
    const { error: insertErr } = await adminSupabase
      .from("pending_category_requests")
      .insert(insertPayload);
    if (insertErr) {
      console.warn(
        "[admin/pending-category-requests] backfill: insert failed",
        insertErr.message
      );
      return;
    }
    console.log(
      `[admin/pending-category-requests] backfill: inserted ${missing.length} orphan pending request(s)`
    );
  } catch (err) {
    console.warn(
      "[admin/pending-category-requests] backfill threw; skipping",
      err instanceof Error ? err.message : err
    );
  }
}

async function computePendingCategoryApplications(): Promise<{
  categoryApplications: Array<{
    RequestID: string;
    ProviderName: string;
    ProviderID: string;
    Phone: string;
    RequestedCategory: string;
    Area?: string;
    Status: string;
    CreatedAt: string;
    AdminActionBy?: string;
    AdminActionAt?: string;
    AdminActionReason?: string;
  }>;
}> {
  // Best-effort backfill BEFORE the read so orphan-leaked categories
  // surface in this same response. Soft-fails internally — never blocks
  // the read.
  await backfillOrphanPendingRequests();

  // Surface only actionable rows. Rejected / approved / archived rows stay
  // in the table for audit but never reappear in the admin queue. NULL
  // status is treated as pending defensively (some legacy rows may pre-date
  // the explicit default).
  //
  // `user_phone IS NULL` keeps this queue to PROVIDER-originated requests
  // only (Phase 2 separation). Provider inserts never set user_phone;
  // user-originated unlisted-work rows always do (and may carry a
  // backfilled provider_id, which must NOT promote them here). User demand
  // stays visible via the Kaam tab (tasks.status='pending_category_review').
  const { data, error } = await adminSupabase
    .from("pending_category_requests")
    .select("*")
    .or("status.is.null,status.eq.pending")
    .is("user_phone", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[admin/pending-category-requests] fetch failed", error);
    throw new Error(error.message || "Failed to fetch");
  }

  const rawRows = data ?? [];

  // Provider-originated rows carry `provider_id` (user_phone is NULL after
  // the filter, and the table has no `phone` column), so enrich provider
  // name + phone via a single batched provider_id lookup.
  const providerIdSet = new Set<string>();
  for (const row of rawRows) {
    const pid = String((row as Record<string, unknown>).provider_id ?? "").trim();
    if (pid) providerIdSet.add(pid);
  }

  const providersById = new Map<string, { name: string; phone: string }>();
  if (providerIdSet.size > 0) {
    const { data: providerRows } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .in("provider_id", Array.from(providerIdSet));
    for (const provider of providerRows ?? []) {
      const pid = String((provider as { provider_id?: unknown }).provider_id ?? "").trim();
      if (!pid) continue;
      providersById.set(pid, {
        name: String((provider as { full_name?: unknown }).full_name ?? ""),
        phone: String((provider as { phone?: unknown }).phone ?? ""),
      });
    }
  }

  const categoryApplications = rawRows.map((row: Record<string, unknown>) => {
    const providerId = String(row.provider_id ?? "").trim();
    const enrichment = providersById.get(providerId);
    // `id` (uuid PK) is the identifier the frontend sends back to
    // approve/reject; the table has no `request_id` column.
    const idValue = row.id ?? row.created_at ?? "";
    return {
      RequestID: String(idValue ?? ""),
      ProviderName: enrichment?.name ?? "",
      ProviderID: providerId,
      Phone: enrichment?.phone ?? "",
      RequestedCategory: String(row.requested_category ?? ""),
      Area: row.area != null ? String(row.area) : undefined,
      Status: String(row.status ?? "pending"),
      CreatedAt: String(row.created_at ?? ""),
      AdminActionBy:
        row.admin_action_by != null ? String(row.admin_action_by) : undefined,
      AdminActionAt:
        row.admin_action_at != null ? String(row.admin_action_at) : undefined,
      AdminActionReason:
        row.admin_action_reason != null ? String(row.admin_action_reason) : undefined,
    };
  });

  return { categoryApplications };
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const forceRefresh =
    new URL(request.url).searchParams.get("refresh") === "1";

  type Payload = Awaited<ReturnType<typeof computePendingCategoryApplications>>;
  let payload: Payload;
  let cache: import("@/lib/admin/snapshotCache").CacheMetadata;
  try {
    const result = await readThroughSnapshotCache<Payload>({
      key: "pending_category_requests",
      ttlSeconds: 15 * 60,
      forceRefresh,
      adminPhone: auth.admin.phone,
      compute: computePendingCategoryApplications,
    });
    payload = result.payload;
    cache = result.cache;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    categoryApplications: payload.categoryApplications,
    cache,
  });
}
