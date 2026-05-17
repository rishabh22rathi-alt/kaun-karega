import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  cancelAnnouncement,
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
    case "AUDIENCE_NOT_ALLOWED":
    case "ALREADY_QUEUED":
      return 400;
    case "DB_ERROR":
    default:
      return 500;
  }
}

// POST /api/admin/announcements/[id]/cancel
//
//   queued    → canceled (terminal; job → done)
//   sending   → canceling (worker observes between batches)
//   canceling → no-op (already canceling)
//   canceled  → no-op (already canceled)
//   anything else → 400 INVALID_TRANSITION
//
// In-flight FCM calls in the current batch cannot be recalled; the
// admin sees those messages land. This route only prevents further
// batches.

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;
  const result = await cancelAnnouncement(id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({
    ok: true,
    announcement: result.value.announcement,
    immediate: result.value.immediate,
  });
}
