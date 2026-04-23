import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { updateProviderInSupabase } from "@/lib/admin/adminProviderReads";
import { findDuplicateNameProviders } from "@/lib/providerNameNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export async function POST(request: Request) {
  const session = getAuthSession({ cookie: request.headers.get("cookie") ?? "" });
  const sessionPhone = normalizePhone10(String(session?.phone || ""));
  if (!session || !sessionPhone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED_PROVIDER_SESSION" },
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const categories = sanitizeStringArray(body.categories);
  const areas = sanitizeStringArray(body.areas);

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "NAME_REQUIRED" },
      { status: 400 }
    );
  }
  if (categories.length === 0) {
    return NextResponse.json(
      { ok: false, error: "CATEGORIES_REQUIRED" },
      { status: 400 }
    );
  }
  if (areas.length === 0) {
    return NextResponse.json(
      { ok: false, error: "AREAS_REQUIRED" },
      { status: 400 }
    );
  }

  // Ownership: resolve provider_id from the session phone. The client never
  // sends a providerId or phone — this prevents a logged-in provider from
  // editing anyone else's record.
  const { data: providerRow, error: lookupError } = await adminSupabase
    .from("providers")
    .select("provider_id, phone")
    .eq("phone", sessionPhone)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      {
        ok: false,
        error: "PROVIDER_LOOKUP_FAILED",
        message: lookupError.message || "Failed to locate provider for this session.",
      },
      { status: 500 }
    );
  }
  if (!providerRow || !providerRow.provider_id) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  const result = await updateProviderInSupabase({
    id: String(providerRow.provider_id),
    name,
    phone: sessionPhone,
    categories,
    areas,
  });

  if (!result.success) {
    return NextResponse.json(
      { ok: false, error: "UPDATE_FAILED" },
      { status: 500 }
    );
  }

  // If the new full_name collides with another provider, re-enter the
  // duplicate-name review queue. Non-fatal: a failure here does not roll
  // back the successful profile update.
  const duplicateMatches = await findDuplicateNameProviders(name, sessionPhone);
  if (duplicateMatches.length > 0) {
    await adminSupabase
      .from("providers")
      .update({
        status: "pending",
        verified: "no",
        duplicate_name_review_status: "pending",
        duplicate_name_matches: duplicateMatches.map((m) => m.provider_id),
        duplicate_name_flagged_at: new Date().toISOString(),
        duplicate_name_resolved_at: null,
        duplicate_name_admin_phone: null,
        duplicate_name_reason: null,
      })
      .eq("provider_id", String(providerRow.provider_id));
  }

  return NextResponse.json({
    ok: true,
    duplicateNameReviewStatus: duplicateMatches.length > 0 ? "pending" : null,
  });
}
