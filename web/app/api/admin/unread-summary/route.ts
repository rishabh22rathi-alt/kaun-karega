import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { buildAdminUnreadSummary } from "@/lib/admin/adminReadMarkers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/unread-summary
//
// Returns per-tab { hasUnread, count, lastReadAt } for the calling
// admin. No row payloads, no sample data — just the boolean + count
// the dashboard needs to draw the unread dots.
//
// Auth: gated by requireAdminSession. Non-admin callers receive 401
// with no body content.

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const summary = await buildAdminUnreadSummary(auth.admin.phone);
    return NextResponse.json({ ok: true, unread: summary }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to build unread summary",
      },
      { status: 500 }
    );
  }
}
