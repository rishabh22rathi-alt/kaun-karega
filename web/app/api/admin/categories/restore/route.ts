import { NextResponse } from "next/server";

import { restoreCategoryFromArchive } from "@/lib/admin/adminCategoryMutations";
import { requireAdminSession } from "@/lib/adminAuth";

// /api/admin/categories/restore
//
// POST  restore an archived category by archiveId.
//       Body: { archiveId: string, adminNote?: string }
//       Returns: { ok, restored: { categoryName, archiveId,
//                                  restoredAliases } }
//
// Idempotent: restoring an already-restored row returns 409 with code
// ARCHIVE_NOT_RESTORABLE so the UI can hide the button instead of
// trying again.

export const runtime = "nodejs";

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

  const archiveId = String(body.archiveId ?? "").trim();
  const adminNote = String(body.adminNote ?? "").trim();
  if (!archiveId) {
    return NextResponse.json(
      { ok: false, error: "archiveId is required" },
      { status: 400 }
    );
  }

  const actor = auth.admin?.name?.trim() || auth.admin?.phone || "";

  const result = await restoreCategoryFromArchive(archiveId, actor, adminNote);
  if (!result.ok) {
    const status =
      result.code === "ARCHIVE_NOT_FOUND"
        ? 404
        : result.code === "ARCHIVE_NOT_RESTORABLE"
          ? 409
          : 500;
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status }
    );
  }
  return NextResponse.json({ ok: true, restored: result.restored });
}
