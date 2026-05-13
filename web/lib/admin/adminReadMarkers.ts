import { adminSupabase } from "../supabase/admin";

/**
 * Admin dashboard "unread / new since last open" helpers.
 *
 * Storage table: `admin_read_markers` (see
 * docs/migrations/admin-read-markers.sql). One row per
 * (admin_phone, tab_key) recording when that admin last opened
 * that accordion. Reads compare the per-tab source-table
 * timestamps against last_read_at to produce a hasUnread / count
 * pair for each tab.
 *
 * Soft-degradation contract:
 *   The /api/admin/unread-summary and /api/admin/mark-tab-read
 *   endpoints MUST stay usable even if the migration has not yet
 *   been applied to the live database. Both helpers below catch
 *   the inevitable "relation does not exist" error and treat it
 *   as "no markers stored" — the UI just shows no badges and
 *   mark-read becomes a no-op until the table appears. That keeps
 *   the dashboard from regressing on environments where the
 *   migration is still pending.
 */

// Canonical list of tab keys the dashboard ships with today.
// Adding a new tab is a no-schema change: append the key here and
// add a sourceQuery to computeUnreadCounts.
export const ADMIN_TAB_KEYS = [
  "reports",
  "chats",
  "kaam",
  "category",
  "users",
] as const;
export type AdminTabKey = (typeof ADMIN_TAB_KEYS)[number];

// Generous epoch — used as a default last_read_at when an admin has
// never opened the tab. Choosing a fixed past timestamp (rather than
// `0`) keeps the comparator monotonically sane in Postgres.
const NEVER_READ_BASELINE_ISO = "1970-01-01T00:00:00.000Z";

export type AdminUnreadEntry = {
  hasUnread: boolean;
  count: number;
  lastReadAt: string;
};

export type AdminUnreadSummary = Record<AdminTabKey, AdminUnreadEntry>;

type MarkerRow = {
  tab_key: string | null;
  last_read_at: string | null;
};

function isMissingTableError(err: unknown): boolean {
  // PostgREST returns the underlying Postgres SQLSTATE "42P01" via the
  // `code` field on the error envelope. Match defensively on either
  // the code or the human-readable message so a Supabase client-side
  // wrapper change still triggers soft-degradation.
  if (!err || typeof err !== "object") return false;
  const code = String(
    (err as { code?: unknown }).code ?? ""
  ).toUpperCase();
  if (code === "42P01") return true;
  const message = String((err as { message?: unknown }).message ?? "")
    .toLowerCase();
  return (
    message.includes("admin_read_markers") &&
    (message.includes("does not exist") ||
      message.includes("not found") ||
      message.includes("schema cache"))
  );
}

async function loadMarkersForAdmin(
  adminPhone: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { data, error } = await adminSupabase
    .from("admin_read_markers")
    .select("tab_key, last_read_at")
    .eq("admin_phone", adminPhone)
    .limit(50);
  if (error) {
    if (!isMissingTableError(error)) {
      console.warn(
        "[adminReadMarkers] loadMarkers failed; treating as empty",
        error.message
      );
    }
    return out;
  }
  for (const row of (data ?? []) as MarkerRow[]) {
    const key = String(row.tab_key || "").trim();
    if (!key) continue;
    out[key] = String(row.last_read_at || NEVER_READ_BASELINE_ISO);
  }
  return out;
}

async function countNewRows(
  table: string,
  columns: string[],
  since: string
): Promise<number> {
  // Per-source "rows changed since X" probe. We don't pull row bodies —
  // only `head: true` so the response is a HEAD-style count. If the
  // column list returns no hits we return 0 silently (never surface
  // partial DB errors to the unread API caller).
  let best = 0;
  for (const col of columns) {
    const { count, error } = await adminSupabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .gt(col, since);
    if (error) {
      // Soft-fail the column probe but keep trying any later
      // candidate. Many source tables only carry a subset of the
      // probe columns (e.g. chat_threads has last_message_at but
      // not updated_at across all rows).
      continue;
    }
    if (typeof count === "number" && count > best) best = count;
  }
  return best;
}

async function computeReportsUnread(since: string): Promise<number> {
  // Source: issue_reports (user-submitted reports surface). Any row
  // whose created_at or updated_at is newer than the admin's
  // last-read counts as "new".
  return countNewRows("issue_reports", ["created_at", "updated_at"], since);
}

async function computeChatsUnread(since: string): Promise<number> {
  // Source: chat_threads.last_message_at + need_chat_threads.
  // last_message_at. We sum the two so the badge reflects activity
  // across both surfaces the Chats tab unions.
  const taskCount = await countNewRows(
    "chat_threads",
    ["last_message_at"],
    since
  );
  const needCount = await countNewRows(
    "need_chat_threads",
    ["last_message_at"],
    since
  );
  return taskCount + needCount;
}

async function computeKaamUnread(since: string): Promise<number> {
  // Source: tasks (one row per Kaam). New / updated tasks reflect
  // fresh activity the Kaam tab will surface on next open.
  return countNewRows("tasks", ["created_at", "updated_at"], since);
}

async function computeCategoryUnread(since: string): Promise<number> {
  // Source: pending_category_requests + pending alias submissions in
  // category_aliases (active=false). Both feed the Category tab's
  // Pending Admin Approval section, so either kind of new row
  // contributes to the badge.
  const pcr = await countNewRows(
    "pending_category_requests",
    ["created_at", "updated_at"],
    since
  );
  // Pending alias submissions ride on active=false rows; we count
  // those created since `since`. Inactive rows are pending by
  // construction so an `active=false` filter narrows the count
  // correctly.
  let aliasCount = 0;
  {
    const { count, error } = await adminSupabase
      .from("category_aliases")
      .select("*", { count: "exact", head: true })
      .eq("active", false)
      .gt("created_at", since);
    if (!error && typeof count === "number") aliasCount = count;
  }
  return pcr + aliasCount;
}

async function computeUsersUnread(since: string): Promise<number> {
  // Source: providers + users registration timestamps. We count both
  // because "Users" is a shorthand for "people that joined" on the
  // current admin dashboard layout. If the `users` table doesn't
  // exist on the live schema, countNewRows soft-skips it.
  const providerCount = await countNewRows(
    "providers",
    ["created_at", "updated_at"],
    since
  );
  const userCount = await countNewRows(
    "users",
    ["created_at", "updated_at"],
    since
  );
  return providerCount + userCount;
}

export async function buildAdminUnreadSummary(
  adminPhone: string
): Promise<AdminUnreadSummary> {
  const markers = await loadMarkersForAdmin(adminPhone);
  const sinceFor = (key: AdminTabKey): string =>
    markers[key] || NEVER_READ_BASELINE_ISO;

  const [reports, chats, kaam, category, users] = await Promise.all([
    computeReportsUnread(sinceFor("reports")),
    computeChatsUnread(sinceFor("chats")),
    computeKaamUnread(sinceFor("kaam")),
    computeCategoryUnread(sinceFor("category")),
    computeUsersUnread(sinceFor("users")),
  ]);

  const make = (count: number, key: AdminTabKey): AdminUnreadEntry => ({
    hasUnread: count > 0,
    count,
    lastReadAt: sinceFor(key),
  });

  return {
    reports: make(reports, "reports"),
    chats: make(chats, "chats"),
    kaam: make(kaam, "kaam"),
    category: make(category, "category"),
    users: make(users, "users"),
  };
}

export type MarkTabReadResult =
  | { ok: true; tabKey: AdminTabKey; lastReadAt: string }
  | { ok: false; error: string };

export async function markAdminTabRead(
  adminPhone: string,
  tabKey: string
): Promise<MarkTabReadResult> {
  const key = String(tabKey || "").trim().toLowerCase();
  if (!(ADMIN_TAB_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: "Invalid tabKey" };
  }
  const nowIso = new Date().toISOString();
  // Upsert: a marker row exists for this (admin_phone, tab_key) the
  // second time onwards. The unique constraint defined in the
  // migration is the conflict target.
  const { error } = await adminSupabase
    .from("admin_read_markers")
    .upsert(
      {
        admin_phone: adminPhone,
        tab_key: key,
        last_read_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "admin_phone,tab_key" }
    );
  if (error) {
    if (isMissingTableError(error)) {
      // Soft-fail when the migration hasn't been applied. The caller
      // still gets ok:true so the dashboard's optimistic UI doesn't
      // need a degraded code path; the badge simply won't disappear
      // across sessions until the table appears.
      return { ok: true, tabKey: key as AdminTabKey, lastReadAt: nowIso };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, tabKey: key as AdminTabKey, lastReadAt: nowIso };
}
