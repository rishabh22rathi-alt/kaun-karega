import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/notifications
//
// Admin-only feed for the bell icon. Phase 1 — in-app only; mobile
// push lives in Phase 2.
//
// Read shape mirrors the bell dropdown's needs: a snapshot of the
// most recent notifications + the unread count for the badge. Schema
// per supabase/migrations/20260515120000_admin_notifications.sql.

const NOTIFICATIONS_LIMIT = 30;

type AdminNotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string | null;
  source: string | null;
  related_id: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normaliseSeverity(value: string | null): string {
  const v = String(value ?? "info").trim().toLowerCase();
  if (v === "critical" || v === "warning" || v === "info") return v;
  return "info";
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Two queries in parallel: the latest N rows for the dropdown, and
  // an exact head:true unread count for the badge. The list is capped
  // so the dropdown stays snappy; the count covers everything.
  const [listRes, unreadRes] = await Promise.all([
    adminSupabase
      .from("admin_notifications")
      .select(
        "id, type, title, message, severity, source, related_id, action_url, read_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(NOTIFICATIONS_LIMIT),
    adminSupabase
      .from("admin_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  if (listRes.error) {
    console.error(
      "[admin/notifications] list fetch failed:",
      listRes.error
    );
    return NextResponse.json(
      { success: false, error: "Failed to load notifications" },
      { status: 500 }
    );
  }
  if (unreadRes.error) {
    console.warn(
      "[admin/notifications] unread count failed (defaulting to 0):",
      unreadRes.error
    );
  }

  const rows = (listRes.data ?? []) as AdminNotificationRow[];
  const notifications = rows.map((row) => ({
    id: String(row.id),
    type: String(row.type ?? ""),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    severity: normaliseSeverity(row.severity),
    source: strOrNull(row.source),
    relatedId: strOrNull(row.related_id),
    actionUrl: strOrNull(row.action_url),
    readAt: strOrNull(row.read_at),
    createdAt: String(row.created_at ?? ""),
  }));

  return NextResponse.json({
    success: true,
    unreadCount: Number(unreadRes.count ?? 0),
    notifications,
  });
}
