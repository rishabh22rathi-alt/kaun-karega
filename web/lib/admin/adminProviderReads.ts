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
import { getDefaultCityCode } from "../cities/cityContext";

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
        // Derived from the provider's first non-NULL provider_areas.city_code.
        // Empty string when the provider has no provider_areas rows yet —
        // edit-mode UI then falls back to the default city.
        CityCode: string;
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
        .select("area, city_code")
        .eq("provider_id", providerId),
    ]);

    const typedAreaRows = (areaRows ?? []) as Array<{
      area: string | null;
      city_code: string | null;
    }>;

    // Derive the provider's city from the first non-NULL, well-formed
    // city_code in their provider_areas. Empty when no rows or all NULL —
    // the register page's edit-mode falls back to the default city in
    // that case.
    let derivedCityCode = "";
    for (const row of typedAreaRows) {
      const candidate = String(row.city_code ?? "").trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(candidate)) {
        derivedCityCode = candidate;
        break;
      }
    }

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
        Areas: typedAreaRows
          .map((a) => ({ Area: String(a.area || "").trim() }))
          .filter((a) => a.Area),
        CityCode: derivedCityCode,
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
  // Optional. When provided, every new provider_areas row stamps this
  // city. When absent (old clients), falls back to getDefaultCityCode —
  // preserves Phase 1.2's behavior unchanged.
  cityCode?: string;
  // Optional. When supplied, used for region_change diff/log instead of
  // attempting to reverse-derive from the expanded areas list. Old
  // clients (admin tab, e2e mocks) that don't send it skip the
  // region_change log entry — safest default for a payload field that
  // didn't exist before.
  selectedRegionCodes?: string[];
  // Who initiated the change. Determines the `changed_by` column in
  // any provider_change_log rows written here. Defaults to 'self'
  // (provider self-edit via /provider/register?edit=…).
  changedBy?: "self" | "admin" | "system";
};

// Sorted, deduped, lowercased — stable shape for diffing two sets.
function normalizeSetForDiff(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = String(v ?? "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.sort();
}

function setsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export async function updateProviderInSupabase(
  input: UpdateProviderInput
): Promise<{ success: boolean }> {
  const {
    id,
    name,
    phone,
    categories,
    areas,
    cityCode,
    selectedRegionCodes,
    changedBy,
  } = input;

  // ── Snapshot previous state for change-log diffing ────────────────
  // Read BEFORE the delete-then-insert overwrites it. Failures here are
  // non-fatal — diff falls through to "no change logged" so the save
  // still goes through. The monthly-limit enforcement happens at the
  // route layer, not here.
  let previousCategories: string[] = [];
  let previousRegionCodes: string[] = [];
  try {
    const [{ data: prevServices }, { data: prevAreas }] = await Promise.all([
      adminSupabase
        .from("provider_services")
        .select("category")
        .eq("provider_id", id),
      adminSupabase
        .from("provider_areas")
        .select("area, city_code")
        .eq("provider_id", id),
    ]);
    previousCategories = normalizeSetForDiff(
      ((prevServices ?? []) as Array<{ category: string | null }>)
        .map((s) => String(s.category ?? ""))
        .filter(Boolean)
    );
    // Reverse-derive previous region codes from the old areas list by
    // joining through service_region_areas. Same overlap rule
    // computeRegionDerivedCoverage uses; bounded to active rows.
    const prevAreaList = ((prevAreas ?? []) as Array<{
      area: string | null;
      city_code: string | null;
    }>).map((a) => String(a.area ?? "").trim()).filter(Boolean);
    if (prevAreaList.length > 0) {
      // Pick a city to scope the join — prefer the provider's stored
      // city_code, fall back to the caller's supplied cityCode, then
      // to no filter (legacy).
      const prevCity =
        ((prevAreas ?? []) as Array<{ city_code: string | null }>).find(
          (r) => /^[A-Z]{3}$/.test(String(r.city_code ?? "").trim().toUpperCase())
        )?.city_code ?? cityCode ?? "";
      const sraQ = adminSupabase
        .from("service_region_areas")
        .select("canonical_area, region_code")
        .eq("active", true)
        .limit(10000);
      if (prevCity) sraQ.eq("city_code", prevCity);
      const { data: sraRows } = await sraQ;
      const keyToRegion = new Map<string, string>();
      for (const r of (sraRows ?? []) as Array<{
        canonical_area: string | null;
        region_code: string | null;
      }>) {
        const k = String(r.canonical_area ?? "").trim().toLowerCase();
        const rc = String(r.region_code ?? "").trim();
        if (k && rc) keyToRegion.set(k, rc);
      }
      const derived = new Set<string>();
      for (const a of prevAreaList) {
        const rc = keyToRegion.get(a.trim().toLowerCase());
        if (rc) derived.add(rc);
      }
      previousRegionCodes = Array.from(derived).sort();
    }
  } catch {
    // Best-effort. Continue without diff data; no log entries written.
  }

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
    // Phase 1.2 + cascade: caller (UI cascade) supplies cityCode when the
    // provider explicitly picked a city. Old clients that don't send it
    // fall back to getDefaultCityCode — preserves the Phase 1.2 single-
    // city default. Either way every provider_areas row is stamped, so
    // the column is never NULL on a row we wrote.
    const resolvedCityCode = cityCode ?? (await getDefaultCityCode());
    const { error: insertAreasError } = await adminSupabase
      .from("provider_areas")
      .insert(
        areas.map((area) => ({ provider_id: id, area, city_code: resolvedCityCode }))
      );
    if (insertAreasError) return { success: false };
  }

  // ── Change-log inserts (best-effort) ───────────────────────────────
  // Log only when the relevant SET actually mutated. No-op saves don't
  // count against the monthly limit. Failures here are non-fatal — the
  // save already succeeded; missing a log row just means the limit
  // counter might be off by one for this provider this month. Acceptable
  // for MVP; the limit is enforced at the route layer BEFORE this
  // function is even called, so under-logging doesn't open a bypass.
  try {
    const newCategoriesNormalized = normalizeSetForDiff(categories);
    const newRegionCodesNormalized = Array.isArray(selectedRegionCodes)
      ? normalizeSetForDiff(selectedRegionCodes)
      : null; // caller didn't supply — skip region log

    const logRows: Array<{
      provider_id: string;
      change_type: "region_change" | "category_change";
      old_value: unknown;
      new_value: unknown;
      changed_by: "self" | "admin" | "system";
    }> = [];

    if (setsDiffer(previousCategories, newCategoriesNormalized)) {
      logRows.push({
        provider_id: id,
        change_type: "category_change",
        old_value: previousCategories,
        new_value: newCategoriesNormalized,
        changed_by: changedBy ?? "self",
      });
    }
    if (
      newRegionCodesNormalized !== null &&
      setsDiffer(previousRegionCodes, newRegionCodesNormalized)
    ) {
      logRows.push({
        provider_id: id,
        change_type: "region_change",
        old_value: previousRegionCodes,
        new_value: newRegionCodesNormalized,
        changed_by: changedBy ?? "self",
      });
    }

    if (logRows.length > 0) {
      await adminSupabase.from("provider_change_log").insert(logRows);
    }
  } catch {
    // Swallow: change-log is observability, not the source of truth.
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Duplicate-name review queue
// ---------------------------------------------------------------------------

export type DuplicateNameReviewRow = {
  ProviderID: string;
  FullName: string;
  Phone: string;
  Status: string;
  Verified: string;
  CreatedAt: string;
  DuplicateNameReviewStatus: string;
  DuplicateNameFlaggedAt: string;
  MatchedProviders: Array<{
    ProviderID: string;
    FullName: string;
    Phone: string;
  }>;
};

export async function listDuplicateNameReviews(): Promise<DuplicateNameReviewRow[]> {
  const { data: flaggedRows, error: flaggedError } = await adminSupabase
    .from("providers")
    .select(
      "provider_id, full_name, phone, status, verified, created_at, duplicate_name_review_status, duplicate_name_matches, duplicate_name_flagged_at"
    )
    .eq("duplicate_name_review_status", "pending")
    .order("duplicate_name_flagged_at", { ascending: false });

  if (flaggedError || !Array.isArray(flaggedRows) || flaggedRows.length === 0) {
    return [];
  }

  const matchIdSet = new Set<string>();
  for (const row of flaggedRows) {
    const ids = Array.isArray(row.duplicate_name_matches) ? row.duplicate_name_matches : [];
    for (const id of ids) {
      const trimmed = String(id || "").trim();
      if (trimmed) matchIdSet.add(trimmed);
    }
  }

  const matchIds = Array.from(matchIdSet);
  let matchIndex = new Map<string, { full_name: string; phone: string }>();
  if (matchIds.length > 0) {
    const { data: matchRows } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .in("provider_id", matchIds);
    if (Array.isArray(matchRows)) {
      matchIndex = new Map(
        matchRows.map((m) => [
          String(m.provider_id || ""),
          {
            full_name: String(m.full_name || ""),
            phone: String(m.phone || ""),
          },
        ])
      );
    }
  }

  return flaggedRows.map((row) => {
    const ids = Array.isArray(row.duplicate_name_matches) ? row.duplicate_name_matches : [];
    const matched = ids
      .map((id: unknown) => String(id || "").trim())
      .filter(Boolean)
      .map((id: string) => {
        const info = matchIndex.get(id);
        return {
          ProviderID: id,
          FullName: info ? info.full_name : "",
          Phone: info ? info.phone : "",
        };
      });

    return {
      ProviderID: String(row.provider_id || ""),
      FullName: String(row.full_name || ""),
      Phone: String(row.phone || ""),
      Status: String(row.status || ""),
      Verified: String(row.verified || ""),
      CreatedAt: String(row.created_at || ""),
      DuplicateNameReviewStatus: String(row.duplicate_name_review_status || ""),
      DuplicateNameFlaggedAt: String(row.duplicate_name_flagged_at || ""),
      MatchedProviders: matched,
    };
  });
}
