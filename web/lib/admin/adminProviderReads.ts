/**
 * Backend-native provider read helpers for admin flows.
 *
 * Tables used: providers, provider_services, provider_areas (service-role client).
 * Join pattern mirrors adminDashboardStats.ts.
 *
 * Response shape matches the Provider type in lib/api/providers.ts.
 *
 * NOTE: totalTasks and totalResponses are returned as 0 — task data is not yet
 * in Supabase. The UI renders `totalTasks ?? 0` so this is a visible but safe
 * placeholder until a future slice migrates task reads.
 */

import { adminSupabase } from "../supabase/admin";

export type ProviderRow = {
  id: string;
  name: string;
  phone: string;
  categories: string[];
  areas: string[];
  status: string;
  totalTasks: number;
  totalResponses: number;
};

// Normalize DB status values (lowercase from provider_register/verify) to
// PascalCase so the frontend status filter ("Active", "Pending", "Blocked") works.
function normalizeStatus(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "pending") return "Pending";
  if (s === "active") return "Active";
  if (s === "blocked") return "Blocked";
  // Pass through any other values (e.g. "rejected", custom GAS values)
  return String(raw ?? "");
}

function assembleProviders(
  providerRows: Array<{ provider_id: unknown; full_name: unknown; phone: unknown; status: unknown }>,
  serviceRows: Array<{ provider_id: unknown; category: unknown }> | null,
  areaRows: Array<{ provider_id: unknown; area: unknown }> | null
): ProviderRow[] {
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
      id: pid,
      name: String(p.full_name ?? ""),
      phone: String(p.phone ?? ""),
      status: normalizeStatus(String(p.status ?? "")),
      categories: (servicesByProvider.get(pid) ?? []).filter(Boolean),
      areas: (areasByProvider.get(pid) ?? []).filter(Boolean),
      totalTasks: 0,
      totalResponses: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Get all providers
// ---------------------------------------------------------------------------

export async function getAllProvidersFromSupabase(): Promise<ProviderRow[]> {
  const [
    { data: providerRows, error: providerError },
    { data: serviceRows },
    { data: areaRows },
  ] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone, status")
      .order("full_name", { ascending: true }),
    adminSupabase.from("provider_services").select("provider_id, category"),
    adminSupabase.from("provider_areas").select("provider_id, area"),
  ]);

  if (providerError) throw new Error(providerError.message);
  if (!providerRows) return [];

  return assembleProviders(providerRows, serviceRows, areaRows);
}

// ---------------------------------------------------------------------------
// Get single provider by ID
// ---------------------------------------------------------------------------

export async function getProviderByIdFromSupabase(
  providerId: string
): Promise<ProviderRow | null> {
  const [
    { data: providerRow, error: providerError },
    { data: serviceRows },
    { data: areaRows },
  ] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone, status")
      .eq("provider_id", providerId)
      .single(),
    adminSupabase
      .from("provider_services")
      .select("provider_id, category")
      .eq("provider_id", providerId),
    adminSupabase
      .from("provider_areas")
      .select("provider_id, area")
      .eq("provider_id", providerId),
  ]);

  if (providerError || !providerRow) return null;

  const rows = assembleProviders([providerRow], serviceRows, areaRows);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Get provider by phone (for get_provider_by_phone intercept)
// ---------------------------------------------------------------------------

export type ProviderByPhonePayload =
  | {
      ok: true;
      provider: {
        ProviderID: string;
        ProviderName: string;
        Name: string;
        Phone: string;
        Verified: string;
        PendingApproval: string;
        Status: string;
        Services: { Category: string }[];
        Areas: { Area: string }[];
      };
    }
  | { ok: false; error: string };

export async function getProviderByPhoneFromSupabase(
  phoneRaw: string
): Promise<ProviderByPhonePayload> {
  const phone10 = String(phoneRaw || "").replace(/\D/g, "").slice(-10);
  if (phone10.length !== 10) return { ok: false, error: "Provider not found" };

  try {
    const { data: providerRows, error } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone, status, verified")
      .or(`phone.eq.${phone10},phone.eq.91${phone10}`)
      .limit(5);

    if (error) return { ok: false, error: error.message };

    const row = (
      (providerRows ?? []) as Array<{
        provider_id: string;
        full_name: string | null;
        phone: string | null;
        status: string | null;
        verified: string | null;
      }>
    ).find((r) => String(r.phone || "").replace(/\D/g, "").slice(-10) === phone10);

    if (!row) return { ok: false, error: "Provider not found" };

    const providerId = String(row.provider_id || "").trim();

    const [{ data: serviceRows }, { data: areaRows }] = await Promise.all([
      adminSupabase
        .from("provider_services")
        .select("category")
        .eq("provider_id", providerId),
      adminSupabase
        .from("provider_areas")
        .select("area")
        .eq("provider_id", providerId),
    ]);

    return {
      ok: true,
      provider: {
        ProviderID: providerId,
        ProviderName: String(row.full_name || "").trim(),
        Name: String(row.full_name || "").trim(),
        Phone: String(row.phone || "").replace(/\D/g, "").slice(-10),
        Verified: String(row.verified || "no").trim() || "no",
        PendingApproval:
          String(row.status || "").trim().toLowerCase() === "pending" ? "yes" : "no",
        Status: normalizeStatus(row.status),
        Services: (
          (serviceRows ?? []) as Array<{ category: string | null }>
        )
          .map((s) => ({ Category: String(s.category || "").trim() }))
          .filter((s) => s.Category),
        Areas: (
          (areaRows ?? []) as Array<{ area: string | null }>
        )
          .map((a) => ({ Area: String(a.area || "").trim() }))
          .filter((a) => a.Area),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Provider not found",
    };
  }
}

// ---------------------------------------------------------------------------
// Update provider profile (name, phone, categories, areas)
// ---------------------------------------------------------------------------

export type UpdateProviderInput = {
  id: string;
  name: string;
  phone: string;
  categories: string[];
  areas: string[];
};

export async function updateProviderInSupabase(
  input: UpdateProviderInput
): Promise<{ success: boolean }> {
  const { id, name, phone, categories, areas } = input;

  const { error: updateError } = await adminSupabase
    .from("providers")
    .update({ full_name: name, phone })
    .eq("provider_id", id);
  if (updateError) return { success: false };

  const { error: deleteServicesError } = await adminSupabase
    .from("provider_services")
    .delete()
    .eq("provider_id", id);
  if (deleteServicesError) return { success: false };

  if (categories.length > 0) {
    const { error: insertServicesError } = await adminSupabase
      .from("provider_services")
      .insert(categories.map((category) => ({ provider_id: id, category })));
    if (insertServicesError) return { success: false };
  }

  const { error: deleteAreasError } = await adminSupabase
    .from("provider_areas")
    .delete()
    .eq("provider_id", id);
  if (deleteAreasError) return { success: false };

  if (areas.length > 0) {
    const { error: insertAreasError } = await adminSupabase
      .from("provider_areas")
      .insert(areas.map((area) => ({ provider_id: id, area })));
    if (insertAreasError) return { success: false };
  }

  return { success: true };
}
