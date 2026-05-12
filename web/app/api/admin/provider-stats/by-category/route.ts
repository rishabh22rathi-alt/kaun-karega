import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Per-category provider counts for the admin Providers tab.
//
// Modes (controlled by ?verified=1):
//   - Default      → counts every provider in providers table.
//   - verified=1   → counts only providers whose normalized last-10-digit
//                    phone matches a profiles row with last_login_at within
//                    the last 30 days. Admin approval is NOT a gate.
//
// Sources:
//   - providers           : provider_id (+ phone in verified mode)
//   - profiles            : phone WHERE last_login_at >= 30 days ago (verified mode only)
//   - provider_services   : provider_id, category   (one row per category claim)
//
// Sub-tag (alias) breakdown is intentionally NOT computed here. The
// provider_work_terms table is only populated for self-registered providers
// that tap chips on the dashboard, and is empty for all imported providers
// (see the audit that found no sub-tag column in the upstream Sheets
// pipeline). Re-add the work_terms aggregation here once that data is
// backfilled, and surface a children[] field on each row.
//
// All queries paginate via .range() to bypass Supabase's default 1000-row
// cap. (provider_id, category) composites are deduplicated before counting.

const VERIFIED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

type FilterFn = (q: unknown) => unknown;

type ActiveCategory = {
  displayName: string;
  suggestionKey: string;
};

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSuggestionKey(value: unknown): string {
  return normalizeCategoryKey(value).replace(/\s+/g, " ");
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

function getSuggestedCategory(
  rawCategory: string,
  activeCategories: Map<string, ActiveCategory>
): string {
  const rawSuggestionKey = normalizeSuggestionKey(rawCategory);
  if (!rawSuggestionKey) return "";

  for (const active of activeCategories.values()) {
    if (active.suggestionKey === rawSuggestionKey) return active.displayName;
  }

  return "";
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const verifiedOnly = url.searchParams.get("verified") === "1";

  try {
    // ─── Step 1: build target provider ID set ────────────────────────────
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

    // ─── Step 2: per-category counts via provider_services ───────────────
    const categoryRows = await fetchAllRows<{
      name: string | null;
      active: boolean | string | null;
    }>("categories", "name, active", (q) =>
      (q as { eq: (col: string, val: boolean) => unknown }).eq("active", true)
    );

    const activeCategories = new Map<string, ActiveCategory>();
    for (const row of categoryRows) {
      const displayName = String(row.name ?? "").trim();
      const key = normalizeCategoryKey(displayName);
      if (!displayName || !key || activeCategories.has(key)) continue;
      activeCategories.set(key, {
        displayName,
        suggestionKey: normalizeSuggestionKey(displayName),
      });
    }

    const seenCategoryKeys = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const unmappedProviderIdsByRawCategory = new Map<string, Set<string>>();
    const serviceRows = await fetchAllRows<{
      provider_id: string | null;
      category: string | null;
    }>("provider_services", "provider_id, category");
    for (const row of serviceRows) {
      const providerId = String(row.provider_id ?? "").trim();
      const category = String(row.category ?? "").trim();
      if (!providerId || !category) continue;
      if (!targetProviderIds.has(providerId)) continue;
      const categoryKey = normalizeCategoryKey(category);
      const activeCategory = activeCategories.get(categoryKey);
      if (!activeCategory) {
        const rawProviderIds =
          unmappedProviderIdsByRawCategory.get(category) ?? new Set<string>();
        rawProviderIds.add(providerId);
        unmappedProviderIdsByRawCategory.set(category, rawProviderIds);
        continue;
      }
      const key = `${providerId}::${categoryKey}`;
      if (seenCategoryKeys.has(key)) continue;
      seenCategoryKeys.add(key);
      categoryCounts.set(
        activeCategory.displayName,
        (categoryCounts.get(activeCategory.displayName) ?? 0) + 1
      );
    }

    const byCategory = Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort(
        (a, b) =>
          b.count - a.count || a.category.localeCompare(b.category)
      );

    const unmappedCategories = Array.from(
      unmappedProviderIdsByRawCategory.entries()
    )
      .map(([category, providerIds]) => ({
        category,
        count: providerIds.size,
        suggestedCategory: getSuggestedCategory(category, activeCategories),
      }))
      .sort(
        (a, b) =>
          b.count - a.count || a.category.localeCompare(b.category)
      );

    return NextResponse.json({
      ok: true,
      data: { byCategory, unmappedCategories },
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
