import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { updateProviderInSupabase } from "@/lib/admin/adminProviderReads";
import { findDuplicateNameProviders } from "@/lib/providerNameNormalize";
import { queueUnmappedAreaForReview } from "@/lib/admin/adminUnmappedAreas";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import {
  getPlanRule,
  MONTHLY_CHANGE_LIMIT,
  type ChangeType,
} from "@/lib/payments/planRules";

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
  // Optional city from the cascade UI. Validated against ^[A-Z]{3}$ at
  // the helper layer; absence (old clients) falls back to default city.
  const rawCity = typeof body.cityCode === "string" ? body.cityCode.trim().toUpperCase() : "";
  const cityCode = /^[A-Z]{3}$/.test(rawCity) ? rawCity : undefined;
  // Plan-aware region count. The frontend cascade sends the deduped
  // region-code list; absence means an old client that pre-dates the
  // plan-aware flow. In that case we skip region-cap enforcement (the
  // areas.length fallback path is hostile — it would reject any free
  // provider with >1 canonical area).
  const selectedRegionCodes = sanitizeStringArray(body.selectedRegionCodes);
  const hasRegionCodes = Array.isArray(body.selectedRegionCodes);

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

  // ── Plan-aware enforcement (replaces the prior Stage 3A area-count
  //    check; always runs now, not gated by PAYMENT_ENFORCEMENT_ENABLED) ─
  //
  // Compares the provider's REGION count (from selectedRegionCodes in
  // the body) against their effective plan's maxRegions. Old clients
  // that don't send selectedRegionCodes skip this check — they hit the
  // legacy area-count path was incorrect (every region expands to N
  // areas), so silently skipping is safer than wrongly rejecting.
  //
  // The cityWide rule kind has no region cap (the plan == "every
  // active region in the city"); we still verify against the city's
  // actual region count to catch tampering.
  //
  // Failure mode for the plan lookup: fail-OPEN with a loud warn.
  const { data: planRow, error: planLookupError } = await adminSupabase
    .from("provider_plans")
    .select("plan_code, max_regions, current_period_start, current_period_end")
    .eq("provider_id", providerRow.provider_id)
    .maybeSingle();

  const plan = effectivePlan(planLookupError ? null : (planRow ?? null));
  if (planLookupError) {
    console.warn(
      "[provider/update] provider_plans lookup failed; failing OPEN (no enforcement this request)",
      planLookupError.message || planLookupError
    );
  } else if (hasRegionCodes) {
    const rule = getPlanRule(plan.code);
    if (rule.kind === "fixed" && selectedRegionCodes.length > rule.maxRegions) {
      return NextResponse.json(
        {
          ok: false,
          error: "PLAN_LIMIT_EXCEEDED",
          planCode: plan.code,
          maxRegions: rule.maxRegions,
          attempted: selectedRegionCodes.length,
        },
        { status: 400 }
      );
    }
    // cityWide: no per-count check; the data shape IS the limit. A
    // tampered payload that under-covers is allowed for now (provider
    // can always opt to a subset of their plan's coverage).
  }

  // ── Monthly change-limit enforcement (3 per kind per calendar month) ─
  // Count provider_change_log rows since the start of the current UTC
  // month. We only count the kinds we're about to LOG (i.e. only the
  // kinds whose set actually mutates this save). To know that, we need
  // to snapshot the current state and diff against what's being saved
  // — same logic updateProviderInSupabase will run again. Doing the
  // diff here too is the price we pay for enforcing BEFORE the write.
  // Failure mode: fail-OPEN (transient blip can't lock provider out).
  try {
    const monthStart = (() => {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      ).toISOString();
    })();

    // Snapshot previous state for diffing.
    const [{ data: prevServices }, { data: prevAreas }] = await Promise.all([
      adminSupabase
        .from("provider_services")
        .select("category")
        .eq("provider_id", providerRow.provider_id),
      adminSupabase
        .from("provider_areas")
        .select("area, city_code")
        .eq("provider_id", providerRow.provider_id),
    ]);
    const normalize = (vs: string[]) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of vs) {
        const k = String(v ?? "").trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(k);
      }
      return out.sort();
    };
    const prevCats = normalize(
      ((prevServices ?? []) as Array<{ category: string | null }>)
        .map((s) => String(s.category ?? ""))
    );
    const nextCats = normalize(categories);
    const categoryChanging =
      prevCats.length !== nextCats.length ||
      prevCats.some((v, i) => v !== nextCats[i]);

    // Region diff via reverse-derivation through service_region_areas.
    // Only meaningful when the new submit included selectedRegionCodes;
    // without it we cannot compute "is the region set changing".
    let regionChanging = false;
    if (hasRegionCodes) {
      const nextRegions = normalize(selectedRegionCodes);
      const prevAreaList = ((prevAreas ?? []) as Array<{
        area: string | null;
        city_code: string | null;
      }>).map((a) => String(a.area ?? "")).filter(Boolean);
      let prevRegions: string[] = [];
      if (prevAreaList.length > 0) {
        const prevCity =
          ((prevAreas ?? []) as Array<{ city_code: string | null }>).find(
            (r) => /^[A-Z]{3}$/.test(String(r.city_code ?? "").trim().toUpperCase())
          )?.city_code ?? cityCode ?? "";
        const sraQ = adminSupabase
          .from("service_region_areas")
          .select("canonical_area, region_code")
          .eq("active", true)
          .limit(10000);
        if (prevCity) sraQ.eq("city_code", prevCity);
        const { data: sraRows } = await sraQ;
        const keyToRegion = new Map<string, string>();
        for (const r of (sraRows ?? []) as Array<{
          canonical_area: string | null;
          region_code: string | null;
        }>) {
          const k = String(r.canonical_area ?? "").trim().toLowerCase();
          const rc = String(r.region_code ?? "").trim();
          if (k && rc) keyToRegion.set(k, rc);
        }
        const derived = new Set<string>();
        for (const a of prevAreaList) {
          const rc = keyToRegion.get(a.trim().toLowerCase());
          if (rc) derived.add(rc);
        }
        prevRegions = Array.from(derived).sort();
      }
      regionChanging =
        prevRegions.length !== nextRegions.length ||
        prevRegions.some((v, i) => v !== nextRegions[i]);
    }

    // Count monthly logs for the kinds that are about to be incremented.
    const kindsToCheck: ChangeType[] = [];
    if (categoryChanging) kindsToCheck.push("category_change");
    if (regionChanging) kindsToCheck.push("region_change");

    for (const kind of kindsToCheck) {
      const { count, error: countErr } = await adminSupabase
        .from("provider_change_log")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", providerRow.provider_id)
        .eq("change_type", kind)
        .gte("changed_at", monthStart);
      if (countErr) {
        console.warn(
          "[provider/update] provider_change_log count failed; failing OPEN",
          countErr.message || countErr
        );
        break;
      }
      if (Number(count ?? 0) >= MONTHLY_CHANGE_LIMIT) {
        return NextResponse.json(
          {
            ok: false,
            error: "MONTHLY_CHANGE_LIMIT_EXCEEDED",
            changeType: kind,
            monthlyLimit: MONTHLY_CHANGE_LIMIT,
            usedThisMonth: Number(count ?? 0),
          },
          { status: 429 }
        );
      }
    }
  } catch (err) {
    console.warn(
      "[provider/update] monthly-limit precheck threw; failing OPEN",
      err
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

  // Custom (not-yet-approved) categories must NOT enter provider_services.
  // They live exclusively in pending_category_requests until an admin
  // approves them — at which point adminCategoryMutations.approveCategoryRequest
  // is responsible for inserting the provider_services row. This filter
  // prevents the dashboard from surfacing a custom category under
  // "Active Approved Service Category" before review.
  const newCustomCategoryKeys = new Set(
    newCustomCategories.map((c) => c.trim().toLowerCase())
  );
  const approvedSelectedCategories = categories.filter(
    (c) => !newCustomCategoryKeys.has(c.trim().toLowerCase())
  );

  const result = await updateProviderInSupabase({
    id: String(providerRow.provider_id),
    name,
    phone: sessionPhone,
    categories: approvedSelectedCategories,
    areas,
    cityCode,
    selectedRegionCodes: hasRegionCodes ? selectedRegionCodes : undefined,
    changedBy: "self",
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
