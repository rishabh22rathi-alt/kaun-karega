import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Top-level provider tile counts for the Admin Providers tab.
//
// Total      Exact `providers` row count. Independent of category state —
//            archive/disable never deletes provider rows, so the tile
//            stays consistent with "providers we know about".
//
// Verified   Distinct providers that satisfy BOTH:
//              1. Phone intersection with profiles.last_login_at within
//                 the past 30 days (the original verified rule).
//              2. At least one provider_services row whose normalized
//                 category resolves to a currently-active categories row.
//
// The category gate was added to align this number with what the
// Verified Providers by Category breakdown displays — that breakdown
// only counts (provider, active_category) pairs, so an archived-only
// provider drops out of the breakdown. Without the same gate here the
// tile would over-report.
//
// All queries paginate via .range() to bypass Supabase's 1000-row cap.

const VERIFIED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

type FilterFn = (q: unknown) => unknown;

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
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

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 1. Exact total — uncapped, head-only count.
  const totalRes = await adminSupabase
    .from("providers")
    .select("provider_id", { count: "exact", head: true });
  if (totalRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: `providers count failed: ${totalRes.error.message}`,
      },
      { status: 500 }
    );
  }
  const total = Number(totalRes.count ?? 0);

  // 2. Pull every source needed for the verified intersection in one
  // round-trip. Same shapes as provider-stats/by-category so the two
  // routes always agree on the verified set.
  const thirtyDaysAgoIso = new Date(
    Date.now() - VERIFIED_WINDOW_MS
  ).toISOString();
  let providers: Array<{ provider_id: string | null; phone: string | null }>;
  let recentProfiles: Array<{ phone: string | null }>;
  let activeCategoryRows: Array<{ name: string | null }>;
  let serviceRows: Array<{
    provider_id: string | null;
    category: string | null;
  }>;
  try {
    [providers, recentProfiles, activeCategoryRows, serviceRows] =
      await Promise.all([
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
        fetchAllRows<{ name: string | null }>("categories", "name, active", (q) =>
          (q as { eq: (col: string, val: boolean) => unknown }).eq(
            "active",
            true
          )
        ),
        fetchAllRows<{
          provider_id: string | null;
          category: string | null;
        }>("provider_services", "provider_id, category"),
      ]);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "verified fetch failed",
      },
      { status: 500 }
    );
  }

  // Verified-by-phone provider IDs.
  const recentPhoneSet = new Set<string>();
  for (const profile of recentProfiles) {
    const phone = normalizePhone(profile.phone);
    if (phone.length === 10) recentPhoneSet.add(phone);
  }
  const verifiedByPhoneIds = new Set<string>();
  for (const provider of providers) {
    const phone = normalizePhone(provider.phone);
    if (!phone || !recentPhoneSet.has(phone)) continue;
    const id = String(provider.provider_id ?? "").trim();
    if (id) verifiedByPhoneIds.add(id);
  }

  // Provider IDs with at least one active-category service. Mirrors the
  // breakdown route's filter so the tile and the table stay in sync.
  const activeCategoryKeys = new Set<string>();
  for (const row of activeCategoryRows) {
    const key = normalizeCategoryKey(row.name);
    if (key) activeCategoryKeys.add(key);
  }
  const providersWithActiveServiceIds = new Set<string>();
  for (const row of serviceRows) {
    const id = String(row.provider_id ?? "").trim();
    if (!id) continue;
    const key = normalizeCategoryKey(row.category);
    if (!key || !activeCategoryKeys.has(key)) continue;
    providersWithActiveServiceIds.add(id);
  }

  let verified = 0;
  for (const id of verifiedByPhoneIds) {
    if (providersWithActiveServiceIds.has(id)) verified += 1;
  }

  return NextResponse.json({ ok: true, data: { total, verified } });
}
