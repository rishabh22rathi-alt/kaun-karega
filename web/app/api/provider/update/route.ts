import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { updateProviderInSupabase } from "@/lib/admin/adminProviderReads";
import { findDuplicateNameProviders } from "@/lib/providerNameNormalize";
import { queueUnmappedAreaForReview } from "@/lib/admin/adminUnmappedAreas";

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
  const session = await getAuthSession({ cookie: request.headers.get("cookie") ?? "" });
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
  // Single-canonical-category policy. Multi-category submissions are rejected
  // here so the cap holds even if a frontend bypasses MAX_CATEGORIES. Legacy
  // providers whose stored row count exceeds 1 are unaffected on read paths;
  // they will only encounter this gate when actively saving an edit, at which
  // point the frontend must down-select to one primary category.
  if (categories.length > 1) {
    return NextResponse.json(
      { ok: false, error: "ONLY_ONE_CATEGORY_ALLOWED" },
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

  // Detect categories the provider added that are NOT in the active master
  // list. Comparison is case-insensitive on trimmed names. We do this BEFORE
  // the provider_services rewrite so we can queue review rows even if some
  // downstream step fails. If the master fetch errors we skip detection (no
  // queue inserts) rather than treating every category as new.
  const { data: masterCategoryRows, error: masterCategoryError } =
    await adminSupabase.from("categories").select("name").eq("active", true);
  const newCustomCategories: string[] = masterCategoryError
    ? []
    : (() => {
        const masterCategoryKeys = new Set(
          (masterCategoryRows || [])
            .map((row) => String((row as { name?: unknown }).name || "").trim().toLowerCase())
            .filter(Boolean)
        );
        return categories.filter(
          (category) => !masterCategoryKeys.has(category.toLowerCase())
        );
      })();

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

  // Queue unknown area strings for admin review — non-fatal. Mirrors the
  // provider_register flow in /api/kk, with source_type = "provider_update"
  // so admins can distinguish edit-driven submissions from registration
  // submissions later. An area is considered "known" if its toAreaKey
  // matches an active canonical area OR an active alias in the new
  // service_region_areas / service_region_area_aliases tables (the AreaTab
  // pending tab consumes this same union). Failures here never roll back
  // the provider update — Promise.allSettled + soft logging.
  try {
    const [canonicalRes, aliasRes] = await Promise.all([
      adminSupabase
        .from("service_region_areas")
        .select("canonical_area")
        .eq("active", true)
        .limit(5000),
      adminSupabase
        .from("service_region_area_aliases")
        .select("alias")
        .eq("active", true)
        .limit(5000),
    ]);

    if (!canonicalRes.error && !aliasRes.error) {
      // Inlined toAreaKey — mirrors lib/admin/adminAreaMappings so the
      // membership check collapses casing / spacing / punctuation the
      // same way the rest of the system does.
      const toAreaKey = (value: unknown) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      const knownKeys = new Set<string>();
      for (const row of canonicalRes.data ?? []) {
        const k = toAreaKey(
          (row as { canonical_area?: unknown }).canonical_area
        );
        if (k) knownKeys.add(k);
      }
      for (const row of aliasRes.data ?? []) {
        const k = toAreaKey((row as { alias?: unknown }).alias);
        if (k) knownKeys.add(k);
      }
      const unknownAreas = areas.filter((a) => !knownKeys.has(toAreaKey(a)));
      if (unknownAreas.length > 0) {
        await Promise.allSettled(
          unknownAreas.map((rawArea) =>
            queueUnmappedAreaForReview({
              rawArea,
              sourceType: "provider_update",
              sourceRef: String(providerRow.provider_id),
            })
          )
        );
      }
    } else {
      console.warn(
        "[provider/update] AI table read failed; skipping queue enqueue",
        canonicalRes.error || aliasRes.error
      );
    }
  } catch (err) {
    console.warn(
      "[provider/update] enqueueUnmapped threw; provider update still succeeded",
      err
    );
  }

  // Queue new custom categories for admin review — non-fatal. Mirrors the
  // provider_register flow in /api/kk. A duplicate row per provider+category
  // is acceptable; admins can close duplicates from the queue UI. We do NOT
  // flip providers.status to "pending" here: it would have no provider-facing
  // effect (sidebar/dashboard badges are gated behind !verified) and would
  // expose the row to setProviderVerified("no")'s pending → rejected
  // side-effect (adminProviderMutations.ts:52-56).
  if (newCustomCategories.length > 0) {
    const nowIso = new Date().toISOString();
    await Promise.allSettled(
      newCustomCategories.map((requestedCategory) =>
        adminSupabase.from("pending_category_requests").insert({
          request_id: `PCR-${crypto.randomUUID()}`,
          provider_id: String(providerRow.provider_id),
          provider_name: name,
          phone: sessionPhone,
          requested_category: requestedCategory,
          status: "pending",
          created_at: nowIso,
        })
      )
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
