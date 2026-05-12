import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Provider drilldown for the admin Providers tab category breakdown.
//
// Mirrors provider-stats/by-category's normalization so the providers
// surfaced here are exactly the ones that contribute to a given row's
// count. The route is intentionally narrow: a single category at a time,
// lazy-loaded when the admin clicks a row.
//
// Query params:
//   - category   (required) display name (approved mode) or raw category
//                string (unmapped mode).
//   - verified=1 restrict to providers whose normalized last-10-digit
//                phone matches a profiles row with last_login_at within
//                the last 30 days. Same rule as provider-stats/by-category.
//   - unmapped=1 return providers whose provider_services.category does
//                NOT resolve to an active categories.name (raw category
//                drilldown for Unmapped Provider Categories).
//
// Sources:
//   - providers                     : provider_id, full_name, phone, verified, status
//   - profiles                      : phone (verified mode gate, last 30 days)
//   - provider_services             : provider_id, category
//   - provider_areas                : provider_id, area
//   - categories                    : name, active (mapped vs. unmapped gate)
//   - service_regions               : region_code, region_name (active gate)
//   - service_region_areas          : canonical_area, region_code (active gate)
//   - service_region_area_aliases   : alias, region_code (active gate)
//
// Region resolution mirrors `admin/areas/route.ts` exactly so a provider's
// drilldown regions match what the Areas Management view would credit them
// to — same `toAreaKey` normalization (whitespace collapse, lowercase,
// strip non-alphanumerics), same canonical-OR-alias union rule. The
// response is backward-compatible: every provider still carries an
// `areas` array; the new `regions` array is additive.

const VERIFIED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const IN_CHUNK = 500;

type FilterFn = (q: unknown) => unknown;

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// Same shape as admin/areas/route.ts so a provider's regions surface
// identically here and in Areas Management.
function toAreaKey(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function fetchAllRows<T>(
  table: string,
  selectCols: string,
  applyFilter?: FilterFn
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = adminSupabase
      .from(table)
      .select(selectCols)
      .range(from, from + PAGE_SIZE - 1);
    if (applyFilter) query = applyFilter(query) as typeof query;
    const { data, error } = await query;
    if (error) throw new Error(`${table} page ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchByIdsChunked<T>(
  table: string,
  selectCols: string,
  column: string,
  values: string[]
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK);
    const { data, error } = await adminSupabase
      .from(table)
      .select(selectCols)
      .in(column, chunk);
    if (error) throw new Error(`${table} chunk ${i}: ${error.message}`);
    if (data) all.push(...(data as T[]));
  }
  return all;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const verifiedOnly = url.searchParams.get("verified") === "1";
  const unmappedMode = url.searchParams.get("unmapped") === "1";
  const requestedCategory = String(url.searchParams.get("category") ?? "").trim();

  if (!requestedCategory) {
    return NextResponse.json(
      { ok: false, error: "category is required" },
      { status: 400 }
    );
  }
  const requestedKey = normalizeCategoryKey(requestedCategory);

  try {
    // ─── Step 1: target provider ID set ──────────────────────────────────
    const targetProviderIds = new Set<string>();
    if (verifiedOnly) {
      const thirtyDaysAgoIso = new Date(
        Date.now() - VERIFIED_WINDOW_MS
      ).toISOString();
      const [providers, recentProfiles] = await Promise.all([
        fetchAllRows<{ provider_id: string | null; phone: string | null }>(
          "providers",
          "provider_id, phone"
        ),
        fetchAllRows<{ phone: string | null }>(
          "profiles",
          "phone",
          (q) =>
            (q as { gte: (col: string, val: string) => unknown }).gte(
              "last_login_at",
              thirtyDaysAgoIso
            )
        ),
      ]);
      const recentPhones = new Set<string>();
      for (const profile of recentProfiles) {
        const phone = normalizePhone(profile.phone);
        if (phone.length === 10) recentPhones.add(phone);
      }
      for (const provider of providers) {
        const phone = normalizePhone(provider.phone);
        if (phone && recentPhones.has(phone)) {
          const id = String(provider.provider_id ?? "").trim();
          if (id) targetProviderIds.add(id);
        }
      }
    } else {
      const providers = await fetchAllRows<{ provider_id: string | null }>(
        "providers",
        "provider_id"
      );
      for (const provider of providers) {
        const id = String(provider.provider_id ?? "").trim();
        if (id) targetProviderIds.add(id);
      }
    }

    // ─── Step 2: active category keys (mapped vs. unmapped gate) ─────────
    const categoryRows = await fetchAllRows<{
      name: string | null;
      active: boolean | string | null;
    }>("categories", "name, active", (q) =>
      (q as { eq: (col: string, val: boolean) => unknown }).eq("active", true)
    );
    const activeCategoryKeys = new Set<string>();
    for (const row of categoryRows) {
      const key = normalizeCategoryKey(row.name);
      if (key) activeCategoryKeys.add(key);
    }

    // In approved mode the requested category must resolve to an active
    // category — otherwise we'd be returning rows for a stale chip.
    if (!unmappedMode && !activeCategoryKeys.has(requestedKey)) {
      return NextResponse.json({
        ok: true,
        data: { category: requestedCategory, providers: [] },
      });
    }

    // ─── Step 3: provider_services rows whose normalized category matches
    const serviceRows = await fetchAllRows<{
      provider_id: string | null;
      category: string | null;
    }>("provider_services", "provider_id, category");

    const matchedProviderIds = new Set<string>();
    for (const row of serviceRows) {
      const providerId = String(row.provider_id ?? "").trim();
      if (!providerId || !targetProviderIds.has(providerId)) continue;
      const rowKey = normalizeCategoryKey(row.category);
      if (!rowKey || rowKey !== requestedKey) continue;
      if (unmappedMode) {
        // Unmapped drilldown — only rows whose category does NOT map to
        // an active category. A row that happens to share a normalized
        // key with an active category is "mapped" and belongs in the
        // approved breakdown instead.
        if (activeCategoryKeys.has(rowKey)) continue;
      } else {
        // Approved drilldown — row must be an active category. Already
        // gated above, but double-check here defensively.
        if (!activeCategoryKeys.has(rowKey)) continue;
      }
      matchedProviderIds.add(providerId);
    }

    const providerIdList = Array.from(matchedProviderIds);
    if (providerIdList.length === 0) {
      return NextResponse.json({
        ok: true,
        data: { category: requestedCategory, providers: [] },
      });
    }

    // ─── Step 4: provider details + areas + region map ───────────────────
    const [
      providerRows,
      areaRows,
      regionRows,
      regionAreaRows,
      regionAliasRows,
    ] = await Promise.all([
      fetchByIdsChunked<{
        provider_id: string | null;
        full_name: string | null;
        phone: string | null;
        verified: string | null;
        status: string | null;
      }>(
        "providers",
        "provider_id, full_name, phone, verified, status",
        "provider_id",
        providerIdList
      ),
      fetchByIdsChunked<{
        provider_id: string | null;
        area: string | null;
      }>("provider_areas", "provider_id, area", "provider_id", providerIdList),
      fetchAllRows<{
        region_code: string | null;
        region_name: string | null;
      }>("service_regions", "region_code, region_name", (q) =>
        (q as { eq: (col: string, val: boolean) => unknown }).eq("active", true)
      ),
      fetchAllRows<{
        canonical_area: string | null;
        region_code: string | null;
      }>(
        "service_region_areas",
        "canonical_area, region_code",
        (q) =>
          (q as { eq: (col: string, val: boolean) => unknown }).eq("active", true)
      ),
      fetchAllRows<{
        alias: string | null;
        region_code: string | null;
      }>("service_region_area_aliases", "alias, region_code", (q) =>
        (q as { eq: (col: string, val: boolean) => unknown }).eq("active", true)
      ),
    ]);

    // region_code → compact display label "<code> - <name>". The UI
    // renders this verbatim so it stays in sync with whatever code+name
    // mapping admins have configured in service_regions. If the name
    // column is missing (legacy rows), we fall back to the code alone.
    const regionLabelByCode = new Map<string, string>();
    for (const row of regionRows) {
      const code = String(row.region_code ?? "").trim();
      if (!code) continue;
      const name = String(row.region_name ?? "").trim();
      regionLabelByCode.set(code, name ? `${code} - ${name}` : code);
    }

    // Normalized-area-key → Set<region_code>. Same canonical-OR-alias
    // union as admin/areas/route.ts. Both sides credit the same region;
    // a key present in both maps unions the region sets.
    const regionsByAreaKey = new Map<string, Set<string>>();
    const addAreaKeyMapping = (key: string, code: string) => {
      if (!key || !code) return;
      const set = regionsByAreaKey.get(key) ?? new Set<string>();
      set.add(code);
      regionsByAreaKey.set(key, set);
    };
    for (const row of regionAreaRows) {
      addAreaKeyMapping(toAreaKey(row.canonical_area), String(row.region_code ?? "").trim());
    }
    for (const row of regionAliasRows) {
      addAreaKeyMapping(toAreaKey(row.alias), String(row.region_code ?? "").trim());
    }

    const areasByProviderId = new Map<string, string[]>();
    const regionCodesByProviderId = new Map<string, Set<string>>();
    for (const row of areaRows) {
      const id = String(row.provider_id ?? "").trim();
      const area = String(row.area ?? "").trim();
      if (!id || !area) continue;
      const list = areasByProviderId.get(id) ?? [];
      if (!list.includes(area)) list.push(area);
      areasByProviderId.set(id, list);
      const codes = regionsByAreaKey.get(toAreaKey(area));
      if (codes && codes.size > 0) {
        const seen = regionCodesByProviderId.get(id) ?? new Set<string>();
        for (const code of codes) seen.add(code);
        regionCodesByProviderId.set(id, seen);
      }
    }

    const providers = providerRows
      .map((row) => {
        const id = String(row.provider_id ?? "").trim();
        const regionCodes = regionCodesByProviderId.get(id);
        const regions = regionCodes
          ? Array.from(regionCodes)
              .map((code) => regionLabelByCode.get(code))
              .filter((label): label is string => Boolean(label))
              .sort((a, b) => a.localeCompare(b))
          : [];
        return {
          providerId: id,
          name: String(row.full_name ?? "").trim(),
          phone: String(row.phone ?? "").trim(),
          verified: String(row.verified ?? "").trim(),
          status: String(row.status ?? "").trim(),
          regions,
          areas: (areasByProviderId.get(id) ?? []).slice().sort((a, b) =>
            a.localeCompare(b)
          ),
        };
      })
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return a.providerId.localeCompare(b.providerId);
      });

    return NextResponse.json({
      ok: true,
      data: { category: requestedCategory, providers },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
