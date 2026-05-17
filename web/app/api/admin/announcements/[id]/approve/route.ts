import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  approveAnnouncement,
  type StoreError,
} from "@/lib/announcements/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

function errorStatus(code: StoreError["code"]): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_INPUT":
    case "INVALID_TRANSITION":
    case "APPROVAL_SELF":
      return 400;
    case "DB_ERROR":
    default:
      return 500;
  }
}

// POST /api/admin/announcements/[id]/approve
//
// Transitions pending_approval → approved. When approval_required=true
// the store + DB trigger both enforce creator≠approver; this route
// surfaces APPROVAL_SELF as a 400. Phase 7A default approval_required
// is false, so pending_approval rows are rare today, but the route is
// in place for the Phase 7B+ flip without an API migration.

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;
  const phone = String(auth.admin.phone || "").trim();
  const result = await approveAnnouncement(id, phone);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({ ok: true, announcement: result.value });
}
