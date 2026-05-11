import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// GET /api/admin/areas
// Returns regions + canonical areas (each with its currently-active aliases
// bundled) for the admin dashboard's Area accordion. Mirrors the shape of
// /api/admin/categories so AreaTab can use the same mental model as
// CategoryTab.
//
// Sources:
//   service_regions              — region_code, region_name, active
//   service_region_areas         — area_code, canonical_area, region_code, active
//   service_region_area_aliases  — alias_code, alias, canonical_area, region_code, active=true
//
// Join is performed in JS on (lower(canonical_area), region_code) so a
// stray double-space or case drift in a stored value doesn't split an
// area from its aliases. Region name is hydrated from a code→name map.

export const runtime = "nodejs";

const MAX_ROWS = 5000;
// provider_areas is the largest table read here. ~thousands today; cap
// generously to avoid silent truncation if it grows.
const PROVIDER_AREAS_LIMIT = 20000;
const PROVIDERS_LIMIT = 10000;

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

// Verified predicate — same defensive check the admin stats page uses.
// providers.verified is stored as the string "yes"/"no" in the live DB;
// a stray boolean true is accepted too in case any code path writes it.
const isVerified = (value: unknown) =>
  value === true ||
  String(value ?? "")
    .trim()
    .toLowerCase() === "yes";

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

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const [
    regionsRes,
    areasRes,
    aliasesRes,
    providerAreasRes,
    providersRes,
    pendingReviewRes,
  ] = await Promise.all([
      adminSupabase
        .from("service_regions")
        .select("region_code, region_name, active")
        .order("region_code", { ascending: true })
        .limit(MAX_ROWS),
      adminSupabase
        .from("service_region_areas")
        .select("area_code, canonical_area, region_code, active, notes")
        .order("region_code", { ascending: true })
        .order("canonical_area", { ascending: true })
        .limit(MAX_ROWS),
      adminSupabase
        .from("service_region_area_aliases")
        .select(
          "id, alias_code, alias, canonical_area, region_code, active, notes"
        )
        .eq("active", true)
        .order("alias", { ascending: true })
        .limit(MAX_ROWS),
      adminSupabase
        .from("provider_areas")
        .select("provider_id, area")
        .limit(PROVIDER_AREAS_LIMIT),
      adminSupabase
        .from("providers")
        .select("provider_id, verified")
        .limit(PROVIDERS_LIMIT),
      adminSupabase
        .from("area_review_queue")
        .select(
          "review_id, raw_area, occurrences, source_ref, source_type, last_seen_at"
        )
        .eq("status", "pending")
        .order("occurrences", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(200),
    ]);

  // Hard-fail only on the three core tables. Provider-density reads
  // fail soft: if either errors, regions still render and the counts
  // surface as 0 with a warning so admins see "0 / 0" instead of an
  // outright 500.
  if (regionsRes.error || areasRes.error || aliasesRes.error) {
    const err = regionsRes.error || areasRes.error || aliasesRes.error;
    return NextResponse.json(
      {
        ok: false,
        error: "DB_ERROR",
        detail: err?.message,
      },
      { status: 500 }
    );
  }
  if (providerAreasRes.error) {
    console.warn(
      "[admin/areas] provider_areas read failed; counts will be 0",
      providerAreasRes.error
    );
  }
  if (providersRes.error) {
    console.warn(
      "[admin/areas] providers read failed; verified counts will be 0",
      providersRes.error
    );
  }
  if (pendingReviewRes.error) {
    console.warn(
      "[admin/areas] area_review_queue read failed; pending list empty",
      pendingReviewRes.error
    );
  }

  // region_code → region_name lookup for hydration.
  const regionNameByCode = new Map<string, string | null>();
  for (const r of (regionsRes.data ?? []) as RegionRow[]) {
    regionNameByCode.set(r.region_code, r.region_name ?? null);
  }

  // Group active aliases by (canonical_area, region_code).
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

  // Map: alias key → set of region_codes. Active-only (aliasesRes is
  // pre-filtered above). An alias resolves the provider_area to its
  // parent canonical's region; we treat the alias text itself as a key.
  const regionsByAliasKey = new Map<string, Set<string>>();
  type AliasRowDb2 = {
    alias: string | null;
    region_code: string | null;
  };
  for (const row of (aliasesRes.data ?? []) as AliasRowDb2[]) {
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

  // Verified provider id set.
  const verifiedProviderIds = new Set<string>();
  for (const p of (providersRes.data ?? []) as Array<{
    provider_id: string;
    verified: unknown;
  }>) {
    if (isVerified(p.verified)) {
      const id = String(p.provider_id ?? "").trim();
      if (id) verifiedProviderIds.add(id);
    }
  }

  // Per-region provider Sets — built by walking provider_areas once.
  // Same pass also collects unmapped provider_areas (rows whose
  // normalized key matches no active service_region_areas canonical),
  // grouped by raw area string so admins can see the exact variants.
  const providersByRegion = new Map<string, Set<string>>();
  const verifiedByRegion = new Map<string, Set<string>>();
  const unmappedByRawArea = new Map<string, Set<string>>();
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
      // variants surface separately (the cleanup target).
      if (rawArea) {
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
  // high-impact rows.
  const unmapped_provider_areas = [...unmappedByRawArea.entries()]
    .map(([area, providerSet]) => ({
      area,
      provider_count: providerSet.size,
    }))
    .sort((a, b) => {
      if (b.provider_count !== a.provider_count)
        return b.provider_count - a.provider_count;
      return a.area.localeCompare(b.area);
    })
    .slice(0, 50);

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

  // Hydrate pending area requests with submitter info. Best-effort
  // join: providers were already loaded above for the verified set,
  // but we only kept verified ids. Re-build a quick id → {name, phone}
  // map from the same providersRes payload to avoid a second query.
  type ProviderMini = { provider_id: string; full_name?: string; phone?: string };
  const providerInfoById = new Map<string, ProviderMini>();
  for (const p of (providersRes.data ?? []) as Array<
    ProviderMini & { verified: unknown }
  >) {
    const id = String(p.provider_id ?? "").trim();
    if (id) providerInfoById.set(id, p);
  }
  // providersRes was selected with only (provider_id, verified). To get
  // names + phones, do one extra lookup scoped to the ids we actually
  // need — keeps the GET cheap when the queue is empty.
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

  return NextResponse.json({
    ok: true,
    regions,
    areas,
    unmapped_provider_areas,
    pending_area_requests,
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

  return NextResponse.json({ ok: true, review_id });
}
