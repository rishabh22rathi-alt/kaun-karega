import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Dedicated read for the admin dashboard's "Pending Category Requests"
// section — isolated from /api/admin/stats so a failure in any sibling
// query (providers, categories, etc.) cannot hide this list.
//
// Enriched with provider name + provider_id by joining `providers` on
// normalized last-10-digit phone (providers / requests may store as
// "91XXXXXXXXXX" or "XXXXXXXXXX" interchangeably).

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

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

    // 4) Fetch provider name + phone for the missing rows so audit
    //    fields are populated. One query, scoped to the orphan providers.
    const missingProviderIds = Array.from(
      new Set(missing.map((m) => m.providerId))
    );
    const { data: providerEnrichRows } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .in("provider_id", missingProviderIds);
    const enrichByProviderId = new Map<
      string,
      { name: string; phone: string }
    >();
    for (const row of providerEnrichRows || []) {
      enrichByProviderId.set(
        String((row as { provider_id?: unknown }).provider_id || ""),
        {
          name: String((row as { full_name?: unknown }).full_name || ""),
          phone: String((row as { phone?: unknown }).phone || ""),
        }
      );
    }

    const nowIso = new Date().toISOString();
    const insertPayload = missing.map((m) => {
      const enrich = enrichByProviderId.get(m.providerId);
      return {
        request_id: `PCR-${randomUUID()}`,
        provider_id: m.providerId,
        provider_name: enrich?.name || null,
        phone: enrich?.phone || null,
        requested_category: m.category,
        status: "pending",
        created_at: nowIso,
      };
    });
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

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Best-effort backfill BEFORE the read so orphan-leaked categories
  // surface in this same response. Soft-fails internally — never blocks
  // the read.
  await backfillOrphanPendingRequests();

  // Surface only actionable rows. Rejected / approved / archived rows stay
  // in the table for audit but never reappear in the admin queue. NULL
  // status is treated as pending defensively (some legacy rows may pre-date
  // the explicit default).
  const { data, error } = await adminSupabase
    .from("pending_category_requests")
    .select("*")
    .or("status.is.null,status.eq.pending")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[admin/pending-category-requests] fetch failed", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch" },
      { status: 500 }
    );
  }

  const rawRows = data ?? [];

  // Build the set of distinct phones we need to enrich. Match on full phone
  // string AND on last-10 since providers may be stored either way.
  const phoneSet = new Set<string>();
  const phoneSet10 = new Set<string>();
  for (const row of rawRows) {
    const phoneRaw = String((row as Record<string, unknown>).user_phone ?? (row as Record<string, unknown>).phone ?? "");
    if (phoneRaw) phoneSet.add(phoneRaw);
    const phone10 = normalizePhone(phoneRaw);
    if (phone10.length === 10) phoneSet10.add(phone10);
  }

  const providersByPhone10 = new Map<string, { name: string; providerId: string }>();
  if (phoneSet10.size > 0) {
    const { data: providerRows } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .or(
        Array.from(phoneSet)
          .map((p) => `phone.eq.${p}`)
          .concat(Array.from(phoneSet10).map((p) => `phone.eq.${p}`))
          .join(",")
      );
    for (const provider of providerRows ?? []) {
      const phone10 = normalizePhone((provider as { phone?: unknown }).phone);
      if (phone10.length !== 10) continue;
      // First match wins — if multiple providers share a phone, the
      // earliest-listed one is shown. Realistically each phone maps to
      // one provider.
      if (providersByPhone10.has(phone10)) continue;
      providersByPhone10.set(phone10, {
        name: String((provider as { full_name?: unknown }).full_name ?? ""),
        providerId: String((provider as { provider_id?: unknown }).provider_id ?? ""),
      });
    }
  }

  const categoryApplications = rawRows.map((row: Record<string, unknown>) => {
    const idValue = row.id ?? row.request_id ?? row.created_at ?? "";
    const phoneRaw = String(row.user_phone ?? row.phone ?? "");
    const phone10 = normalizePhone(phoneRaw);
    const enrichment = providersByPhone10.get(phone10);
    return {
      RequestID: String(idValue ?? ""),
      ProviderName: enrichment?.name ?? "",
      ProviderID: enrichment?.providerId ?? "",
      Phone: phoneRaw,
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

  return NextResponse.json({ ok: true, categoryApplications });
}
