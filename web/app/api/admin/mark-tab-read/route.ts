import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { markAdminTabRead } from "@/lib/admin/adminReadMarkers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/admin/mark-tab-read
//
// Body: { tabKey: "reports" | "chats" | "kaam" | "category" | "users" }
//
// Records "this admin has now read this tab" by upserting
// admin_read_markers(admin_phone, tab_key, last_read_at=now). The
// dashboard calls this each time an accordion transitions
// closed → open, which is the moment we treat as a read event.
//
// Auth: gated by requireAdminSession. Non-admin callers receive 401.

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  const tabKey = String(body.tabKey ?? body.tab ?? "").trim().toLowerCase();
  if (!tabKey) {
    return NextResponse.json(
      { ok: false, error: "MISSING_TAB_KEY" },
      { status: 400 }
    );
  }

  const result = await markAdminTabRead(auth.admin.phone, tabKey);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { ok: true, tabKey: result.tabKey, lastReadAt: result.lastReadAt },
    { status: 200 }
  );
}
