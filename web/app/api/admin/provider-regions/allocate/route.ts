import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/adminAuth";
import {
  resolveAreasToRegions,
  type AreaRegionResolution,
} from "@/lib/geo/areaRegionResolver";
import { queueUnmappedAreaForReview } from "@/lib/admin/adminUnmappedAreas";

// Phase 3 — Provider Region Allocation bulk allocator.
//
// Reads every provider_areas row where city_code='JOD' AND region_code IS
// NULL, resolves each area against the JOD service-region catalog, and
// (when not in dry-run) populates region_code for the rows whose area
// resolves unambiguously. Unresolved / ambiguous rows stay NULL — they're
// reported back and (on commit) enqueued in area_review_queue so admins
// can decide what to do.
//
// ──────────────────────────────────────────────────────────────────────
// Safety posture
// ──────────────────────────────────────────────────────────────────────
//   • Admin-only (requireAdminSession).
//   • Service-role Supabase only.
//   • Default is dry-run. Only POST + explicit ?dryRun=false commits.
//   • UPDATE WHERE city_code='JOD' AND region_code IS NULL — never
//     overwrites a row that already has a region_code, never disturbs
//     non-JOD cities.
//   • Never UPDATEs the `area` text. Never DELETEs.
//   • Never truncates regions for over-plan providers. Over-plan is
//     reported only; admin reconciles separately.
//
// ──────────────────────────────────────────────────────────────────────
// Performance
// ──────────────────────────────────────────────────────────────────────
//   • provider_areas is paged through in PAGE_SIZE chunks.
//   • resolveAreasToRegions loads the catalog ONCE and is called ONCE
//     with the deduped raw area list — O(1) catalog reads regardless of
//     row count.
//   • UPDATEs are grouped by target region_code: one UPDATE per
//     populated region (≤ 25 regions for JOD), each scoped to
//     `area IN (raw strings that resolved to that region)`.
//   • provider_plans is fetched in a single IN-list query.

export const runtime = "nodejs";

const CITY_CODE = "JOD";
const PAGE_SIZE = 1000;
// PostgREST in-clause has practical limits; 500 raw area strings keeps
// us well below any URL/payload ceiling the runtime may impose.
const UPDATE_CHUNK_SIZE = 500;
// Stop runaway summaries at this many distinct unresolved/ambiguous
// areas in the response — full list is still acted upon for queue
// enqueue; this only caps what we ship back in the JSON.
const MAX_EXAMPLES = 50;

type ProviderAreaRow = {
  provider_id: string;
  area: string;
  region_code: string | null;
};

type ProviderPlanRow = {
  provider_id: string;
  plan_code: string | null;
  max_regions: number | null;
};

type RegionAggregate = {
  resolvedRows: number;
  providers: Set<string>;
};

type AmbiguousAggregate = {
  count: number;
  possibleRegions: Set<string>;
};

type AllocationPlan = {
  scannedRows: number;
  alreadyAllocatedRows: number;
  // distinct providers seen (any city_code='JOD' row, with or without
  // region_code) — included so summaries can put providersAffected in
  // context.
  distinctProvidersScanned: Set<string>;
  // (raw area exact-as-stored → region_code) for rows that should be
  // updated on commit. The key is the raw area string used in the IN
  // clause; the value is the target region_code.
  resolved: Map<string, string>;
  // Per-region rollup of the resolved set.
  byRegion: Map<string, RegionAggregate>;
  // Unresolved areas: raw → number of rows. Surfaces in summary AND
  // gets enqueued on commit.
  unresolved: Map<string, number>;
  // Ambiguous areas: raw → { count, possible regions list }.
  ambiguous: Map<string, AmbiguousAggregate>;
  // Distinct provider_ids touched by the resolved set (will be
  // populated by row updates).
  providersAffected: Set<string>;
};

type OverPlanProvider = {
  provider_id: string;
  regionCount: number;
  maxRegions: number;
  plan_code: string;
};

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

// Strict literal: only "false" disables dry-run; anything else (typo,
// empty, "0") falls back to dry-run for safety. Mirrors the convention
// in /api/admin/area-intelligence/cleanup-legacy-regions.
function parseDryRunQuery(url: URL): boolean {
  const raw = url.searchParams.get("dryRun");
  if (raw === null) return true;
  return raw.trim().toLowerCase() !== "false";
}

function parseDryRunBody(body: Record<string, unknown> | null): boolean | null {
  if (!body || typeof body !== "object") return null;
  const v = body.dryRun;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() !== "false";
  return null;
}

// Stream provider_areas in PAGE_SIZE pages so we don't lift millions of
// rows into memory at once. Returns the full ordered list when done.
async function fetchAllProviderAreas(): Promise<
  { ok: true; rows: ProviderAreaRow[] } | { ok: false; error: string }
> {
  const out: ProviderAreaRow[] = [];
  let from = 0;
  // Page until a returned chunk is smaller than PAGE_SIZE — that's the
  // last page. Bounded; an unusually-sized provider_areas would just
  // page longer.
  for (;;) {
    const { data, error } = await adminSupabase
      .from("provider_areas")
      .select("provider_id, area, region_code")
      .eq("city_code", CITY_CODE)
      .order("provider_id", { ascending: true })
      .order("area", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, error: error.message };
    const chunk = (data ?? []) as ProviderAreaRow[];
    for (const r of chunk) {
      out.push({
        provider_id: String(r.provider_id ?? "").trim(),
        area: String(r.area ?? ""),
        region_code:
          typeof r.region_code === "string" && r.region_code.trim()
            ? r.region_code.trim()
            : null,
      });
    }
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { ok: true, rows: out };
}

// Returns the plan map keyed by provider_id. Providers without a row
// resolve to the default {plan_code:'free', max_regions:1} implied by
// effectivePlan — we mirror that default here without importing the
// helper because we don't need the period-expiry logic for over-plan
// reporting (max_regions is what enforces the cap).
async function fetchPlansForProviders(
  providerIds: string[]
): Promise<Map<string, { plan_code: string; max_regions: number }>> {
  const out = new Map<string, { plan_code: string; max_regions: number }>();
  if (providerIds.length === 0) return out;
  // PostgREST in-clause: chunk to be safe with extremely large provider
  // counts (every JOD-active provider in one shot is fine today; this
  // future-proofs the call).
  for (let i = 0; i < providerIds.length; i += UPDATE_CHUNK_SIZE) {
    const slice = providerIds.slice(i, i + UPDATE_CHUNK_SIZE);
    const { data } = await adminSupabase
      .from("provider_plans")
      .select("provider_id, plan_code, max_regions")
      .in("provider_id", slice);
    for (const row of (data ?? []) as ProviderPlanRow[]) {
      out.set(String(row.provider_id), {
        plan_code: String(row.plan_code ?? "free"),
        max_regions:
          typeof row.max_regions === "number" && row.max_regions >= 1
            ? row.max_regions
            : 1,
      });
    }
  }
  return out;
}

// Builds the plan from the loaded rows + a single batched resolver call.
// Pure — no DB writes. Returns the structures the summary + commit
// paths both need.
function buildAllocationPlan(
  rows: ProviderAreaRow[],
  resolutions: Map<string, AreaRegionResolution>
): AllocationPlan {
  const plan: AllocationPlan = {
    scannedRows: rows.length,
    alreadyAllocatedRows: 0,
    distinctProvidersScanned: new Set<string>(),
    resolved: new Map(),
    byRegion: new Map(),
    unresolved: new Map(),
    ambiguous: new Map(),
    providersAffected: new Set<string>(),
  };

  for (const row of rows) {
    if (row.provider_id) plan.distinctProvidersScanned.add(row.provider_id);

    if (row.region_code) {
      plan.alreadyAllocatedRows += 1;
      continue;
    }

    const r = resolutions.get(row.area);
    if (!r) {
      // Empty area or otherwise dropped by resolveAreasToRegions (it
      // filters empty strings). Treat as unresolved so the operator
      // can see it.
      const key = row.area;
      plan.unresolved.set(key, (plan.unresolved.get(key) ?? 0) + 1);
      continue;
    }

    if (r.resolved) {
      plan.resolved.set(row.area, r.region_code);
      const agg = plan.byRegion.get(r.region_code) ?? {
        resolvedRows: 0,
        providers: new Set<string>(),
      };
      agg.resolvedRows += 1;
      if (row.provider_id) agg.providers.add(row.provider_id);
      plan.byRegion.set(r.region_code, agg);
      if (row.provider_id) plan.providersAffected.add(row.provider_id);
      continue;
    }

    if (r.reason === "ambiguous") {
      const existing = plan.ambiguous.get(row.area) ?? {
        count: 0,
        possibleRegions: new Set<string>(),
      };
      existing.count += 1;
      // possibleRegions for an "ambiguous" verdict isn't surfaced by
      // the resolver today (it returns reason only). We could re-query
      // the catalog to enumerate them, but that's an N+1 anti-pattern
      // for a summary endpoint. Leave empty for v1 — admin can inspect
      // via the existing area-intelligence UI.
      plan.ambiguous.set(row.area, existing);
      continue;
    }

    // r.reason === "unresolved"
    plan.unresolved.set(row.area, (plan.unresolved.get(row.area) ?? 0) + 1);
  }

  return plan;
}

// Projects post-allocation distinct region count per provider so we can
// flag over-plan providers in the summary. Combines:
//   • region_codes already on the provider's rows (NON-NULL today)
//   • region_codes about to be assigned by this allocator
// Returns sorted region-count tuples grouped by provider_id.
function projectProviderRegionSets(
  rows: ProviderAreaRow[],
  resolved: Map<string, string>
): Map<string, Set<string>> {
  const proj = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.provider_id) continue;
    const set = proj.get(row.provider_id) ?? new Set<string>();
    if (row.region_code) set.add(row.region_code);
    if (!row.region_code) {
      const rc = resolved.get(row.area);
      if (rc) set.add(rc);
    }
    proj.set(row.provider_id, set);
  }
  return proj;
}

function computeOverPlanProviders(
  projected: Map<string, Set<string>>,
  plans: Map<string, { plan_code: string; max_regions: number }>
): OverPlanProvider[] {
  const out: OverPlanProvider[] = [];
  for (const [providerId, regions] of projected.entries()) {
    const plan = plans.get(providerId) ?? { plan_code: "free", max_regions: 1 };
    if (regions.size > plan.max_regions) {
      out.push({
        provider_id: providerId,
        regionCount: regions.size,
        maxRegions: plan.max_regions,
        plan_code: plan.plan_code,
      });
    }
  }
  // Sort by largest violation first, then by provider_id for determinism.
  out.sort((a, b) => {
    const aDelta = a.regionCount - a.maxRegions;
    const bDelta = b.regionCount - b.maxRegions;
    if (aDelta !== bDelta) return bDelta - aDelta;
    return a.provider_id.localeCompare(b.provider_id);
  });
  return out;
}

// Commits resolved assignments. One UPDATE per target region_code,
// scoped to (city_code='JOD' AND region_code IS NULL AND area IN [raw strings]).
// PostgREST IN lists are chunked at UPDATE_CHUNK_SIZE for very large
// region cohorts. Returns the cumulative rows-updated count.
async function applyResolvedUpdates(
  byRegion: Map<string, RegionAggregate>,
  resolved: Map<string, string>
): Promise<{ ok: true; updatedRows: number } | { ok: false; error: string }> {
  // Group the resolved Map by region_code so we can UPDATE per region.
  const areasByRegion = new Map<string, string[]>();
  for (const [area, region] of resolved.entries()) {
    const list = areasByRegion.get(region) ?? [];
    list.push(area);
    areasByRegion.set(region, list);
  }

  let total = 0;
  for (const [region, areas] of areasByRegion.entries()) {
    // Sanity: byRegion and areasByRegion should agree on which regions
    // are populated. If they diverge it's a logic bug; abort loudly.
    if (!byRegion.has(region)) {
      return {
        ok: false,
        error: `Internal: byRegion missing target ${region}`,
      };
    }
    for (let i = 0; i < areas.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = areas.slice(i, i + UPDATE_CHUNK_SIZE);
      const { error, count } = await adminSupabase
        .from("provider_areas")
        .update({ region_code: region }, { count: "exact" })
        .eq("city_code", CITY_CODE)
        .is("region_code", null)
        .in("area", chunk);
      if (error) return { ok: false, error: error.message };
      total += count ?? 0;
    }
  }
  return { ok: true, updatedRows: total };
}

// Enqueues unresolved + ambiguous raw areas into area_review_queue. Uses
// the existing helper so the dedup-by-normalized-key logic and the
// occurrences counter match the rest of the system. Failures are
// non-fatal individually but counted in the response so the operator
// can re-run if a transient queue-write blip is suspected.
async function enqueueUnmappedBatch(
  unresolved: Map<string, number>,
  ambiguous: Map<string, AmbiguousAggregate>
): Promise<{ enqueued: number; failed: number }> {
  const tasks: Array<Promise<void>> = [];
  for (const area of unresolved.keys()) {
    if (!area.trim()) continue;
    tasks.push(
      queueUnmappedAreaForReview({
        rawArea: area,
        sourceType: "bulk_allocator",
        sourceRef: "unresolved",
      })
    );
  }
  for (const area of ambiguous.keys()) {
    if (!area.trim()) continue;
    tasks.push(
      queueUnmappedAreaForReview({
        rawArea: area,
        sourceType: "bulk_allocator",
        sourceRef: "ambiguous",
      })
    );
  }
  const results = await Promise.allSettled(tasks);
  let enqueued = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") enqueued += 1;
    else failed += 1;
  }
  return { enqueued, failed };
}

// Shared response shaper. dryRun=true callers omit `updatedRows`;
// dryRun=false callers include it. Examples lists are capped at
// MAX_EXAMPLES so the response doesn't balloon on a fresh DB.
function buildSummary(args: {
  dryRun: boolean;
  plan: AllocationPlan;
  overPlanProviders: OverPlanProvider[];
  updatedRows?: number;
  enqueueOutcome?: { enqueued: number; failed: number };
}): Record<string, unknown> {
  const { dryRun, plan, overPlanProviders, updatedRows, enqueueOutcome } = args;

  const regions = Array.from(plan.byRegion.entries())
    .map(([region_code, agg]) => ({
      region_code,
      resolvedRows: agg.resolvedRows,
      distinctProviders: agg.providers.size,
    }))
    .sort((a, b) => a.region_code.localeCompare(b.region_code));

  const unresolvedExamples = Array.from(plan.unresolved.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXAMPLES)
    .map(([area, count]) => ({ area, count }));

  const ambiguousExamples = Array.from(plan.ambiguous.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_EXAMPLES)
    .map(([area, agg]) => ({
      area,
      possibleRegions: Array.from(agg.possibleRegions).sort(),
      count: agg.count,
    }));

  // Total rows that would update / did update (sum of per-region rows).
  let resolvedRows = 0;
  for (const r of plan.byRegion.values()) resolvedRows += r.resolvedRows;

  let unresolvedRows = 0;
  for (const n of plan.unresolved.values()) unresolvedRows += n;

  let ambiguousRows = 0;
  for (const a of plan.ambiguous.values()) ambiguousRows += a.count;

  const out: Record<string, unknown> = {
    ok: true,
    dryRun,
    scannedRows: plan.scannedRows,
    resolvedRows,
    unresolvedRows,
    ambiguousRows,
    alreadyAllocatedRows: plan.alreadyAllocatedRows,
    distinctProvidersScanned: plan.distinctProvidersScanned.size,
    providersAffected: plan.providersAffected.size,
    regions,
    unresolvedExamples,
    ambiguousExamples,
    overPlanProviders,
  };
  if (typeof updatedRows === "number") {
    out.updatedRows = updatedRows;
  }
  if (enqueueOutcome) {
    out.unmappedQueue = enqueueOutcome;
  }
  return out;
}

// Shared work for both GET and POST. Returns the JSON-ready response
// (always wrapped in NextResponse by the caller so errors keep their
// status codes).
async function runAllocator(
  dryRun: boolean
): Promise<{ ok: true; response: NextResponse } | { ok: false; response: NextResponse }> {
  const rowsRes = await fetchAllProviderAreas();
  if (!rowsRes.ok) return { ok: false, response: dbError(rowsRes.error) };

  // Resolve the deduped raw area set ONCE. Catalog read is O(catalog),
  // independent of row count.
  const distinctAreas = Array.from(
    new Set(
      rowsRes.rows
        .filter((r) => !r.region_code)
        .map((r) => r.area)
    )
  );
  const resolutions =
    distinctAreas.length === 0
      ? new Map<string, AreaRegionResolution>()
      : await resolveAreasToRegions(adminSupabase, {
          areas: distinctAreas,
          cityCode: CITY_CODE,
        });

  const plan = buildAllocationPlan(rowsRes.rows, resolutions);

  const providerIds = Array.from(plan.distinctProvidersScanned);
  const plans = await fetchPlansForProviders(providerIds);
  const projected = projectProviderRegionSets(rowsRes.rows, plan.resolved);
  const overPlan = computeOverPlanProviders(projected, plans);

  if (dryRun) {
    return {
      ok: true,
      response: NextResponse.json(
        buildSummary({ dryRun: true, plan, overPlanProviders: overPlan })
      ),
    };
  }

  // Commit path: update DB, then enqueue unresolved/ambiguous.
  const updateRes = await applyResolvedUpdates(plan.byRegion, plan.resolved);
  if (!updateRes.ok) return { ok: false, response: dbError(updateRes.error) };

  const enqueueOutcome = await enqueueUnmappedBatch(
    plan.unresolved,
    plan.ambiguous
  );

  return {
    ok: true,
    response: NextResponse.json(
      buildSummary({
        dryRun: false,
        plan,
        overPlanProviders: overPlan,
        updatedRows: updateRes.updatedRows,
        enqueueOutcome,
      })
    ),
  };
}

// GET — always dry-run, convenient first click from an admin UI.
export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();
  const out = await runAllocator(true);
  return out.response;
}

// POST — honors ?dryRun query param OR { dryRun: boolean } in the body.
// Default is dry-run; only an explicit dryRun=false (string or boolean)
// commits.
export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const url = new URL(request.url);
  let dryRun = parseDryRunQuery(url);

  // Body is optional; a JSON body { dryRun: false } overrides the query
  // string default. Malformed JSON is tolerated — falls back to whatever
  // the query string said.
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    const bodyDryRun = parseDryRunBody(body);
    if (bodyDryRun !== null) dryRun = bodyDryRun;
  } catch {
    // Empty / non-JSON body is fine for GET-style POSTs.
  }

  const out = await runAllocator(dryRun);
  return out.response;
}
