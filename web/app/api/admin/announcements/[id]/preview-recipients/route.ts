import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  getAnnouncementById,
  previewRecipients,
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

// GET /api/admin/announcements/[id]/preview-recipients
//
// Returns COUNTS ONLY. The response shape never includes tokens,
// phones, provider_ids, or any other identifying data — admins
// previewing a broadcast must not be able to enumerate recipients
// through this surface. The store helper is the single place that
// enforces this; auditing this file should confirm only `summary`
// and `by_actor` counts appear in the response body.

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;

  const announcement = await getAnnouncementById(id);
  if (!announcement.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: announcement.error.code,
        message: announcement.error.message,
      },
      { status: errorStatus(announcement.error.code) }
    );
  }

  const preview = await previewRecipients(announcement.value.target_audience);
  if (!preview.ok) {
    return NextResponse.json(
      { ok: false, error: preview.error.code, message: preview.error.message },
      { status: errorStatus(preview.error.code) }
    );
  }

  return NextResponse.json({
    ok: true,
    preview: {
      audience: preview.value.audience,
      total: preview.value.total,
      by_actor: preview.value.by_actor,
    },
  });
}
