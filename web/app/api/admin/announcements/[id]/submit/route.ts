import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  submitAnnouncement,
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

// POST /api/admin/announcements/[id]/submit
//
// Transitions a draft announcement.
//   approval_required = false → status='approved' immediately
//   approval_required = true  → status='pending_approval'
//
// Phase 7A default is approval_required=false (strategic MVP), so
// submits land at 'approved' without a second admin. Phase 7B+ may
// flip the per-row default; the store + DB trigger already enforce
// creator≠approver when approval is required.

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
  const result = await submitAnnouncement(id, phone);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({ ok: true, announcement: result.value });
}
