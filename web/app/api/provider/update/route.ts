import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { updateProviderInSupabase } from "@/lib/admin/adminProviderReads";
import { findDuplicateNameProviders } from "@/lib/providerNameNormalize";
import { queueUnmappedAreaForReview } from "@/lib/admin/adminUnmappedAreas";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import { getPlanRule } from "@/lib/payments/planRules";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";

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
  console.log("[provider/update] received region payload", {
    selectedRegionCodes,
    areasCount: areas.length,
    hasRegionCodes,
  });

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

  // ── Plan-aware enforcement + addition-only monthly limit ─────────────
  //
  // What this block does, in order:
  //   1. Look up the provider's current plan row. Fail-CLOSED on a DB
  //      error during region edits; fail-OPEN on non-region edits.
  //   2. Snapshot previous categories + areas (and reverse-derive the
  //      previous region set). Used by BOTH the plan-cap check (so we
  //      can let strict reductions through even when the new count is
  //      still over the cap) AND the addition-only monthly limit.
  //   3. Compute add/remove diffs for regions and categories.
  //   4. Plan-cap check with a strict-reduction exception: an
  //      over-the-cap save is allowed if it strictly reduces the
  //      region count and adds nothing new. Lets a provider trim from
  //      7→6→5 in steps instead of being stuck at "7 saved but plan
  //      allows 5, every save bounces."
  //   5. Monthly addition-only limit. Counts only history rows where
  //      `new_value` contains at least one entry not in `old_value`
  //      (i.e. a previous save that added coverage). Pure-removal
  //      saves are skipped entirely and do not consume the budget.
  //   6. Reset boundary uses MAX(monthStart, current_period_start).
  //      The Razorpay webhook already updates current_period_start on
  //      every payment.captured, so successful plan activation
  //      naturally resets the addition counter for that provider
  //      without any code change here.
  const { data: planRow, error: planLookupError } = await adminSupabase
    .from("provider_plans")
    .select("plan_code, max_regions, current_period_start, current_period_end")
    .eq("provider_id", providerRow.provider_id)
    .maybeSingle();

  if (planLookupError && hasRegionCodes) {
    console.error(
      "[provider/update] provider_plans lookup failed during region edit; failing CLOSED",
      planLookupError.message || planLookupError
    );
    return NextResponse.json(
      { ok: false, error: "PLAN_LOOKUP_FAILED" },
      { status: 500 }
    );
  }
  if (planLookupError) {
    console.warn(
      "[provider/update] provider_plans lookup failed on non-region edit; failing OPEN",
      planLookupError.message || planLookupError
    );
  }

  const plan = effectivePlan(planLookupError ? null : (planRow ?? null));

  // ── Snapshot previous state ──────────────────────────────────────────
  // Loaded BEFORE both the plan-cap check (needs prevRegions to decide
  // "is this a strict reduction?") and the monthly precheck (needs
  // addedRegions / addedCategories to decide whether to enforce). If
  // the snapshot read errors out, fall back to safe-but-strict
  // behavior: no relaxation on the cap, monthly precheck skipped.
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

  let prevSnapshotFailed = false;
  let prevRegions: string[] = [];
  type PrevAreaRow = { area: string | null; city_code: string | null };
  let prevAreaRows: PrevAreaRow[] = [];
  try {
    const { data: prevAreas, error: prevAreasErr } = await adminSupabase
      .from("provider_areas")
      .select("area, city_code")
      .eq("provider_id", providerRow.provider_id);
    if (prevAreasErr) throw prevAreasErr;
    prevAreaRows = (prevAreas ?? []) as PrevAreaRow[];
    // Reverse-derive prev region codes from prev areas via
    // service_region_areas. Only meaningful when we have areas to
    // map; otherwise prevRegions stays empty (legacy provider with no
    // rows or a brand-new edit).
    if (hasRegionCodes && prevAreaRows.length > 0) {
      const prevAreaList = prevAreaRows
        .map((a) => String(a.area ?? "").trim())
        .filter(Boolean);
      if (prevAreaList.length > 0) {
        const prevCity =
          prevAreaRows.find((r) =>
            /^[A-Z]{3}$/.test(String(r.city_code ?? "").trim().toUpperCase())
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
    }
  } catch (err) {
    prevSnapshotFailed = true;
    console.warn(
      "[provider/update] previous-state snapshot failed; cap relaxation disabled and monthly precheck will be skipped",
      err instanceof Error ? err.message : err
    );
  }

  // ── Region add-diff (cap-relaxation input) ───────────────────────────
  // Only `addedRegions` is materialized — used by the plan-cap
  // strict-reduction check below to decide whether an over-cap save is
  // a legitimate trim or a sneaky addition. The monthly addition limit
  // and the category-add diff were removed for MVP: providers can now
  // change regions/categories any number of times within their plan
  // cap. The audit log written by updateProviderInSupabase still
  // records every actual mutation, so we can re-introduce per-period
  // throttles later without losing data.
  const nextRegions = hasRegionCodes ? normalize(selectedRegionCodes) : [];
  const prevRegionsSet = new Set(prevRegions);
  const addedRegions = hasRegionCodes
    ? nextRegions.filter((r) => !prevRegionsSet.has(r))
    : [];

  // ── Plan-cap check (with strict-reduction relaxation) ────────────────
  if (!planLookupError && hasRegionCodes) {
    const rule = getPlanRule(plan.code);
    if (rule.kind === "fixed" && nextRegions.length > rule.maxRegions) {
      // Allow only when this save STRICTLY REDUCES coverage:
      //   - no new region added (addedRegions empty), AND
      //   - new count strictly less than previous count
      // Same-size-but-different swaps are NOT a reduction (they touch
      // additions). Growing past the cap is never allowed.
      const isStrictReduction =
        !prevSnapshotFailed &&
        addedRegions.length === 0 &&
        nextRegions.length < prevRegions.length;
      if (!isStrictReduction) {
        return NextResponse.json(
          {
            ok: false,
            error: "PLAN_LIMIT_EXCEEDED",
            planCode: plan.code,
            maxRegions: rule.maxRegions,
            attempted: nextRegions.length,
          },
          { status: 400 }
        );
      }
      // Strict reduction allowed even though new count is still > cap.
      // Provider must keep reducing on future saves until cap is met.
    }
    // cityWide: no per-count check; the data shape IS the limit. A
    // tampered payload that under-covers is allowed for now (provider
    // can always opt to a subset of their plan's coverage).
  }

  // NOTE: The per-period monthly addition limit (MONTHLY_CHANGE_LIMIT)
  // was removed for the MVP. Providers can now change regions and
  // categories any number of times — only the per-save plan cap and
  // strict-reduction rules above gate the write. The audit log in
  // provider_change_log is still produced by updateProviderInSupabase
  // for every actual mutation, so re-introducing a throttle later is a
  // pure read-side change with the historical data intact.

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
    console.error("[provider/update] updateProviderInSupabase failed", {
      providerId: String(providerRow.provider_id),
      selectedRegionCodes: hasRegionCodes ? selectedRegionCodes : undefined,
      areasCount: areas.length,
      error: result.error,
    });
    return NextResponse.json(
      { ok: false, error: "UPDATE_FAILED", message: result.error || "Provider update failed" },
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
    // Provider-originated pending category requests. Write ONLY columns
    // that exist on the live table: provider_id (association),
    // requested_category, status, created_at. The table has no
    // request_id / provider_name / phone columns — writing them made every
    // insert fail with PGRST204, silently swallowed by Promise.allSettled,
    // so provider requests never landed. `user_phone` is intentionally
    // omitted (NULL) — that is what marks a row as provider-originated.
    const pcrResults = await Promise.allSettled(
      newCustomCategories.map(async (requestedCategory) => {
        const { error } = await adminSupabase
          .from("pending_category_requests")
          .insert({
            provider_id: String(providerRow.provider_id),
            requested_category: requestedCategory,
            status: "pending",
            created_at: nowIso,
          });
        if (error) {
          throw new Error(
            `insert failed for "${requestedCategory}": ${error.message}`
          );
        }
      })
    );
    // Surface failures in logs instead of swallowing them. Non-blocking:
    // the profile update has already succeeded.
    for (const res of pcrResults) {
      if (res.status === "rejected") {
        console.error(
          "[provider/update] pending_category_requests insert failed",
          res.reason instanceof Error ? res.reason.message : res.reason
        );
      }
    }
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

  // Admin snapshot invalidation — keeps the AreaTab's verified /
  // provider-density-by-region counts in sync with the row we just
  // wrote, so an admin reading /api/admin/areas after this save sees
  // the change on the very next request instead of waiting up to the
  // 6h snapshot TTL or clicking Refresh. Soft-fail by design: a
  // cache-invalidation error must never bubble up and undo a
  // successful provider save.
  //
  // TODO(multi-city): when service_regions ships beyond JOD, derive
  // the city_code from this provider's saved provider_areas rows
  // (or from the request body's cityCode) and invalidate the
  // matching `area_stats.<CITY>` key. Today's hard-coded "JOD" is
  // intentional under the single-active-city deployment.
  try {
    await invalidateSnapshots([
      "area_stats.JOD",
      "provider_stats",
      "provider_stats.by_category",
      "provider_stats.by_category.verified",
    ]);
  } catch (err) {
    console.warn(
      "[provider/update] snapshot invalidation failed (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({
    ok: true,
    duplicateNameReviewStatus: duplicateMatches.length > 0 ? "pending" : null,
  });
}
