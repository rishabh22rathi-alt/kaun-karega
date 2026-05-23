import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/adminAuth";
import { invalidateAreasCacheByCity } from "@/app/api/areas/route";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";

// Guarded hard-delete for legacy JOD R-* regions deactivated by the
// JOD-25 rebuild (supabase/migrations/20260527130000_replace_jod_regions_with_25.sql).
//
// Target criteria (immutable):
//   service_regions.city_code   = 'JOD'
//   service_regions.region_code LIKE 'R-%'   (not 'JOD-%')
//   service_regions.active      = false
//
// Hard rule: a region is deleted only when it has NO unresolved
// dependency. A dependency is "unresolved" when a downstream row
// references a name that has no active replacement in the new JOD-*
// catalog. If every referencing name still exists as an ACTIVE
// canonical_area or alias under any JOD-* region, deleting the legacy
// metadata is provably safe — runtime matching resolves the name via
// the new catalog. Otherwise the candidate is skipped.
//
// Default mode is dryRun=true: nothing is deleted unless the caller
// explicitly passes ?dryRun=false. GET is dry-run-only.

export const runtime = "nodejs";

const CITY_CODE = "JOD";
const LEGACY_REGION_PREFIX = "R-";
const PROVIDER_AREAS_LIMIT = 100_000;
const TASKS_LIMIT = 100_000;
const REVIEW_QUEUE_LIMIT = 50_000;

type RegionRow = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
  city_code: string | null;
};

type AreaRow = {
  area_code: string;
  canonical_area: string | null;
  region_code: string | null;
  active: boolean | null;
};

type AliasRow = {
  id: string;
  alias_code: string;
  alias: string | null;
  region_code: string | null;
  active: boolean | null;
};

type Reference = {
  table: "provider_areas" | "tasks" | "area_review_queue";
  legacy_name: string;
  // Lower-cased, trimmed key used to match this name against active
  // JOD canonical/alias keys.
  key: string;
  count: number;
};

type CandidateCommon = {
  region_code: string;
  region_name: string | null;
  legacy_area_codes: string[];
  legacy_alias_codes: string[];
  legacy_canonical_names: string[];
  legacy_alias_names: string[];
  // References found in dependent tables, grouped by source table.
  references: Reference[];
  // References whose name has NO active JOD replacement — these block
  // deletion. Empty array means "safe to delete".
  orphan_risk_names: string[];
};

type CandidateSafe = CandidateCommon & { safe: true };
type CandidateSkipped = CandidateCommon & {
  safe: false;
  skip_reason: string;
};
type Candidate = CandidateSafe | CandidateSkipped;

type DeletedRecord = {
  region_code: string;
  region_name: string | null;
  areas_deleted: number;
  aliases_deleted: number;
};

type SkippedRecord = {
  region_code: string;
  region_name: string | null;
  reason: string;
  orphan_risk_names: string[];
  reference_counts: { table: Reference["table"]; name: string; count: number }[];
};

// Warning emitted when force=true bypasses the orphan-risk guard for a
// region. Surfaces the dependent rows that were left in place so the
// admin can decide whether to clean them up separately. Provider /
// task / review-queue rows are NOT touched by this route.
type ForceWarning = {
  region_code: string;
  region_name: string | null;
  orphan_risk_names: string[];
  reference_counts: { table: Reference["table"]; name: string; count: number }[];
};

const normName = (v: unknown): string =>
  String(v ?? "").trim().toLowerCase();

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401 }
  );
}

function dbError(message: string | undefined) {
  return NextResponse.json(
    { ok: false, error: "DB_ERROR", detail: message ?? "unknown" },
    { status: 500 }
  );
}

// Pulls the full picture in parallel, then computes candidates +
// safety. Used by both GET (dry-run only) and POST.
async function buildPlan(): Promise<
  | { ok: true; candidates: Candidate[] }
  | { ok: false; response: NextResponse }
> {
  const [
    legacyRegionsRes,
    legacyAreasRes,
    legacyAliasesRes,
    activeJodAreasRes,
    activeJodAliasesRes,
    providerAreasRes,
    tasksRes,
    reviewQueueRes,
  ] = await Promise.all([
    adminSupabase
      .from("service_regions")
      .select("region_code, region_name, active, city_code")
      .eq("city_code", CITY_CODE)
      .eq("active", false)
      .like("region_code", `${LEGACY_REGION_PREFIX}%`)
      .order("region_code", { ascending: true })
      .limit(500),
    adminSupabase
      .from("service_region_areas")
      .select("area_code, canonical_area, region_code, active")
      .eq("city_code", CITY_CODE)
      .like("region_code", `${LEGACY_REGION_PREFIX}%`)
      .limit(10_000),
    adminSupabase
      .from("service_region_area_aliases")
      .select("id, alias_code, alias, region_code, active")
      .eq("city_code", CITY_CODE)
      .like("region_code", `${LEGACY_REGION_PREFIX}%`)
      .limit(10_000),
    adminSupabase
      .from("service_region_areas")
      .select("canonical_area, region_code, active")
      .eq("city_code", CITY_CODE)
      .eq("active", true)
      .like("region_code", "JOD-%")
      .limit(10_000),
    adminSupabase
      .from("service_region_area_aliases")
      .select("alias, region_code, active")
      .eq("city_code", CITY_CODE)
      .eq("active", true)
      .like("region_code", "JOD-%")
      .limit(10_000),
    adminSupabase
      .from("provider_areas")
      .select("provider_id, area")
      .limit(PROVIDER_AREAS_LIMIT),
    adminSupabase
      .from("tasks")
      .select("task_id, area, status")
      .limit(TASKS_LIMIT),
    adminSupabase
      .from("area_review_queue")
      .select("review_id, raw_area, resolved_canonical_area, status")
      .limit(REVIEW_QUEUE_LIMIT),
  ]);

  const firstErr =
    legacyRegionsRes.error ||
    legacyAreasRes.error ||
    legacyAliasesRes.error ||
    activeJodAreasRes.error ||
    activeJodAliasesRes.error ||
    providerAreasRes.error ||
    tasksRes.error ||
    reviewQueueRes.error;
  if (firstErr) {
    return { ok: false, response: dbError(firstErr.message) };
  }

  const legacyRegions = (legacyRegionsRes.data ?? []) as RegionRow[];
  const legacyAreas = (legacyAreasRes.data ?? []) as AreaRow[];
  const legacyAliases = (legacyAliasesRes.data ?? []) as AliasRow[];

  // Active JOD-* replacement name set (canonical_area + alias).
  // A legacy name that exists here is safe to delete — runtime
  // matching falls through to the new catalog.
  const activeJodKeys = new Set<string>();
  for (const r of (activeJodAreasRes.data ?? []) as Array<{
    canonical_area: string | null;
  }>) {
    const k = normName(r.canonical_area);
    if (k) activeJodKeys.add(k);
  }
  for (const r of (activeJodAliasesRes.data ?? []) as Array<{
    alias: string | null;
  }>) {
    const k = normName(r.alias);
    if (k) activeJodKeys.add(k);
  }

  // Pre-build reference indices keyed by normalized area name.
  // provider_areas: count of distinct rows per normalized area key.
  const providerCountByKey = new Map<string, number>();
  for (const r of (providerAreasRes.data ?? []) as Array<{
    area: string | null;
  }>) {
    const k = normName(r.area);
    if (!k) continue;
    providerCountByKey.set(k, (providerCountByKey.get(k) ?? 0) + 1);
  }

  // tasks: count by normalized area key. We DO NOT exclude any status
  // here — even a 'closed' task pointing at a legacy area name still
  // counts as a historical reference worth flagging.
  const tasksCountByKey = new Map<string, number>();
  for (const r of (tasksRes.data ?? []) as Array<{ area: string | null }>) {
    const k = normName(r.area);
    if (!k) continue;
    tasksCountByKey.set(k, (tasksCountByKey.get(k) ?? 0) + 1);
  }

  // area_review_queue: union of raw_area and resolved_canonical_area.
  // Only PENDING rows count as blocking — resolved/rejected rows are
  // historical and do not affect runtime matching.
  const reviewCountByKey = new Map<string, number>();
  for (const r of (reviewQueueRes.data ?? []) as Array<{
    raw_area: string | null;
    resolved_canonical_area: string | null;
    status: string | null;
  }>) {
    const status = String(r.status ?? "").trim().toLowerCase();
    if (status !== "pending") continue;
    const k1 = normName(r.raw_area);
    if (k1) reviewCountByKey.set(k1, (reviewCountByKey.get(k1) ?? 0) + 1);
    const k2 = normName(r.resolved_canonical_area);
    if (k2) reviewCountByKey.set(k2, (reviewCountByKey.get(k2) ?? 0) + 1);
  }

  // Group legacy children by region_code.
  const areasByRegion = new Map<string, AreaRow[]>();
  for (const a of legacyAreas) {
    const rc = String(a.region_code ?? "");
    if (!rc) continue;
    const arr = areasByRegion.get(rc) ?? [];
    arr.push(a);
    areasByRegion.set(rc, arr);
  }
  const aliasesByRegion = new Map<string, AliasRow[]>();
  for (const al of legacyAliases) {
    const rc = String(al.region_code ?? "");
    if (!rc) continue;
    const arr = aliasesByRegion.get(rc) ?? [];
    arr.push(al);
    aliasesByRegion.set(rc, arr);
  }

  const candidates: Candidate[] = [];

  for (const region of legacyRegions) {
    const rc = region.region_code;
    const areas = areasByRegion.get(rc) ?? [];
    const aliases = aliasesByRegion.get(rc) ?? [];

    const legacy_canonical_names = areas
      .map((a) => String(a.canonical_area ?? "").trim())
      .filter((s) => s.length > 0);
    const legacy_alias_names = aliases
      .map((al) => String(al.alias ?? "").trim())
      .filter((s) => s.length > 0);

    // De-duplicate name keys so two areas with same canonical (case
    // variants) report once. Track original display name per key for
    // human-readable reasons.
    const nameByKey = new Map<string, string>();
    for (const n of [...legacy_canonical_names, ...legacy_alias_names]) {
      const k = normName(n);
      if (!k) continue;
      if (!nameByKey.has(k)) nameByKey.set(k, n);
    }

    const references: Reference[] = [];
    const orphan_risk_names: string[] = [];

    for (const [key, displayName] of nameByKey.entries()) {
      const pa = providerCountByKey.get(key) ?? 0;
      const tk = tasksCountByKey.get(key) ?? 0;
      const rv = reviewCountByKey.get(key) ?? 0;
      if (pa > 0) {
        references.push({
          table: "provider_areas",
          legacy_name: displayName,
          key,
          count: pa,
        });
      }
      if (tk > 0) {
        references.push({
          table: "tasks",
          legacy_name: displayName,
          key,
          count: tk,
        });
      }
      if (rv > 0) {
        references.push({
          table: "area_review_queue",
          legacy_name: displayName,
          key,
          count: rv,
        });
      }
      // The orphan rule: a referenced name with no active JOD twin
      // would lose its mapping if we deleted the legacy metadata.
      if (pa + tk + rv > 0 && !activeJodKeys.has(key)) {
        orphan_risk_names.push(displayName);
      }
    }

    const common: CandidateCommon = {
      region_code: rc,
      region_name: region.region_name,
      legacy_area_codes: areas.map((a) => a.area_code),
      legacy_alias_codes: aliases.map((al) => al.alias_code),
      legacy_canonical_names,
      legacy_alias_names,
      references,
      orphan_risk_names,
    };

    if (orphan_risk_names.length > 0) {
      const summary = orphan_risk_names
        .slice(0, 5)
        .map((n) => `"${n}"`)
        .join(", ");
      const more =
        orphan_risk_names.length > 5
          ? ` (+${orphan_risk_names.length - 5} more)`
          : "";
      candidates.push({
        ...common,
        safe: false,
        skip_reason: `Legacy name(s) ${summary}${more} are referenced by downstream rows and have NO active JOD-* replacement; deletion would orphan them.`,
      });
    } else {
      candidates.push({ ...common, safe: true });
    }
  }

  return { ok: true, candidates };
}

function summarize(opts: {
  dryRun: boolean;
  force: boolean;
  candidates: Candidate[];
  deleted: DeletedRecord[];
  skipped: SkippedRecord[];
  warnings: ForceWarning[];
}) {
  const { dryRun, force, candidates, deleted, skipped, warnings } = opts;
  const counts = {
    regionsFound: candidates.length,
    regionsDeleted: deleted.length,
    regionsSkipped: skipped.length,
    areasDeleted: deleted.reduce((n, d) => n + d.areas_deleted, 0),
    aliasesDeleted: deleted.reduce((n, d) => n + d.aliases_deleted, 0),
  };
  return {
    ok: true,
    dryRun,
    force,
    candidates: candidates.map((c) => ({
      region_code: c.region_code,
      region_name: c.region_name,
      safe: c.safe,
      legacy_area_count: c.legacy_area_codes.length,
      legacy_alias_count: c.legacy_alias_codes.length,
      references: c.references.map((r) => ({
        table: r.table,
        legacy_name: r.legacy_name,
        count: r.count,
      })),
      orphan_risk_names: c.orphan_risk_names,
      skip_reason: c.safe ? null : c.skip_reason,
    })),
    warnings,
    deleted,
    skipped,
    counts,
  };
}

function parseDryRun(url: URL): boolean {
  const raw = url.searchParams.get("dryRun");
  if (raw === null) return true;
  const v = raw.trim().toLowerCase();
  // Only the literal "false" disables dry-run. Anything else (typos,
  // empty, "0", "no") falls back to dry-run for safety.
  return v !== "false";
}

function parseForce(url: URL): boolean {
  const raw = url.searchParams.get("force");
  if (raw === null) return false;
  // Mirror parseDryRun's strict literal semantics — only "true"
  // enables force. Default off so missing/typo never escalates.
  return raw.trim().toLowerCase() === "true";
}

// GET — always dry-run, never force. Convenient for the UI's first click.
export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const plan = await buildPlan();
  if (!plan.ok) return plan.response;

  return NextResponse.json(
    summarize({
      dryRun: true,
      force: false,
      candidates: plan.candidates,
      deleted: [],
      skipped: [],
      warnings: [],
    })
  );
}

// POST — honors ?dryRun and ?force.
//
//   dryRun=true (default)            → no deletions, plan returned as-is.
//   dryRun=false, force=false        → guarded delete: safe candidates
//                                      only; orphan-risk regions are
//                                      skipped with reason.
//   dryRun=false, force=true         → force delete: deletes legacy R-*
//                                      catalog rows even when references
//                                      exist. provider_areas, tasks,
//                                      and area_review_queue rows are
//                                      NEVER touched here — see the
//                                      response `warnings` for what
//                                      was left in place.
//
// Hard preconditions (enforced server-side regardless of ?force):
//   service_regions.city_code   = 'JOD'
//   service_regions.region_code LIKE 'R-%'   (never 'JOD-%')
//   service_regions.active      = false
//
// Each region runs in its own try/catch so one failing delete does not
// abort the rest. Deletion order is aliases → areas → region because
// the *_areas and *_aliases tables reference service_regions(region_code)
// with default RESTRICT semantics.
export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const url = new URL(request.url);
  const dryRun = parseDryRun(url);
  const force = parseForce(url);

  const plan = await buildPlan();
  if (!plan.ok) return plan.response;

  if (dryRun) {
    // Dry-run never escalates regardless of ?force. The plan returned
    // reflects guarded posture; the caller must re-issue with both
    // dryRun=false AND force=true to actually force-delete.
    return NextResponse.json(
      summarize({
        dryRun: true,
        force,
        candidates: plan.candidates,
        deleted: [],
        skipped: [],
        warnings: [],
      })
    );
  }

  const deleted: DeletedRecord[] = [];
  const skipped: SkippedRecord[] = [];
  const warnings: ForceWarning[] = [];

  for (const cand of plan.candidates) {
    // Guarded mode (force=false): keep the orphan-risk skip behavior
    // exactly as before. Force mode (force=true): drop the guard but
    // record a warning so the response makes the bypass explicit.
    if (!cand.safe) {
      if (!force) {
        skipped.push({
          region_code: cand.region_code,
          region_name: cand.region_name,
          reason: cand.skip_reason,
          orphan_risk_names: cand.orphan_risk_names,
          reference_counts: cand.references.map((r) => ({
            table: r.table,
            name: r.legacy_name,
            count: r.count,
          })),
        });
        continue;
      }
      warnings.push({
        region_code: cand.region_code,
        region_name: cand.region_name,
        orphan_risk_names: cand.orphan_risk_names,
        reference_counts: cand.references.map((r) => ({
          table: r.table,
          name: r.legacy_name,
          count: r.count,
        })),
      });
    }

    try {
      let aliasesDeleted = 0;
      let areasDeleted = 0;

      if (cand.legacy_alias_codes.length > 0) {
        const { data, error } = await adminSupabase
          .from("service_region_area_aliases")
          .delete()
          .eq("region_code", cand.region_code)
          .eq("city_code", CITY_CODE)
          .select("alias_code");
        if (error) throw new Error(`aliases: ${error.message}`);
        aliasesDeleted = (data ?? []).length;
      }

      if (cand.legacy_area_codes.length > 0) {
        const { data, error } = await adminSupabase
          .from("service_region_areas")
          .delete()
          .eq("region_code", cand.region_code)
          .eq("city_code", CITY_CODE)
          .select("area_code");
        if (error) throw new Error(`areas: ${error.message}`);
        areasDeleted = (data ?? []).length;
      }

      {
        // Re-asserts active=false at the DELETE so an in-flight
        // re-activate from another admin window cannot be clobbered.
        const { error } = await adminSupabase
          .from("service_regions")
          .delete()
          .eq("region_code", cand.region_code)
          .eq("city_code", CITY_CODE)
          .eq("active", false);
        if (error) throw new Error(`region: ${error.message}`);
      }

      deleted.push({
        region_code: cand.region_code,
        region_name: cand.region_name,
        aliases_deleted: aliasesDeleted,
        areas_deleted: areasDeleted,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({
        region_code: cand.region_code,
        region_name: cand.region_name,
        reason: `DELETE_FAILED: ${msg}`,
        orphan_risk_names: [],
        reference_counts: [],
      });
    }
  }

  // Drop the public /api/areas cache so the homepage / chip lists do
  // not serve a stale snapshot that still mentions deleted regions.
  // The cache is keyed by city; cleanup is city-scoped (JOD).
  if (deleted.length > 0) {
    invalidateAreasCacheByCity();
    // Admin dashboard AreaTab snapshot — only JOD legacy regions are
    // in scope of this route, so we always invalidate the JOD key.
    await invalidateSnapshots([`area_stats.${CITY_CODE}`]);
  }

  return NextResponse.json(
    summarize({
      dryRun: false,
      force,
      candidates: plan.candidates,
      deleted,
      skipped,
      warnings,
    })
  );
}
