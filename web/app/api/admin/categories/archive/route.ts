import { NextResponse } from "next/server";

import {
  archiveCategory,
  listCategoryArchives,
} from "@/lib/admin/adminCategoryMutations";
import { requireAdminSession } from "@/lib/adminAuth";

// /api/admin/categories/archive
//
// GET   list archive review rows for the Archived Categories tab.
//       Query: ?status=archived|restored|all (default 'archived').
//
// POST  archive a category. Snapshots affected provider_services +
//       category_aliases, flips categories.active and the matching
//       aliases inactive, inserts a status='archived' review row.
//       Body: { categoryName: string, adminNote?: string }
//       Returns: { ok, archived: { categoryName, providerCount,
//                                  aliasCount, archiveId } }
//
// Auth: requireAdminSession gates both verbs. The actor's name or
// phone is persisted in archived_by for the audit trail.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const rawStatus = (url.searchParams.get("status") ?? "archived").toLowerCase();
  const status: "archived" | "restored" | "all" =
    rawStatus === "restored" || rawStatus === "all" ? rawStatus : "archived";

  const result = await listCategoryArchives(status);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, archives: result.archives });
}

export async function POST(request: Request) {
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

  const categoryName = String(body.categoryName ?? "").trim();
  const adminNote = String(body.adminNote ?? "").trim();
  if (!categoryName) {
    return NextResponse.json(
      { ok: false, error: "categoryName is required" },
      { status: 400 }
    );
  }

  const actor = auth.admin?.name?.trim() || auth.admin?.phone || "";

  const result = await archiveCategory(categoryName, actor, adminNote);
  if (!result.ok) {
    const status =
      result.code === "CATEGORY_NOT_FOUND" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status }
    );
  }
  return NextResponse.json({ ok: true, archived: result.archived });
}
