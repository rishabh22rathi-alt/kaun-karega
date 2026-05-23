import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/adminAuth";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";
import { invalidateAreasCacheByCity } from "@/app/api/areas/route";
import { resolveAreaToRegion } from "@/lib/geo/areaRegionResolver";

// Admin Provider Area Resolution Center — single-area resolve.
//
// Four actions:
//   • allocate  → run resolveAreaToRegion against the catalog; if
//                 resolved, just update matching provider_areas rows.
//                 Does NOT touch the catalog (no alias / canonical
//                 insert). Use this for the per-row "Allocate this
//                 area" action in the auto-resolvable bucket.
//   • alias     → insert service_region_area_aliases row (if absent) +
//                 update matching provider_areas rows to the region.
//   • canonical → insert service_region_areas row + same provider_areas
//                 update.
//   • ignore    → mark area_review_queue row as 'ignored' so the area
//                 stops appearing in the unresolved list. Does NOT
//                 touch provider_areas.
//
// All three are admin-only (requireAdminSession) and use the service-role
// adminSupabase. provider_areas updates are scoped by:
//   city_code='JOD' AND region_code IS NULL AND area IN (raw strings that
//   normalize to the request's normalized_key)
// — never overwrites an already-allocated row, never touches non-JOD
// cities, never deletes anything.

export const runtime = "nodejs";

const CITY_CODE = "JOD";
const SELECT_PAGE_SIZE = 1000;
const UPDATE_CHUNK_SIZE = 500;

function normalizeAreaName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toAreaKey(value: unknown): string {
  return normalizeAreaName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401 }
  );
}

function badRequest(error: string, detail?: string) {
  return NextResponse.json({ ok: false, error, detail }, { status: 400 });
}

function notFound(error: string, detail?: string) {
  return NextResponse.json({ ok: false, error, detail }, { status: 404 });
}

function conflict(error: string, detail?: string) {
  return NextResponse.json({ ok: false, error, detail }, { status: 409 });
}

function dbError(detail: string) {
  return NextResponse.json(
    { ok: false, error: "DB_ERROR", detail },
    { status: 500 }
  );
}

// Find every distinct raw provider_areas.area whose normalized key
// matches the given key. Returns the raw strings to feed into a scoped
// .in('area', …) UPDATE. JS-side filtering is necessary because the DB
// stores raw text and we don't have a normalized_key column on
// provider_areas.
async function findRawAreasForKey(
  key: string
): Promise<{ ok: true; areas: string[] } | { ok: false; error: string }> {
  const distinct = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await adminSupabase
      .from("provider_areas")
      .select("area")
      .eq("city_code", CITY_CODE)
      .is("region_code", null)
      .range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) return { ok: false, error: error.message };
    const chunk = (data ?? []) as Array<{ area: string | null }>;
    for (const r of chunk) {
      const a = String(r.area ?? "");
      if (toAreaKey(a) === key) distinct.add(a);
    }
    if (chunk.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return { ok: true, areas: Array.from(distinct) };
}

async function updateProviderAreasToRegion(
  rawAreas: string[],
  regionCode: string
): Promise<{ ok: true; updatedRows: number } | { ok: false; error: string }> {
  if (rawAreas.length === 0) return { ok: true, updatedRows: 0 };
  let total = 0;
  for (let i = 0; i < rawAreas.length; i += UPDATE_CHUNK_SIZE) {
    const slice = rawAreas.slice(i, i + UPDATE_CHUNK_SIZE);
    const { error, count } = await adminSupabase
      .from("provider_areas")
      .update({ region_code: regionCode }, { count: "exact" })
      .eq("city_code", CITY_CODE)
      .is("region_code", null)
      .in("area", slice);
    if (error) return { ok: false, error: error.message };
    total += count ?? 0;
  }
  return { ok: true, updatedRows: total };
}

// Best-effort: mark any pending queue rows for this normalized_key as
// resolved. Non-fatal — a failure here doesn't roll back the catalog
// insert or the provider_areas update.
async function markQueueResolved(
  normalizedKey: string,
  resolvedCanonicalArea: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { error, count } = await adminSupabase
    .from("area_review_queue")
    .update(
      {
        status: "resolved",
        resolved_canonical_area: resolvedCanonicalArea,
        resolved_at: nowIso,
        last_seen_at: nowIso,
      },
      { count: "exact" }
    )
    .eq("normalized_key", normalizedKey)
    .eq("status", "pending");
  if (error) {
    console.warn(
      "[resolve-area] markQueueResolved failed (non-fatal):",
      error.message
    );
    return 0;
  }
  return count ?? 0;
}

// Compute the next `<region>-M###` area_code by scanning existing M-codes
// in this region. Mirrors the AreaTab.tsx nextRegionManualAreaCode helper
// but server-side and bounded to the relevant region.
async function nextManualAreaCode(
  regionCode: string
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const { data, error } = await adminSupabase
    .from("service_region_areas")
    .select("area_code")
    .eq("region_code", regionCode)
    .like("area_code", `${regionCode}-M%`);
  if (error) return { ok: false, error: error.message };
  const re = new RegExp(`^${regionCode.replace(/[-]/g, "\\-")}-M(\\d+)$`);
  let max = 0;
  for (const row of (data ?? []) as Array<{ area_code: string | null }>) {
    const m = String(row.area_code ?? "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  const suffix = next > 999 ? String(next) : String(next).padStart(3, "0");
  return { ok: true, code: `${regionCode}-M${suffix}` };
}

// Compute the next `<region>-AL###` alias_code. Same pattern as area-code
// minting; the active-alias scheme is JOD-NN-AL### per the JOD-25 seed
// (vs the AI-enrichment JOD-NN-EL### for inactive drafts).
async function nextAliasCode(
  regionCode: string
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const { data, error } = await adminSupabase
    .from("service_region_area_aliases")
    .select("alias_code")
    .eq("region_code", regionCode)
    .like("alias_code", `${regionCode}-AL%`);
  if (error) return { ok: false, error: error.message };
  const re = new RegExp(`^${regionCode.replace(/[-]/g, "\\-")}-AL(\\d+)$`);
  let max = 0;
  for (const row of (data ?? []) as Array<{ alias_code: string | null }>) {
    const m = String(row.alias_code ?? "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  const suffix = next > 999 ? String(next) : String(next).padStart(3, "0");
  return { ok: true, code: `${regionCode}-AL${suffix}` };
}

async function regionActiveJod(
  regionCode: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await adminSupabase
    .from("service_regions")
    .select("region_code, active, city_code")
    .eq("region_code", regionCode)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "REGION_NOT_FOUND" };
  if (data.active === false) return { ok: false, reason: "REGION_INACTIVE" };
  if (String(data.city_code ?? "").trim().toUpperCase() !== CITY_CODE) {
    return { ok: false, reason: "REGION_CITY_MISMATCH" };
  }
  return { ok: true };
}

async function canonicalActiveInRegion(
  canonicalArea: string,
  regionCode: string
): Promise<boolean> {
  const { data } = await adminSupabase
    .from("service_region_areas")
    .select("area_code")
    .eq("region_code", regionCode)
    .eq("active", true)
    .ilike("canonical_area", canonicalArea)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

function makeReviewId(): string {
  return `ARQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("INVALID_JSON_BODY");
  }

  const rawArea = normalizeAreaName(body.raw_area);
  const action = String(body.action ?? "")
    .trim()
    .toLowerCase();
  const regionCode = String(body.region_code ?? "").trim();
  const canonicalArea = normalizeAreaName(body.canonical_area);

  if (!rawArea) return badRequest("RAW_AREA_REQUIRED");
  const normalizedKey = toAreaKey(rawArea);
  if (!normalizedKey) return badRequest("RAW_AREA_NORMALIZES_EMPTY");

  if (
    action !== "alias" &&
    action !== "canonical" &&
    action !== "ignore" &&
    action !== "allocate"
  ) {
    return badRequest(
      "INVALID_ACTION",
      "action must be one of: alias, canonical, ignore, allocate"
    );
  }

  // ── ALLOCATE ──────────────────────────────────────────────────────────
  // Run the resolver and, if it returns resolved=true, update matching
  // provider_areas rows. No catalog mutation — this is the path for
  // areas that already exist as canonicals or aliases but whose
  // provider rows were written before Phase 2 (or by a path that
  // skipped resolver, or before the alias was added). The resolver is
  // the same one /allocate uses, so behaviour is consistent.
  if (action === "allocate") {
    const resolution = await resolveAreaToRegion(adminSupabase, {
      area: rawArea,
      cityCode: CITY_CODE,
    });
    if (!resolution.resolved) {
      return badRequest(
        "NOT_AUTO_RESOLVABLE",
        `Area "${rawArea}" returns ${resolution.reason}. Use alias / canonical / ignore instead.`
      );
    }

    const rawAreasRes = await findRawAreasForKey(normalizedKey);
    if (!rawAreasRes.ok) return dbError(rawAreasRes.error);

    const upd = await updateProviderAreasToRegion(
      rawAreasRes.areas,
      resolution.region_code
    );
    if (!upd.ok) return dbError(upd.error);

    const queueResolved = await markQueueResolved(
      normalizedKey,
      resolution.canonical_area
    );

    invalidateAreasCacheByCity(CITY_CODE);
    await invalidateSnapshots([`area_stats.${CITY_CODE}`]);

    return NextResponse.json({
      ok: true,
      action: "allocate",
      region_code: resolution.region_code,
      canonical_area: resolution.canonical_area,
      match_type: resolution.match_type,
      updatedRows: upd.updatedRows,
      queueResolved,
      matchedRawAreas: rawAreasRes.areas.length,
    });
  }

  // ── IGNORE ────────────────────────────────────────────────────────────
  // Upsert a queue row with status='ignored'. The unresolved-list
  // endpoint filters by this status, so the area drops out of the
  // resolution center on next load. provider_areas is left alone —
  // ignored rows simply stay region_code=NULL forever.
  //
  // NOTE: area_review_queue.status has no CHECK constraint declared in
  // source; production may enforce a fixed set. If 'ignored' is
  // rejected by a CHECK, the route returns a clean DB_ERROR and an
  // operator can ship a constraint-relaxing migration.
  if (action === "ignore") {
    const nowIso = new Date().toISOString();
    const { data: existing } = await adminSupabase
      .from("area_review_queue")
      .select("review_id")
      .eq("normalized_key", normalizedKey)
      .maybeSingle();
    if (existing) {
      const { error } = await adminSupabase
        .from("area_review_queue")
        .update({
          status: "ignored",
          last_seen_at: nowIso,
          raw_area: rawArea,
        })
        .eq("review_id", existing.review_id);
      if (error) return dbError(error.message);
    } else {
      const { error } = await adminSupabase
        .from("area_review_queue")
        .insert({
          review_id: makeReviewId(),
          raw_area: rawArea,
          normalized_key: normalizedKey,
          status: "ignored",
          occurrences: 1,
          source_type: "admin_resolution_center",
          source_ref: "",
          first_seen_at: nowIso,
          last_seen_at: nowIso,
          resolved_canonical_area: "",
          resolved_at: null,
          city_code: CITY_CODE,
        });
      if (error) return dbError(error.message);
    }
    return NextResponse.json({
      ok: true,
      action: "ignore",
      normalized_key: normalizedKey,
    });
  }

  // Both alias + canonical require an active JOD region.
  if (!regionCode) return badRequest("REGION_CODE_REQUIRED");
  const regOk = await regionActiveJod(regionCode);
  if (!regOk.ok) {
    if (regOk.reason === "REGION_NOT_FOUND") return notFound("REGION_NOT_FOUND");
    return badRequest(regOk.reason);
  }

  // ── ALIAS ─────────────────────────────────────────────────────────────
  if (action === "alias") {
    if (!canonicalArea) return badRequest("CANONICAL_AREA_REQUIRED");
    const canOk = await canonicalActiveInRegion(canonicalArea, regionCode);
    if (!canOk) {
      return notFound(
        "CANONICAL_NOT_FOUND_IN_REGION",
        `No active canonical "${canonicalArea}" under ${regionCode}`
      );
    }

    // Idempotency: if the (alias, region) already exists (regardless of
    // canonical mapping), don't insert a duplicate. We still proceed to
    // the provider_areas update — the goal is "make this area resolve",
    // not "always insert a new alias row".
    let aliasCode: string | null = null;
    const { data: existingAlias } = await adminSupabase
      .from("service_region_area_aliases")
      .select("alias_code")
      .eq("region_code", regionCode)
      .ilike("alias", rawArea)
      .limit(1);
    if (!existingAlias || existingAlias.length === 0) {
      const codeRes = await nextAliasCode(regionCode);
      if (!codeRes.ok) return dbError(codeRes.error);
      aliasCode = codeRes.code;
      const { error: insertErr } = await adminSupabase
        .from("service_region_area_aliases")
        .insert({
          alias_code: aliasCode,
          alias: rawArea,
          canonical_area: canonicalArea,
          region_code: regionCode,
          active: true,
          notes: "[inserted via admin Provider Area Resolution Center]",
          city_code: CITY_CODE,
        });
      if (insertErr) return dbError(insertErr.message);
    } else {
      aliasCode = String(existingAlias[0]?.alias_code ?? "") || null;
    }

    const rawAreasRes = await findRawAreasForKey(normalizedKey);
    if (!rawAreasRes.ok) return dbError(rawAreasRes.error);

    const upd = await updateProviderAreasToRegion(rawAreasRes.areas, regionCode);
    if (!upd.ok) return dbError(upd.error);

    const queueResolved = await markQueueResolved(normalizedKey, canonicalArea);

    invalidateAreasCacheByCity(CITY_CODE);
    await invalidateSnapshots([`area_stats.${CITY_CODE}`]);

    return NextResponse.json({
      ok: true,
      action: "alias",
      alias_code: aliasCode,
      region_code: regionCode,
      canonical_area: canonicalArea,
      updatedRows: upd.updatedRows,
      queueResolved,
      matchedRawAreas: rawAreasRes.areas.length,
    });
  }

  // ── CANONICAL ────────────────────────────────────────────────────────
  // action === "canonical"
  // Duplicate (canonical_area, region) gate — case-insensitive on the
  // active subset. Inactive rows do not block (matches the AreaTab
  // postArea behaviour at /api/admin/area-intelligence).
  const { data: dupCanonical } = await adminSupabase
    .from("service_region_areas")
    .select("area_code")
    .eq("region_code", regionCode)
    .eq("active", true)
    .ilike("canonical_area", rawArea)
    .limit(1);
  if (Array.isArray(dupCanonical) && dupCanonical.length > 0) {
    return conflict(
      "DUPLICATE_CANONICAL_IN_REGION",
      `"${rawArea}" is already an active canonical area under ${regionCode}`
    );
  }

  const codeRes = await nextManualAreaCode(regionCode);
  if (!codeRes.ok) return dbError(codeRes.error);
  const areaCode = codeRes.code;

  const { error: insertErr } = await adminSupabase
    .from("service_region_areas")
    .insert({
      area_code: areaCode,
      canonical_area: rawArea,
      region_code: regionCode,
      active: true,
      notes: "[inserted via admin Provider Area Resolution Center]",
      city_code: CITY_CODE,
    });
  if (insertErr) return dbError(insertErr.message);

  const rawAreasRes = await findRawAreasForKey(normalizedKey);
  if (!rawAreasRes.ok) return dbError(rawAreasRes.error);

  const upd = await updateProviderAreasToRegion(rawAreasRes.areas, regionCode);
  if (!upd.ok) return dbError(upd.error);

  const queueResolved = await markQueueResolved(normalizedKey, rawArea);

  invalidateAreasCacheByCity(CITY_CODE);
  await invalidateSnapshots([`area_stats.${CITY_CODE}`]);

  return NextResponse.json({
    ok: true,
    action: "canonical",
    area_code: areaCode,
    region_code: regionCode,
    canonical_area: rawArea,
    updatedRows: upd.updatedRows,
    queueResolved,
    matchedRawAreas: rawAreasRes.areas.length,
  });
}
