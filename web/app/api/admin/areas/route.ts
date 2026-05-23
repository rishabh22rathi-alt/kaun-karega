import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  resolveCityParam,
  InvalidCityCodeError,
} from "@/lib/cities/cityContext";
import { buildVerifiedProviderSet } from "@/lib/admin/verifiedProviders";
import { buildProvidersUnderReview } from "@/lib/admin/adminProviderReview";
import {
  readThroughSnapshotCache,
  invalidateSnapshots,
} from "@/lib/admin/snapshotCache";

// Stage A snapshot cache for AreaTab. Whole response payload (regions
// + areas + aliases + pending area requests) is cached per-city under
// "area_stats.<city_code>" with a 6-hour TTL. ?refresh=1 forces
// recompute. Region/area/alias/cleanup mutations invalidate
// area_stats.<city_code> (see those routes' invalidation calls).
const CACHE_TTL_SECONDS = 6 * 60 * 60;

// Stage 2 toggle — the "Unmapped Provider Areas" UI in AreaTab is
// currently hidden (see AreaTab.tsx, the JSX block was removed during
// the JOD-25 migration cleanup). While the UI is hidden, computing the
// unmapped_provider_areas array and shipping it in the response is
// wasted JS work + wasted HTTP bandwidth. Flip this to `true` once the
// provider-allocation phase brings the section back; no other code
// change is required because the per-region density loop preserves the
// same iteration shape either way.
const INCLUDE_UNMAPPED_PROVIDER_AREAS = false;

// GET /api/admin/areas
// Returns regions + canonical areas (each with its currently-active aliases
// bundled) for the admin dashboard's Area accordion. Mirrors the shape of
// /api/admin/categories so AreaTab can use the same mental model as
// CategoryTab.
//
// Sources:
//   service_regions              — region_code, region_name, active
//   service_region_areas         — area_code, canonical_area, region_code, active
//   service_region_area_aliases  — alias_code, alias, canonical_area, region_code, active (all rows; Phase A4)
//
// Join is performed in JS on (lower(canonical_area), region_code) so a
// stray double-space or case drift in a stored value doesn't split an
// area from its aliases. Region name is hydrated from a code→name map.

export const runtime = "nodejs";

const MAX_ROWS = 5000;
// provider_areas is the largest table read here. ~thousands today; cap
// generously to avoid silent truncation if it grows.
const PROVIDER_AREAS_LIMIT = 20000;

type RegionRow = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
};

type RegionWithCounts = RegionRow & {
  provider_count: number;
  verified_provider_count: number;
};

// Mirrors adminAreaMappings.ts / adminDashboardStats.ts so cross-table
// joins collapse the same way live matching does (case + whitespace +
// punctuation drift). Inlined to avoid taking a new dependency on
// adminAreaMappings (out of scope per spec).
const toAreaKey = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// Verified predicate REMOVED. The legacy text-column check
// (providers.verified === "yes") over-counted imported / never-logged-in
// providers and drifted from the dashboard tile. Verified counting now
// goes through buildVerifiedProviderSet() — see
// web/lib/admin/verifiedProviders.ts for the canonical rule.

type AliasOut = {
  id: string;
  alias_code: string;
  alias: string;
  active: boolean;
  notes: string | null;
};

type AreaOut = {
  area_code: string;
  canonical_area: string;
  region_code: string;
  region_name: string | null;
  active: boolean;
  notes: string | null;
  aliases: AliasOut[];
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const pairKey = (canonical: unknown, region: unknown) =>
  `${norm(canonical)}||${String(region ?? "")}`;

// Cached payload shape — exactly what the GET response embedded in
// `data` returns. The cache helper is generic over this; matters
// because the route puts these fields at the response root for
// backward compatibility with the AreaTab fetch.
type AreaStatsPayload = {
  city_code: string;
  regions: RegionWithCounts[];
  areas: AreaOut[];
  unmapped_provider_areas: Array<{ area: string; provider_count: number }>;
  pending_area_requests: Array<{
    review_id: string;
    raw_area: string;
    occurrences: number;
    source_ref: string | null;
    source_type: string | null;
    last_seen_at: string | null;
    submitter_name: string | null;
    submitter_phone: string | null;
  }>;
};

export async function GET(request: Request) {
  // Stage 1 timing — every log line is prefixed [admin-perf] for grep.
  const tRoute0 = Date.now();
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Phase 1.1: city-aware catalog reads. Default-fallback on missing
  // ?city= preserves today's behavior exactly (JOD is the only active
  // city). Malformed/inactive ?city= returns 400 — the admin tab knows
  // its city; a bad code is a programmer error, not a typo.
  //
  // Scope deliberately stops at the three catalog tables + the review
  // queue. provider_areas and providers are NOT filtered:
  //   • provider_areas.city_code is still nullable (Phase 1.2 backfills
  //     writers); filtering here would drop density on canonicalization-
  //     rewritten rows that haven't acquired city_code yet.
  //   • providers has no city_code at all.
  // Density derives from the canonical/alias maps which ARE city-filtered
  // above, so a provider whose only mapped area is in another city
  // naturally falls out of the per-region counts without an extra filter.
  const url = new URL(request.url);
  let cityCode: string;
  try {
    const r = await resolveCityParam(url, { fallback: "reject" });
    cityCode = r.city_code;
  } catch (e) {
    if (e instanceof InvalidCityCodeError) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CITY_CODE", input: e.input },
        { status: 400 }
      );
    }
    throw e;
  }

  // ?refresh=1 forces a recompute, bypassing the snapshot cache.
  const forceRefresh = url.searchParams.get("refresh") === "1";

  // Heavy work — full Supabase read fan-out + JS-side aggregation —
  // lives inside a compute() closure so readThroughSnapshotCache can
  // hand us back a fresh payload OR a cached one transparently.
  // Errors thrown from inside compute() bubble out; the outer try
  // catches them and surfaces the 500 the same way the old route did.
  let payload: AreaStatsPayload;
  let cacheBlock: import("@/lib/admin/snapshotCache").CacheMetadata;
  try {
    const result = await readThroughSnapshotCache<AreaStatsPayload>({
      key: `area_stats.${cityCode}`,
      ttlSeconds: CACHE_TTL_SECONDS,
      forceRefresh,
      adminPhone: auth.admin.phone,
      compute: async (): Promise<AreaStatsPayload> => {
  const tFetch0 = Date.now();
  const [
    regionsRes,
    areasRes,
    aliasesRes,
    providerAreasRes,
    pendingReviewRes,
  ] = await Promise.all([
      adminSupabase
        .from("service_regions")
        .select("region_code, region_name, active, city_code")
        .eq("city_code", cityCode)
        .order("region_code", { ascending: true })
        .limit(MAX_ROWS),
      adminSupabase
        .from("service_region_areas")
        .select("area_code, canonical_area, region_code, active, notes, city_code")
        .eq("city_code", cityCode)
        .order("region_code", { ascending: true })
        .order("canonical_area", { ascending: true })
        .limit(MAX_ROWS),
      // Phase A4: load ALL aliases (active + inactive). The admin editor
      // now renders inactives differently and offers a re-enable affordance
      // so soft-disable behaves as soft-delete, not irreversible delete.
      // Public surfaces (resolve, suggest) continue to filter active=true
      // server-side; this query is admin-only.
      adminSupabase
        .from("service_region_area_aliases")
        .select(
          "id, alias_code, alias, canonical_area, region_code, active, notes, city_code"
        )
        .eq("city_code", cityCode)
        .order("alias", { ascending: true })
        .limit(MAX_ROWS),
      adminSupabase
        .from("provider_areas")
        .select("provider_id, area")
        .limit(PROVIDER_AREAS_LIMIT),
      adminSupabase
        .from("area_review_queue")
        .select(
          "review_id, raw_area, occurrences, source_ref, source_type, last_seen_at, city_code"
        )
        .eq("status", "pending")
        .eq("city_code", cityCode)
        .order("occurrences", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(200),
    ]);
  console.log(
    `[admin-perf] admin/areas initial Promise.all took ${
      Date.now() - tFetch0
    }ms (regions=${(regionsRes.data ?? []).length}, areas=${
      (areasRes.data ?? []).length
    }, aliases=${(aliasesRes.data ?? []).length}, provider_areas=${
      (providerAreasRes.data ?? []).length
    }, pending_review=${(pendingReviewRes.data ?? []).length})`
  );

  // Hard-fail only on the three core tables. Provider-density reads
  // fail soft: if either errors, regions still render and the counts
  // surface as 0 with a warning so admins see "0 / 0" instead of an
  // outright 500. Inside the snapshot-cache compute() we throw — the
  // outer GET wrapper turns the throw into the same DB_ERROR 500
  // shape callers saw before caching was wrapped around this route.
  if (regionsRes.error || areasRes.error || aliasesRes.error) {
    const err = regionsRes.error || areasRes.error || aliasesRes.error;
    throw new Error(`DB_ERROR: ${err?.message ?? "unknown"}`);
  }
  if (providerAreasRes.error) {
    console.warn(
      "[admin/areas] provider_areas read failed; counts will be 0",
      providerAreasRes.error
    );
  }
  if (pendingReviewRes.error) {
    console.warn(
      "[admin/areas] area_review_queue read failed; pending list empty",
      pendingReviewRes.error
    );
  }

  // Stage 2: build the under-review set ONCE here and pass it into the
  // canonical verified helper. Previously this route called
  // buildVerifiedProviderSet() with no args, which made the helper
  // internally call buildProvidersUnderReview() — a 3-table fan-out
  // (pending_category_requests, category_aliases, area_review_queue,
  // plus a providers hydrate). With the pre-built set passed through,
  // the helper skips that work entirely. /api/admin/provider-stats was
  // already wired this way; admin/areas now matches.
  const tUr0 = Date.now();
  let underReviewSet = new Set<string>();
  try {
    const review = await buildProvidersUnderReview();
    underReviewSet = review.providerIdSet;
  } catch (err) {
    console.warn(
      "[admin/areas] under-review aggregation failed; treating as empty",
      err instanceof Error ? err.message : err
    );
  }
  console.log(
    `[admin-perf] admin/areas buildProvidersUnderReview took ${
      Date.now() - tUr0
    }ms (size=${underReviewSet.size})`
  );

  // Canonical verified provider set (shared helper — matches the
  // dashboard tile exactly). Soft-fail to an empty set so a transient
  // DB error doesn't 500 the whole tab; the per-region counts will
  // show 0 verified in that case, which is correct conservative
  // behavior.
  const tVer0 = Date.now();
  let verifiedProviderIds = new Set<string>();
  try {
    verifiedProviderIds = await buildVerifiedProviderSet({ underReviewSet });
  } catch (err) {
    console.warn(
      "[admin/areas] verified provider set build failed; verified counts will be 0",
      err instanceof Error ? err.message : err
    );
  }
  console.log(
    `[admin-perf] admin/areas buildVerifiedProviderSet took ${
      Date.now() - tVer0
    }ms (verified_size=${verifiedProviderIds.size})`
  );

  // region_code → region_name lookup for hydration.
  const regionNameByCode = new Map<string, string | null>();
  for (const r of (regionsRes.data ?? []) as RegionRow[]) {
    regionNameByCode.set(r.region_code, r.region_name ?? null);
  }

  // Phase A4: group ALL aliases (active + inactive) by (canonical_area,
  // region_code). The client renders inactive ones with a muted/struck
  // treatment and surfaces a re-enable button. Provider density below
  // continues to count only active aliases.
  type AliasRowDb = {
    id: string;
    alias_code: string;
    alias: string | null;
    canonical_area: string | null;
    region_code: string | null;
    active: boolean | null;
    notes: string | null;
  };
  const aliasesByPair = new Map<string, AliasOut[]>();
  for (const row of (aliasesRes.data ?? []) as AliasRowDb[]) {
    const key = pairKey(row.canonical_area, row.region_code);
    const arr = aliasesByPair.get(key) ?? [];
    arr.push({
      id: row.id,
      alias_code: row.alias_code,
      alias: String(row.alias ?? ""),
      active: Boolean(row.active),
      notes: row.notes ?? null,
    });
    aliasesByPair.set(key, arr);
  }

  type AreaRowDb = {
    area_code: string;
    canonical_area: string | null;
    region_code: string | null;
    active: boolean | null;
    notes: string | null;
  };
  const areas: AreaOut[] = ((areasRes.data ?? []) as AreaRowDb[]).map((row) => {
    const region_code = String(row.region_code ?? "");
    const canonical_area = String(row.canonical_area ?? "");
    return {
      area_code: row.area_code,
      canonical_area,
      region_code,
      region_name: regionNameByCode.get(region_code) ?? null,
      active: Boolean(row.active),
      notes: row.notes ?? null,
      aliases: aliasesByPair.get(pairKey(canonical_area, region_code)) ?? [],
    };
  });

  // ── Provider density per region ─────────────────────────────────────
  // Mapping rule: a provider with a `provider_areas.area` value counts
  // toward every region whose `service_region_areas.canonical_area`
  // OR `service_region_area_aliases.alias` resolves to the same
  // normalized key. Cross-region duplicates (e.g. "Bhadwasiya" in both
  // R-04 and R-05, or an alias text used in two regions) intentionally
  // credit the provider to both — mirrors live matching.
  //
  // Set-of-provider-ids per region guarantees distinct counting even
  // when one provider covers multiple areas in the same region.

  // Map: canonical_area key → set of region_codes (for cross-region duplicates).
  const regionsByCanonicalKey = new Map<string, Set<string>>();
  type AreaRowDb2 = {
    canonical_area: string | null;
    region_code: string | null;
    active: boolean | null;
  };
  for (const row of (areasRes.data ?? []) as AreaRowDb2[]) {
    if (!row.active) continue; // inactive areas don't anchor density
    const k = toAreaKey(row.canonical_area);
    const rc = String(row.region_code ?? "");
    if (!k || !rc) continue;
    const set = regionsByCanonicalKey.get(k) ?? new Set<string>();
    set.add(rc);
    regionsByCanonicalKey.set(k, set);
  }

  // Map: alias key → set of region_codes. Active-only — Phase A4 stopped
  // pre-filtering aliasesRes server-side so the editor can render
  // inactives; provider density must still gate on active here to avoid
  // attributing providers via a disabled alias. An alias resolves the
  // provider_area to its parent canonical's region; we treat the alias
  // text itself as a key.
  const regionsByAliasKey = new Map<string, Set<string>>();
  type AliasRowDb2 = {
    alias: string | null;
    region_code: string | null;
    active: boolean | null;
  };
  for (const row of (aliasesRes.data ?? []) as AliasRowDb2[]) {
    if (row.active !== true) continue; // density: active aliases only
    const k = toAreaKey(row.alias);
    const rc = String(row.region_code ?? "");
    if (!k || !rc) continue;
    const set = regionsByAliasKey.get(k) ?? new Set<string>();
    set.add(rc);
    regionsByAliasKey.set(k, set);
  }

  // Resolve a provider_areas.area key to the union of regions it
  // touches via canonical OR alias mapping. Null when neither matches.
  const resolveRegionsForProviderKey = (k: string): Set<string> | null => {
    const c = regionsByCanonicalKey.get(k);
    const a = regionsByAliasKey.get(k);
    if (!c && !a) return null;
    if (c && !a) return c;
    if (!c && a) return a;
    // Union when both maps have the same key (rare; defensive).
    const merged = new Set<string>(c!);
    for (const rc of a!) merged.add(rc);
    return merged;
  };

  // Per-region provider Sets — built by walking provider_areas once.
  // When INCLUDE_UNMAPPED_PROVIDER_AREAS is true the same pass also
  // collects unmapped provider_areas (rows whose normalized key matches
  // no active service_region_areas canonical), grouped by raw area
  // string. While the AreaTab UI hides that section the unmapped
  // accumulator is skipped to save JS work and JSON payload.
  const tDensity0 = Date.now();
  const providersByRegion = new Map<string, Set<string>>();
  const verifiedByRegion = new Map<string, Set<string>>();
  const unmappedByRawArea: Map<string, Set<string>> | null =
    INCLUDE_UNMAPPED_PROVIDER_AREAS ? new Map<string, Set<string>>() : null;
  for (const row of (providerAreasRes.data ?? []) as Array<{
    provider_id: string | null;
    area: string | null;
  }>) {
    const providerId = String(row.provider_id ?? "").trim();
    const rawArea = String(row.area ?? "").trim();
    const k = toAreaKey(rawArea);
    if (!providerId || !k) continue;
    // A provider_area is "mapped" if its normalized key matches a
    // canonical OR an alias. Adding an alias for an unmapped string
    // effectively maps it from the next response onward.
    const regions = resolveRegionsForProviderKey(k);
    if (!regions || regions.size === 0) {
      // Unmapped — group by raw display string so casing/spacing
      // variants surface separately (the cleanup target). Skipped
      // entirely when the UI section is hidden (see flag above).
      if (unmappedByRawArea && rawArea) {
        const set = unmappedByRawArea.get(rawArea) ?? new Set<string>();
        set.add(providerId);
        unmappedByRawArea.set(rawArea, set);
      }
      continue;
    }
    const verified = verifiedProviderIds.has(providerId);
    for (const rc of regions) {
      const s = providersByRegion.get(rc) ?? new Set<string>();
      s.add(providerId);
      providersByRegion.set(rc, s);
      if (verified) {
        const vs = verifiedByRegion.get(rc) ?? new Set<string>();
        vs.add(providerId);
        verifiedByRegion.set(rc, vs);
      }
    }
  }

  // Sort unmapped by provider_count desc, then alphabetically on tie.
  // Cap at 50 — the long tail is bounded but the admin only needs the
  // high-impact rows. When the flag is off the array is just [].
  const unmapped_provider_areas = unmappedByRawArea
    ? [...unmappedByRawArea.entries()]
        .map(([area, providerSet]) => ({
          area,
          provider_count: providerSet.size,
        }))
        .sort((a, b) => {
          if (b.provider_count !== a.provider_count)
            return b.provider_count - a.provider_count;
          return a.area.localeCompare(b.area);
        })
        .slice(0, 50)
    : ([] as Array<{ area: string; provider_count: number }>);
  console.log(
    `[admin-perf] admin/areas density loop took ${
      Date.now() - tDensity0
    }ms (unmapped_enabled=${INCLUDE_UNMAPPED_PROVIDER_AREAS}, unmapped_returned=${
      unmapped_provider_areas.length
    })`
  );

  const regions: RegionWithCounts[] = (regionsRes.data ?? []).map((r) => {
    const rc = (r as RegionRow).region_code;
    return {
      region_code: rc,
      region_name: (r as RegionRow).region_name,
      active: (r as RegionRow).active,
      provider_count: providersByRegion.get(rc)?.size ?? 0,
      verified_provider_count: verifiedByRegion.get(rc)?.size ?? 0,
    };
  });

  // Hydrate pending area requests with submitter info. The providers
  // table is no longer pre-loaded by this route (verified counting
  // moved to the shared helper), so we do one targeted lookup scoped
  // to the submitter ids we actually need — keeps the GET cheap when
  // the queue is empty.
  type ProviderMini = { provider_id: string; full_name?: string; phone?: string };
  const providerInfoById = new Map<string, ProviderMini>();
  type PendingReviewRow = {
    review_id: string;
    raw_area: string | null;
    occurrences: number | null;
    source_ref: string | null;
    source_type: string | null;
    last_seen_at: string | null;
  };
  const pendingRows = (pendingReviewRes.data ?? []) as PendingReviewRow[];
  const submitterIds = Array.from(
    new Set(
      pendingRows
        .map((r) => String(r.source_ref ?? "").trim())
        .filter(Boolean)
    )
  );
  if (submitterIds.length > 0) {
    const { data: submitters } = await adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .in("provider_id", submitterIds);
    for (const s of (submitters ?? []) as ProviderMini[]) {
      const id = String(s.provider_id ?? "").trim();
      if (id) providerInfoById.set(id, s);
    }
  }
  const pending_area_requests = pendingRows
    .filter((r) => String(r.raw_area ?? "").trim().length > 0)
    .map((r) => {
      const ref = String(r.source_ref ?? "").trim();
      const info = ref ? providerInfoById.get(ref) : undefined;
      return {
        review_id: r.review_id,
        raw_area: String(r.raw_area ?? "").trim(),
        occurrences: Number(r.occurrences ?? 0),
        source_ref: ref || null,
        source_type: String(r.source_type ?? "").trim() || null,
        last_seen_at: String(r.last_seen_at ?? "").trim() || null,
        submitter_name: info?.full_name ?? null,
        submitter_phone: info?.phone ?? null,
      };
    });

        return {
          city_code: cityCode,
          regions,
          areas,
          unmapped_provider_areas,
          pending_area_requests,
        };
      },
    });
    payload = result.payload;
    cacheBlock = result.cache;
  } catch (err) {
    const message = err instanceof Error ? err.message : "compute failed";
    const detail = message.startsWith("DB_ERROR:")
      ? message.slice("DB_ERROR:".length).trim()
      : message;
    console.error(`[admin-perf] admin/areas compute failed: ${message}`);
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail },
      { status: 500 }
    );
  }

  console.log(
    `[admin-perf] admin/areas route TOTAL ${
      Date.now() - tRoute0
    }ms (city=${cityCode}, regions=${payload.regions.length}, areas=${
      payload.areas.length
    }, pending_review=${payload.pending_area_requests.length}, cached=${
      cacheBlock.cached
    }, refresh=${forceRefresh})`
  );
  return NextResponse.json({
    ok: true,
    city_code: payload.city_code,
    regions: payload.regions,
    areas: payload.areas,
    unmapped_provider_areas: payload.unmapped_provider_areas,
    pending_area_requests: payload.pending_area_requests,
    cache: cacheBlock,
  });
}

// POST /api/admin/areas
// Single sub-action today: { action: "resolve_review", review_id,
// resolved_canonical_area } marks an area_review_queue row resolved
// after the admin has already created the matching area or alias via
// /api/admin/area-intelligence. Kept narrow so this endpoint stays a
// pure data-shape utility.
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

  const action = String(body.action ?? "").toLowerCase();
  if (action !== "resolve_review") {
    return NextResponse.json(
      { ok: false, error: "INVALID_ACTION" },
      { status: 400 }
    );
  }

  const review_id = String(body.review_id ?? "").trim();
  const resolved_canonical_area = String(body.resolved_canonical_area ?? "").trim();
  if (!review_id) {
    return NextResponse.json(
      { ok: false, error: "REVIEW_ID_REQUIRED" },
      { status: 400 }
    );
  }
  const { error: updErr } = await adminSupabase
    .from("area_review_queue")
    .update({
      status: "resolved",
      resolved_canonical_area: resolved_canonical_area || "",
      resolved_at: new Date().toISOString(),
    })
    .eq("review_id", review_id);
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", detail: updErr.message },
      { status: 500 }
    );
  }

  // Resolving a review removes an item from the pending list shown
  // inside AreaTab; invalidate the city-scoped snapshot so the next
  // read recomputes. JOD is the only active city today; same caveat
  // as the area-intelligence route applies if a second city joins.
  await invalidateSnapshots(["area_stats.JOD"]);
  return NextResponse.json({ ok: true, review_id });
}
