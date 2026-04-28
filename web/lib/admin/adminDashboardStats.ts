/**
 * Backend-native admin dashboard stats provider.
 *
 * Data sources (as of Slice 5 — fully backend-native):
 *   - providers, provider_services, provider_areas → Supabase
 *   - categories                                  → Supabase
 *   - pending_category_requests                   → Supabase
 *
 * GAS dependency for this stats path: NONE.
 *
 * The response shape matches AdminDashboardResponse as typed in the
 * admin dashboard page — do not change field names without updating
 * app/admin/dashboard/page.tsx accordingly.
 */

import { adminSupabase } from "../supabase/admin";

// ---------------------------------------------------------------------------
// Response types — mirror AdminDashboardResponse in dashboard/page.tsx
// ---------------------------------------------------------------------------

export type AdminProvider = {
  ProviderID: string;
  ProviderName: string;
  Phone: string;
  Verified: string;        // "yes" | "no"
  PendingApproval: string; // "yes" | "no" — derived from providers.status === "pending"
  Category: string;        // comma-separated from provider_services
  Areas: string;           // comma-separated from provider_areas
};

export type CategoryApplication = {
  RequestID: string;
  ProviderID?: string;
  ProviderName: string;
  Phone: string;
  RequestedCategory: string;
  Area?: string;
  Status: string;
  CreatedAt: string;
  AdminActionBy?: string;
  AdminActionAt?: string;
  AdminActionReason?: string;
};

export type ManagedCategory = {
  CategoryName: string;
  Active: string; // "yes" | "no"
};

export type DashboardStats = {
  totalProviders: number;
  verifiedProviders: number;
  pendingAdminApprovals: number;
  pendingCategoryRequests: number;
  registeredUsers: number;
};

export type AdminDashboardStatsResult =
  | {
      ok: true;
      stats: DashboardStats;
      providers: AdminProvider[];
      categoryApplications: CategoryApplication[];
      categories: ManagedCategory[];
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Supabase: providers (backend-native)
// ---------------------------------------------------------------------------

async function getProvidersFromSupabase(): Promise<AdminProvider[]> {
  const [
    { data: providerRows, error: providerError },
    { data: serviceRows, error: serviceError },
    { data: areaRows, error: areaError },
  ] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone, verified, status")
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("provider_services")
      .select("provider_id, category"),
    adminSupabase
      .from("provider_areas")
      .select("provider_id, area"),
  ]);

  if (providerError) {
    console.error("[admin/stats] QUERY ERROR (providers):", providerError);
    throw new Error(providerError.message);
  }
  if (serviceError) {
    console.error("[admin/stats] QUERY ERROR (provider_services):", serviceError);
  }
  if (areaError) {
    console.error("[admin/stats] QUERY ERROR (provider_areas):", areaError);
  }
  console.log(
    "[admin/stats] providers raw rows:",
    providerRows?.length,
    "services rows:",
    serviceRows?.length,
    "area rows:",
    areaRows?.length
  );
  if (!providerRows) return [];

  // In-memory join — O(n) per table with Map lookups
  const servicesByProvider = new Map<string, string[]>();
  for (const row of serviceRows ?? []) {
    const id = String(row.provider_id ?? "");
    if (!servicesByProvider.has(id)) servicesByProvider.set(id, []);
    servicesByProvider.get(id)!.push(String(row.category ?? ""));
  }

  const areasByProvider = new Map<string, string[]>();
  for (const row of areaRows ?? []) {
    const id = String(row.provider_id ?? "");
    if (!areasByProvider.has(id)) areasByProvider.set(id, []);
    areasByProvider.get(id)!.push(String(row.area ?? ""));
  }

  return providerRows.map((p) => {
    const pid = String(p.provider_id ?? "");
    return {
      ProviderID: pid,
      ProviderName: String(p.full_name ?? ""),
      Phone: String(p.phone ?? ""),
      // Defensive: providers.verified is stored as string "yes"/"no" in
      // current writes, but tolerate boolean true/false too (matching the
      // categories.active handling below) so a future schema migration
      // doesn't silently zero the card.
      Verified:
        p.verified === true ||
        String(p.verified ?? "").trim().toLowerCase() === "yes"
          ? "yes"
          : "no",
      PendingApproval:
        String(p.status ?? "").trim().toLowerCase() === "pending" ? "yes" : "no",
      Category: (servicesByProvider.get(pid) ?? []).filter(Boolean).join(", "),
      Areas: (areasByProvider.get(pid) ?? []).filter(Boolean).join(", "),
    };
  });
}

// ---------------------------------------------------------------------------
// Supabase: categories (backend-native)
// ---------------------------------------------------------------------------

async function getCategoriesFromSupabase(): Promise<ManagedCategory[]> {
  const { data, error } = await adminSupabase
    .from("categories")
    .select("name, active")
    .order("name", { ascending: true });

  if (error) {
    console.error("[admin/stats] QUERY ERROR (categories):", error);
    throw new Error(error.message);
  }
  console.log("[admin/stats] categories raw rows:", data?.length);
  if (!data) return [];

  return data.map((cat) => ({
    CategoryName: String(cat.name ?? ""),
    // Supabase may store active as boolean or as "yes"/"no" string — handle both
    Active:
      cat.active === true || String(cat.active ?? "").toLowerCase() === "yes"
        ? "yes"
        : "no",
  }));
}

// ---------------------------------------------------------------------------
// Supabase: category applications (backend-native, replaces GAS Slice 5)
// ---------------------------------------------------------------------------

async function getCategoryApplicationsFromSupabase(): Promise<CategoryApplication[]> {
  // Real table columns: id, user_phone, requested_category, area, details,
  // status, created_at, admin_action_*. SELECT * tolerates additive schema
  // changes without re-breaking this read path.
  const { data, error } = await adminSupabase
    .from("pending_category_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[admin/stats] QUERY ERROR (pending_category_requests):", error);
    throw new Error(error.message);
  }
  console.log("[admin/stats] pending_category_requests raw rows:", data?.length);
  if (!data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => {
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
}

// ---------------------------------------------------------------------------
// Supabase: exact provider counts for dashboard cards
// ---------------------------------------------------------------------------
//
// The cards "Total Providers", "Verified Providers" and "Pending Admin
// Approvals" must reflect the true counts in the providers table, not
// counts derived from the providers array we return for the table preview.
// A regular `.select(...)` is implicitly capped at 1000 rows by Supabase's
// default range, so deriving counts from `providers.length` undercounts any
// table with more than 1000 rows. Three head-only count queries bypass this
// cap entirely.
//
// Filter values match what the writers actually store: `verified="yes"` and
// `status="pending"` are written verbatim (lowercase) by
// adminProviderMutations.ts and provider/apply/route.ts.

async function getProviderCounts(): Promise<{
  total: number;
  verified: number;
  pendingApproval: number;
}> {
  const [totalRes, verifiedRes, pendingRes] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true }),
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true })
      .eq("verified", "yes"),
    adminSupabase
      .from("providers")
      .select("provider_id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  if (totalRes.error) {
    console.error(
      "[admin/stats] QUERY ERROR (providers count total):",
      totalRes.error
    );
  }
  if (verifiedRes.error) {
    console.error(
      "[admin/stats] QUERY ERROR (providers count verified):",
      verifiedRes.error
    );
  }
  if (pendingRes.error) {
    console.error(
      "[admin/stats] QUERY ERROR (providers count pending):",
      pendingRes.error
    );
  }

  console.log(
    "[admin/stats] provider counts (total / verified / pendingApproval):",
    totalRes.count,
    verifiedRes.count,
    pendingRes.count
  );

  return {
    total: Number(totalRes.count ?? 0),
    verified: Number(verifiedRes.count ?? 0),
    pendingApproval: Number(pendingRes.count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Supabase: exact count of registered users
// ---------------------------------------------------------------------------
//
// Backs the "Registered Users" dashboard tile. The user registry is the
// `profiles` table — every successful OTP verify upserts a row there
// (web/app/api/verify-otp/route.ts and web/app/api/auth/verify-otp/route.ts).
// We filter `role = 'user'` so that future provider/admin profile rows do
// not double-count. Uses head:true count so the result is unaffected by the
// 1000-row default range.

async function getRegisteredUsersCount(): Promise<number> {
  const { count, error } = await adminSupabase
    .from("profiles")
    .select("phone", { count: "exact", head: true })
    .eq("role", "user")
    .eq("is_active", true);

  if (error) {
    console.error("[admin/stats] QUERY ERROR (profiles count):", error);
    return 0;
  }
  console.log("[admin/stats] profiles (role=user, is_active=true) count:", count);
  return Number(count ?? 0);
}

// ---------------------------------------------------------------------------
// Supabase: exact count of pending category requests
// ---------------------------------------------------------------------------
//
// The dashboard card "Pending Category Requests" must reflect the true count
// of pending rows, not the count derived from the limit-20 preview list
// returned by getCategoryApplicationsFromSupabase(). A dedicated head-only
// count query is cheap and avoids capping the card at 20.

async function getPendingCategoryRequestsCount(): Promise<number> {
  const { count, error } = await adminSupabase
    .from("pending_category_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    console.error(
      "[admin/stats] QUERY ERROR (pending_category_requests count):",
      error
    );
    return 0;
  }
  console.log("[admin/stats] pending_category_requests pending count:", count);
  return Number(count ?? 0);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Assemble the full admin dashboard stats payload — fully Supabase-native as of Slice 5.
 *
 * Never throws — returns { ok: false, error } on any hard failure.
 */
export async function getAdminDashboardStats(): Promise<AdminDashboardStatsResult> {
  try {
    const [
      providers,
      categories,
      categoryApplications,
      pendingCategoryCount,
      providerCounts,
      registeredUsersCount,
    ] = await Promise.all([
      getProvidersFromSupabase(),
      getCategoriesFromSupabase(),
      getCategoryApplicationsFromSupabase(),
      getPendingCategoryRequestsCount(),
      getProviderCounts(),
      getRegisteredUsersCount(),
    ]);

    console.log(
      "[admin/stats] providers preview list length:",
      providers?.length,
      "(true total from count query:",
      providerCounts.total,
      ")"
    );
    console.log("[admin/stats] categories:", categories?.length);
    console.log(
      "[admin/stats] pending requests sample:",
      categoryApplications?.length
    );

    const stats: DashboardStats = {
      // Cards must use the head-only count queries — the `providers` array
      // is implicitly capped at 1000 rows by Supabase's default range, so
      // providers.length undercounts any table with >1000 providers.
      totalProviders: providerCounts.total,
      verifiedProviders: providerCounts.verified,
      pendingAdminApprovals: providerCounts.pendingApproval,
      // True count from a dedicated query — not derived from the limit-20
      // categoryApplications preview, which would cap the card at 20.
      pendingCategoryRequests: pendingCategoryCount,
      registeredUsers: registeredUsersCount,
    };

    console.log("[admin/stats] FINAL RESULT:", {
      totalProviders: stats.totalProviders,
      verifiedProviders: stats.verifiedProviders,
      pendingAdminApprovals: stats.pendingAdminApprovals,
      pendingCategoryRequests: stats.pendingCategoryRequests,
      registeredUsers: stats.registeredUsers,
    });

    return { ok: true, stats, providers, categoryApplications, categories };
  } catch (error: unknown) {
    console.error("[admin/stats] FATAL ERROR:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard stats";
    return { ok: false, error: message };
  }
}
