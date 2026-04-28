import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Dedicated read for the admin dashboard's "Pending Category Requests"
// section — isolated from /api/admin/stats so a failure in any sibling
// query (providers, categories, etc.) cannot hide this list.
export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await adminSupabase
    .from("pending_category_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[admin/pending-category-requests] fetch failed", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch" },
      { status: 500 }
    );
  }

  // Map raw rows → the PascalCase CategoryApplication shape the dashboard
  // table already binds to. Same key derivation as the lib helper.
  const categoryApplications = (data ?? []).map((row: Record<string, unknown>) => {
    const idValue = row.id ?? row.request_id ?? row.created_at ?? "";
    return {
      RequestID: String(idValue ?? ""),
      ProviderName: "",
      Phone: String(row.user_phone ?? row.phone ?? ""),
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
