import { NextResponse } from "next/server";

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

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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
