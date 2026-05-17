import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  queueAnnouncement,
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
    // Phase 7C Step 6: per-audience pre-queue validation failures.
    case "TARGET_CATEGORY_REQUIRED":
    case "TARGET_CATEGORY_INACTIVE":
    case "RECIPIENT_LIMIT_EXCEEDED":
      return 400;
    case "DB_ERROR":
    default:
      return 500;
  }
}

// POST /api/admin/announcements/[id]/queue
//
// Transitions approved → queued and creates a job row in
// admin_announcement_jobs. Phase 7C unlocks 'admins' AND
// 'provider_category' here at the store layer; the worker re-checks
// the same allow-list (defense in depth). 'providers_all' remains
// blocked at BOTH layers.
//
// Additional Phase 7C gates (provider_category only):
//   • target_category must still resolve to an active categories row
//     (.ilike + active=true) — TARGET_CATEGORY_INACTIVE if not.
//   • Recipient count must not exceed
//     ANNOUNCEMENT_PHASE_7C_MAX_RECIPIENTS_CATEGORY (default 5) —
//     RECIPIENT_LIMIT_EXCEEDED if it does.
//
// No FCM is fired from this route — the worker tick is the only
// surface that talks to FCM. This route is safe to call repeatedly;
// the unique(announcement_id) constraint on admin_announcement_jobs
// makes it idempotent against double-clicks.

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;
  const result = await queueAnnouncement(id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({
    ok: true,
    announcement: result.value.announcement,
    jobCreated: result.value.jobCreated,
  });
}
