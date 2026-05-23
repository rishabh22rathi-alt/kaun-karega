import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  readThroughSnapshotCache,
  type CacheMetadata,
} from "@/lib/admin/snapshotCache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Snapshot cache: this list rarely changes minute-to-minute and the
// computation is heavy (profile scan + chunked tasks fan-out).
// 6-hour TTL; ?refresh=1 bypasses.
const CACHE_KEY = "users.admin";
const CACHE_TTL_SECONDS = 6 * 60 * 60;

type UsersPayload = {
  totalUsers: number;
  users: Array<{
    phone: string;
    name: string | null;
    created_at: string | null;
    totalRequests: number;
    latestRequestAt: string | null;
  }>;
};

// GET /api/admin/users
//
// Powers the "Users" accordion on /admin/dashboard. Returns:
//   - totalUsers: exact count of profiles with role='user' and is_active=true.
//     Mirrors the count source already used by getRegisteredUsersCount()
//     in lib/admin/adminDashboardStats.ts (the "Registered Users" tile).
//   - users: up to 500 most-recently-active users, each annotated with how
//     many tasks they've generated and when the latest one landed.
//
// Phone normalisation:
//   profiles.phone is stored in BOTH 10-digit and 12-digit ("91XXXXXXXXXX")
//   forms depending on which OTP-verify route wrote it (see precedent in
//   web/app/api/my-requests/route.ts and web/app/api/user/disclaimer/route.ts).
//   tasks.phone is always the 10-digit form (web/app/api/submit-request/route.ts
//   strips the 91 prefix via normalizePhone10 before insert). We bucket both
//   sides by last-10 digits to join correctly across the two stores.

const USERS_LIMIT = 500;

type ProfileRow = {
  phone: string | null;
  // Optional — populated only if the columns exist on the profiles row. We
  // fall back to last_login_at for ordering when created_at is missing.
  created_at?: string | null;
  name?: string | null;
  full_name?: string | null;
  last_login_at?: string | null;
};

type TaskAggregateRow = {
  phone: string | null;
  created_at: string | null;
};

function normalizePhone10(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function pickName(row: ProfileRow): string | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (name) return name;
  const full = typeof row.full_name === "string" ? row.full_name.trim() : "";
  if (full) return full;
  return null;
}

function pickCreatedAt(row: ProfileRow): string | null {
  const created = typeof row.created_at === "string" ? row.created_at.trim() : "";
  if (created) return created;
  const last = typeof row.last_login_at === "string" ? row.last_login_at.trim() : "";
  return last || null;
}

async function computeUsersPayload(): Promise<UsersPayload> {
  // Count: exact, head-only — unaffected by the 1000-row default range.
  const countRes = await adminSupabase
    .from("profiles")
    .select("phone", { count: "exact", head: true })
    .eq("role", "user")
    .eq("is_active", true);

  if (countRes.error) {
    console.error("[admin/users] profiles count error:", countRes.error);
    throw new Error("Failed to count users");
  }
  const totalUsers = Number(countRes.count ?? 0);

  // Pull the user-role profile rows. select("*") so we tolerate either
  // schema shape — `created_at` / `name` / `full_name` columns may or may
  // not exist; pickName() / pickCreatedAt() degrade gracefully.
  const profilesRes = await adminSupabase
    .from("profiles")
    .select("*")
    .eq("role", "user")
    .eq("is_active", true)
    .limit(USERS_LIMIT);

  if (profilesRes.error) {
    console.error("[admin/users] profiles fetch error:", profilesRes.error);
    throw new Error("Failed to fetch users");
  }

  const profileRows = (profilesRes.data ?? []) as ProfileRow[];

  // Deduplicate by last-10-digits because profiles can carry both formats
  // for the same human. Keep the freshest row per phone10 (whichever has
  // the most recent last_login_at, then created_at).
  type UserAccum = {
    phone10: string;
    displayPhone: string;
    name: string | null;
    createdAt: string | null;
    lastLoginAt: string | null;
  };
  const byPhone10 = new Map<string, UserAccum>();
  for (const row of profileRows) {
    const phone10 = normalizePhone10(row.phone);
    if (!phone10) continue;
    const incoming: UserAccum = {
      phone10,
      displayPhone: phone10,
      name: pickName(row),
      createdAt: pickCreatedAt(row),
      lastLoginAt:
        typeof row.last_login_at === "string" ? row.last_login_at : null,
    };
    const existing = byPhone10.get(phone10);
    if (!existing) {
      byPhone10.set(phone10, incoming);
      continue;
    }
    // Prefer the row with the more recent last_login_at; tie-break on
    // createdAt. Names / phones from the freshest row win.
    const existingKey = String(existing.lastLoginAt ?? existing.createdAt ?? "");
    const incomingKey = String(incoming.lastLoginAt ?? incoming.createdAt ?? "");
    if (incomingKey > existingKey) {
      byPhone10.set(phone10, {
        ...incoming,
        // Keep an earlier name if the freshest row is anonymous.
        name: incoming.name ?? existing.name,
      });
    } else if (!existing.name && incoming.name) {
      byPhone10.set(phone10, { ...existing, name: incoming.name });
    }
  }

  const phone10s = Array.from(byPhone10.keys());

  // Aggregate task counts per phone10. tasks.phone is always 10 digits
  // (submit-request normalises before insert), so a direct `in` filter is
  // sufficient. We pull (phone, created_at) and reduce client-side rather
  // than introducing a new RPC.
  const taskCountByPhone10 = new Map<string, number>();
  const latestTaskByPhone10 = new Map<string, string>();

  if (phone10s.length > 0) {
    // Supabase caps `in` lists; chunk defensively to stay well under the
    // server-side URL length limit (HTTP 414 risk past a few thousand chars).
    const CHUNK = 200;
    for (let i = 0; i < phone10s.length; i += CHUNK) {
      const chunk = phone10s.slice(i, i + CHUNK);
      const tasksRes = await adminSupabase
        .from("tasks")
        .select("phone, created_at")
        .in("phone", chunk);

      if (tasksRes.error) {
        console.error("[admin/users] tasks fetch error:", tasksRes.error);
        throw new Error("Failed to fetch tasks");
      }
      for (const raw of (tasksRes.data ?? []) as TaskAggregateRow[]) {
        const p10 = normalizePhone10(raw.phone);
        if (!p10) continue;
        taskCountByPhone10.set(p10, (taskCountByPhone10.get(p10) ?? 0) + 1);
        const created = typeof raw.created_at === "string" ? raw.created_at : "";
        if (created) {
          const prev = latestTaskByPhone10.get(p10) ?? "";
          if (created > prev) latestTaskByPhone10.set(p10, created);
        }
      }
    }
  }

  const users = Array.from(byPhone10.values()).map((u) => ({
    phone: u.displayPhone,
    name: u.name,
    created_at: u.createdAt,
    totalRequests: taskCountByPhone10.get(u.phone10) ?? 0,
    latestRequestAt: latestTaskByPhone10.get(u.phone10) ?? null,
  }));

  // Sort: latestRequestAt desc (users with tasks come first, newest task
  // wins), then created_at desc as the tiebreaker for users with no tasks.
  users.sort((a, b) => {
    const aLatest = a.latestRequestAt ?? "";
    const bLatest = b.latestRequestAt ?? "";
    if (aLatest !== bLatest) return aLatest < bLatest ? 1 : -1;
    const aCreated = a.created_at ?? "";
    const bCreated = b.created_at ?? "";
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    return 0;
  });

  return { totalUsers, users };
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const forceRefresh =
    new URL(request.url).searchParams.get("refresh") === "1";

  let payload: UsersPayload;
  let cache: CacheMetadata;
  try {
    const result = await readThroughSnapshotCache<UsersPayload>({
      key: CACHE_KEY,
      ttlSeconds: CACHE_TTL_SECONDS,
      forceRefresh,
      adminPhone: auth.admin.phone,
      compute: computeUsersPayload,
    });
    payload = result.payload;
    cache = result.cache;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "compute failed",
      },
      { status: 500 }
    );
  }

  // Original response shape preserved (success/totalUsers/users top-level);
  // cache block is additive so existing clients ignore it cleanly.
  return NextResponse.json({
    success: true,
    totalUsers: payload.totalUsers,
    users: payload.users,
    cache,
  });
}
