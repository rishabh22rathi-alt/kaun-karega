import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Temporary diagnostic endpoint for /admin/dashboard "cards = 0" investigation.
// Returns raw rows + raw counts straight from Supabase so the failing query
// (column rename, RLS denial, empty table, etc.) is visible to the caller
// without server log access. Gated behind requireAdminSession — same auth
// gate as /api/admin/stats. Remove once the root cause is fixed.
//
// Usage:
//   curl -i -H "Cookie: kk_auth_session=…" http://localhost:3000/api/admin/debug-stats
export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized", note: "kk_auth_session cookie not recognised as admin" },
      { status: 401 }
    );
  }

  const [
    providersRes,
    providerServicesRes,
    providerAreasRes,
    categoriesRes,
    pendingRes,
    providersCountRes,
    providersVerifiedCountRes,
    providersPendingCountRes,
    pendingCategoryPendingCountRes,
    profilesUserCountRes,
  ] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone, verified, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    adminSupabase.from("provider_services").select("provider_id, category").limit(200),
    adminSupabase.from("provider_areas").select("provider_id, area").limit(200),
    adminSupabase.from("categories").select("name, active").order("name", { ascending: true }),
    adminSupabase
      .from("pending_category_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    adminSupabase.from("providers").select("provider_id", { count: "exact", head: true }),
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true })
      .eq("verified", "yes"),
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true })
      .eq("status", "pending"),
    adminSupabase
      .from("pending_category_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    adminSupabase
      .from("profiles")
      .select("phone", { count: "exact", head: true })
      .eq("role", "user"),
  ]);

  const errString = (e: unknown): string | null => {
    if (!e) return null;
    if (e instanceof Error) return e.message;
    if (typeof e === "object" && e && "message" in e) {
      return String((e as { message?: unknown }).message ?? "");
    }
    return String(e);
  };

  return NextResponse.json({
    ok: true,
    note:
      "Diagnostic endpoint. Inspect each .error to find the failing query; inspect counts to validate row visibility under service-role key.",
    admin: { phone: auth.admin?.phone, name: auth.admin?.name },
    queries: {
      providers: {
        error: errString(providersRes.error),
        rowCount: providersRes.data?.length ?? 0,
        sample: providersRes.data?.slice(0, 5) ?? [],
      },
      provider_services: {
        error: errString(providerServicesRes.error),
        rowCount: providerServicesRes.data?.length ?? 0,
        sample: providerServicesRes.data?.slice(0, 5) ?? [],
      },
      provider_areas: {
        error: errString(providerAreasRes.error),
        rowCount: providerAreasRes.data?.length ?? 0,
        sample: providerAreasRes.data?.slice(0, 5) ?? [],
      },
      categories: {
        error: errString(categoriesRes.error),
        rowCount: categoriesRes.data?.length ?? 0,
        sample: categoriesRes.data?.slice(0, 10) ?? [],
      },
      pending_category_requests: {
        error: errString(pendingRes.error),
        rowCount: pendingRes.data?.length ?? 0,
        sample: pendingRes.data?.slice(0, 10) ?? [],
      },
    },
    counts: {
      providersTotal: {
        error: errString(providersCountRes.error),
        count: providersCountRes.count ?? null,
      },
      providersVerifiedYes: {
        error: errString(providersVerifiedCountRes.error),
        count: providersVerifiedCountRes.count ?? null,
      },
      providersStatusPending: {
        error: errString(providersPendingCountRes.error),
        count: providersPendingCountRes.count ?? null,
      },
      pendingCategoryRequestsPending: {
        error: errString(pendingCategoryPendingCountRes.error),
        count: pendingCategoryPendingCountRes.count ?? null,
      },
      profilesUser: {
        error: errString(profilesUserCountRes.error),
        count: profilesUserCountRes.count ?? null,
      },
    },
  });
}
