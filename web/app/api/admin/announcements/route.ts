import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  createAnnouncementDraft,
  listAnnouncements,
  type AnnouncementStatus,
  type StoreError,
} from "@/lib/announcements/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_VALUES: ReadonlySet<AnnouncementStatus> = new Set([
  "draft",
  "pending_approval",
  "approved",
  "queued",
  "sending",
  "canceling",
  "sent",
  "canceled",
  "failed",
]);

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

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status =
    rawStatus && STATUS_VALUES.has(rawStatus as AnnouncementStatus)
      ? (rawStatus as AnnouncementStatus)
      : null;
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, limitRaw) : 50;
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const result = await listAnnouncements({ status, limit, offset });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json({ ok: true, announcements: result.value });
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const result = await createAnnouncementDraft({
    title: body.title,
    body: body.body,
    target_audience: body.target_audience,
    deep_link: body.deep_link,
    approval_required: body.approval_required,
    created_by_phone: String(auth.admin.phone || "").trim(),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error.code, message: result.error.message },
      { status: errorStatus(result.error.code) }
    );
  }
  return NextResponse.json(
    { ok: true, announcement: result.value },
    { status: 201 }
  );
}
