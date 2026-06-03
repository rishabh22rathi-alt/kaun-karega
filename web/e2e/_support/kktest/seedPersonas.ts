/**
 * Idempotent KKTEST persona seeder.
 *
 * Resolves the abstract region intents against the live, active JOD region
 * catalog (service_regions / service_region_areas — the same source the live
 * matching specs read), then writes the fixed provider personas across:
 *   providers, provider_services, provider_areas, provider_plans
 *
 * Idempotency: every child-table write is "guarded delete of KKTEST rows,
 * then insert", so re-running produces an identical end state. Providers are
 * upserted on provider_id. Users/admin are phone-keyed identities and need no
 * base rows — packs seed their tasks/threads on demand.
 *
 * SAFETY: refuses to run unless [env.assertWritesAllowed] passes (explicit
 * non-prod target). Every delete is scoped to KKTEST provider ids via
 * [guard.assertKkTestIds]. Real provider/user data is unreachable from here.
 *
 * Column names mirror those exercised by
 * e2e/provider-plan-listing-matrix.spec.ts against the real schema.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { assertWritesAllowed, makeAdminClient } from "./env";
import { assertKkTestIds } from "./guard";
import {
  ALL_KKTEST_PROVIDER_IDS,
  KKTEST_CITY_CODE,
  KKTEST_ISOLATION_CATEGORY,
  KKTEST_PROVIDERS,
  type KkTestProvider,
  type RegionIntent,
} from "./personas";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedSummary {
  ok: boolean;
  providersSeeded: number;
  regionsResolved: number;
  knownRegion: string;
  altRegion: string;
  error?: string;
}

interface RegionCatalog {
  /** Ordered active JOD region codes. */
  regions: string[];
  /** region_code -> representative canonical area. */
  areaByRegion: Map<string, string>;
}

async function loadRegionCatalog(c: SupabaseClient): Promise<RegionCatalog> {
  const { data: regionRows, error: regionErr } = await c
    .from("service_regions")
    .select("region_code, city_code, active")
    .eq("active", true);
  if (regionErr) throw new Error(`service_regions read failed: ${regionErr.message}`);

  const regions = (regionRows ?? [])
    .filter((r) => {
      const city = String((r as { city_code?: unknown }).city_code ?? "").trim();
      return !city || city.toUpperCase() === KKTEST_CITY_CODE;
    })
    .map((r) => String((r as { region_code?: unknown }).region_code ?? "").trim())
    .filter(Boolean)
    .sort();

  const { data: sraRows } = await c
    .from("service_region_areas")
    .select("canonical_area, region_code, active")
    .eq("active", true)
    .order("canonical_area", { ascending: true });

  const areaByRegion = new Map<string, string>();
  for (const r of sraRows ?? []) {
    const rc = String((r as { region_code?: unknown }).region_code ?? "").trim();
    const ca = String((r as { canonical_area?: unknown }).canonical_area ?? "").trim();
    if (rc && ca && !areaByRegion.has(rc)) areaByRegion.set(rc, ca);
  }
  return { regions, areaByRegion };
}

function regionsForIntent(intent: RegionIntent, cat: RegionCatalog): string[] {
  switch (intent) {
    case "first1":
      return cat.regions.slice(0, 1);
    case "first5":
      return cat.regions.slice(0, 5);
    case "all":
      return [...cat.regions];
    case "altRegion":
      // A single region distinct from the canonical known (first) region.
      return cat.regions.length > 1 ? [cat.regions[6] ?? cat.regions[1]] : cat.regions.slice(0, 1);
    default:
      return [];
  }
}

function periodWindow(p: KkTestProvider): {
  start: string | null;
  end: string | null;
} {
  if (p.periodState === "none") return { start: null, end: null };
  const startMs = nowMs() - DAY_MS;
  const endMs =
    p.periodState === "future" ? nowMs() + 30 * DAY_MS : nowMs() - DAY_MS;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

// Centralised so a future deterministic-clock injection touches one spot.
function nowMs(): number {
  return new Date().getTime();
}

/** Guarded delete of all KKTEST rows in a provider child table. */
async function clearProviderTable(
  c: SupabaseClient,
  table: string
): Promise<void> {
  const ids = assertKkTestIds(ALL_KKTEST_PROVIDER_IDS);
  const { error } = await c.from(table).delete().in("provider_id", ids as string[]);
  if (error) throw new Error(`clear ${table} failed: ${error.message}`);
}

export async function seedPersonas(
  client?: SupabaseClient
): Promise<SeedSummary> {
  // SAFETY GATE — never writes to production.
  assertWritesAllowed();

  const c = client ?? makeAdminClient();
  const cat = await loadRegionCatalog(c);
  if (cat.regions.length < 5) {
    throw new Error(
      `KKTEST seed needs >=5 active JOD regions, found ${cat.regions.length}. Is the region catalog seeded?`
    );
  }
  const knownRegion = cat.regions[0];
  const altRegion = cat.regions[6] ?? cat.regions[1];
  const repArea = (rc: string) => cat.areaByRegion.get(rc) || rc;

  // Ensure the isolation category exists and is active (matching gate).
  const catUpsert = await c
    .from("categories")
    .upsert(
      { name: KKTEST_ISOLATION_CATEGORY, active: true },
      { onConflict: "name" }
    );
  if (catUpsert.error) {
    throw new Error(`categories upsert failed: ${catUpsert.error.message}`);
  }

  // Clean child tables first (FK-safe order), all KKTEST-scoped.
  await clearProviderTable(c, "provider_plans");
  await clearProviderTable(c, "provider_areas");
  await clearProviderTable(c, "provider_services");

  // Providers (upsert on provider_id keeps this idempotent).
  const providerRows = KKTEST_PROVIDERS.map((p) => ({
    provider_id: p.id,
    full_name: p.fullName,
    phone: p.phone,
    status: p.status,
    verified: p.verified,
  }));
  const provUpsert = await c
    .from("providers")
    .upsert(providerRows, { onConflict: "provider_id" });
  if (provUpsert.error) {
    throw new Error(`providers upsert failed: ${provUpsert.error.message}`);
  }

  // Services — one isolation-category row per provider.
  const serviceRows = KKTEST_PROVIDERS.map((p) => ({
    provider_id: p.id,
    category: KKTEST_ISOLATION_CATEGORY,
  }));
  const svcIns = await c.from("provider_services").insert(serviceRows);
  if (svcIns.error) {
    throw new Error(`provider_services insert failed: ${svcIns.error.message}`);
  }

  // Areas — resolved per provider region intent.
  const areaRows = KKTEST_PROVIDERS.flatMap((p) =>
    regionsForIntent(p.regionIntent, cat).map((rc) => ({
      provider_id: p.id,
      area: repArea(rc),
      city_code: KKTEST_CITY_CODE,
      region_code: rc,
    }))
  );
  const areaIns = await c.from("provider_areas").insert(areaRows);
  if (areaIns.error) {
    throw new Error(`provider_areas insert failed: ${areaIns.error.message}`);
  }

  // Plans — explicit rows for every persona so state is unambiguous.
  const planRows = KKTEST_PROVIDERS.map((p) => {
    const { start, end } = periodWindow(p);
    return {
      provider_id: p.id,
      plan_code: p.planCode,
      max_regions: p.maxRegions,
      current_period_start: start,
      current_period_end: end,
      scheduled_plan_code: p.scheduledPlanCode ?? null,
      scheduled_max_regions: p.scheduledMaxRegions ?? null,
    };
  });
  const planIns = await c.from("provider_plans").insert(planRows);
  if (planIns.error) {
    throw new Error(`provider_plans insert failed: ${planIns.error.message}`);
  }

  return {
    ok: true,
    providersSeeded: KKTEST_PROVIDERS.length,
    regionsResolved: cat.regions.length,
    knownRegion,
    altRegion,
  };
}
