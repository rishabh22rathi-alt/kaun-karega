import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  deleteAnnouncementDraft,
  getAnnouncementById,
  updateAnnouncementDraft,
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

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;
  const result = await getAnnouncementById(id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({ ok: true, announcement: result.value });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const result = await updateAnnouncementDraft(id, {
    title: body.title,
    body: body.body,
    target_audience: body.target_audience,
    target_category: body.target_category,
    deep_link: body.deep_link,
    // Phase 7D: banner fields. Re-validated against the effective
    // (audience, deep_link, banner_*) tuple inside the store.
    send_push: body.send_push,
    show_as_banner: body.show_as_banner,
    banner_priority: body.banner_priority,
    banner_starts_at: body.banner_starts_at,
    banner_expires_at: body.banner_expires_at,
    banner_dismissible: body.banner_dismissible,
    banner_cta_label: body.banner_cta_label,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({ ok: true, announcement: result.value });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const { id } = await context.params;
  const result = await deleteAnnouncementDraft(id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({ ok: true, id: result.value.id });
}
