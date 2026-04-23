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
    { data: serviceRows },
    { data: areaRows },
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

  if (providerError) throw new Error(providerError.message);
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
      Verified: String(p.verified ?? "no"),
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

  if (error) throw new Error(error.message);
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
  const { data, error } = await adminSupabase
    .from("pending_category_requests")
    .select(
      "request_id, provider_id, provider_name, phone, requested_category, status, created_at, admin_action_by, admin_action_at, admin_action_reason"
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data) return [];

  return data.map((row) => ({
    RequestID: String(row.request_id ?? ""),
    ProviderID: row.provider_id != null ? String(row.provider_id) : undefined,
    ProviderName: String(row.provider_name ?? ""),
    Phone: String(row.phone ?? ""),
    RequestedCategory: String(row.requested_category ?? ""),
    Status: String(row.status ?? "pending"),
    CreatedAt: String(row.created_at ?? ""),
    AdminActionBy: row.admin_action_by != null ? String(row.admin_action_by) : undefined,
    AdminActionAt: row.admin_action_at != null ? String(row.admin_action_at) : undefined,
    AdminActionReason:
      row.admin_action_reason != null ? String(row.admin_action_reason) : undefined,
  }));
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
    const [providers, categories, categoryApplications] = await Promise.all([
      getProvidersFromSupabase(),
      getCategoriesFromSupabase(),
      getCategoryApplicationsFromSupabase(),
    ]);

    const stats: DashboardStats = {
      totalProviders: providers.length,
      verifiedProviders: providers.filter(
        (p) => String(p.Verified).trim().toLowerCase() === "yes"
      ).length,
      pendingAdminApprovals: providers.filter(
        (p) => String(p.PendingApproval).trim().toLowerCase() === "yes"
      ).length,
      pendingCategoryRequests: categoryApplications.filter(
        (item) => String(item.Status).trim().toLowerCase() === "pending"
      ).length,
    };

    return { ok: true, stats, providers, categoryApplications, categories };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard stats";
    return { ok: false, error: message };
  }
}
