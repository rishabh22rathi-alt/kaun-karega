import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Verified provider rule (admin spec):
//   - Provider phone matches a profiles row by normalized last 10 digits.
//   - profiles.last_login_at within the last 30 days.
//   - Admin approval is NOT a gate.
//
// Total = exact provider row count (count:"exact", head:true — uncapped).
// Verified = paginated phone intersection (Supabase REST default cap is
// 1000 rows per .select(), so we walk pages until a short page arrives).

const VERIFIED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

async function fetchAllPhones(
  table: "providers" | "profiles",
  applyFilter?: (
    query: ReturnType<typeof adminSupabase.from>["select"] extends (...args: never) => infer R
      ? R
      : never
  ) => unknown
): Promise<string[]> {
  const phones: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    // Build the page query. We only ever need the phone column.
    let query = adminSupabase
      .from(table)
      .select("phone")
      .range(from, from + PAGE_SIZE - 1);
    if (applyFilter) {
      // applyFilter returns the chained query; we re-cast to keep types loose.
      query = applyFilter(query as never) as typeof query;
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`${table} page ${from}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const raw = (row as { phone?: unknown }).phone;
      if (raw != null) phones.push(String(raw));
    }
    if (data.length < PAGE_SIZE) break;
  }
  return phones;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const thirtyDaysAgoIso = new Date(Date.now() - VERIFIED_WINDOW_MS).toISOString();

  // 1. Exact total — uncapped, head-only count.
  const totalRes = await adminSupabase
    .from("providers")
    .select("provider_id", { count: "exact", head: true });
  if (totalRes.error) {
    return NextResponse.json(
      { ok: false, error: `providers count failed: ${totalRes.error.message}` },
      { status: 500 }
    );
  }
  const total = Number(totalRes.count ?? 0);

  // 2. Verified intersection — paginate both sides, then intersect by
  // normalized last-10-digit phone.
  let providerPhones: string[];
  let recentProfilePhones: string[];
  try {
    [providerPhones, recentProfilePhones] = await Promise.all([
      fetchAllPhones("providers"),
      fetchAllPhones("profiles", (q) =>
        (q as { gte: (col: string, val: string) => unknown }).gte(
          "last_login_at",
          thirtyDaysAgoIso
        )
      ),
    ]);
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Phone fetch failed" },
      { status: 500 }
    );
  }

  const recentSet = new Set<string>();
  for (const raw of recentProfilePhones) {
    const phone = normalizePhone(raw);
    if (phone.length === 10) recentSet.add(phone);
  }

  let verified = 0;
  for (const raw of providerPhones) {
    const phone = normalizePhone(raw);
    if (phone && recentSet.has(phone)) verified += 1;
  }

  return NextResponse.json({ ok: true, data: { total, verified } });
}
