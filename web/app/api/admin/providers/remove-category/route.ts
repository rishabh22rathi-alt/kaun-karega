import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { removeProviderFromCategory } from "@/lib/admin/adminProviderMutations";

// POST /api/admin/providers/remove-category
//
// Body: { providerId: string, category: string }
//
// Removes the provider's mapping to a specific category WITHOUT
// touching the provider row, profile, areas, chats, tasks, or history.
// See lib/admin/adminProviderMutations.removeProviderFromCategory for
// the full contract.

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

  const providerId = String(body.providerId ?? "").trim();
  const category = String(body.category ?? "").trim();
  if (!providerId || !category) {
    return NextResponse.json(
      { ok: false, error: "providerId and category are required" },
      { status: 400 }
    );
  }

  const result = await removeProviderFromCategory(providerId, category);
  if (!result.ok) {
    const status = result.code === "PROVIDER_NOT_FOUND" ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status }
    );
  }
  return NextResponse.json({ ok: true, removed: result.removed });
}
