import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/admin/notifications/mark-read
//
// Body shape: { id?: string, all?: boolean }
//   - id provided → mark that single notification as read.
//   - all=true   → mark every currently-unread notification as read.
//   - both       → 400; ambiguous.
//   - neither    → 400; nothing to do.
//
// Admin-only. Writes only to admin_notifications.read_at; never
// touches any other table.

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { id?: unknown; all?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; all?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const all = body.all === true;

  if (id && all) {
    return NextResponse.json(
      {
        success: false,
        error: "Pass either `id` or `all=true`, not both",
      },
      { status: 400 }
    );
  }
  if (!id && !all) {
    return NextResponse.json(
      { success: false, error: "`id` or `all=true` is required" },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();

  if (id) {
    const { error } = await adminSupabase
      .from("admin_notifications")
      .update({ read_at: nowIso })
      .eq("id", id)
      .is("read_at", null);
    if (error) {
      console.error(
        "[admin/notifications/mark-read] single update failed:",
        error
      );
      return NextResponse.json(
        { success: false, error: "Failed to mark notification read" },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, id });
  }

  // all=true — bulk update everything unread. .is("read_at", null) is
  // the only filter so already-read rows aren't touched (preserves
  // their original read_at timestamp).
  const { error: bulkError } = await adminSupabase
    .from("admin_notifications")
    .update({ read_at: nowIso })
    .is("read_at", null);
  if (bulkError) {
    console.error(
      "[admin/notifications/mark-read] bulk update failed:",
      bulkError
    );
    return NextResponse.json(
      { success: false, error: "Failed to mark all read" },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, all: true });
}
