/**
 * E2E: All Jodhpur (Phase 2) backend matching — seeded providers.
 *
 * Verifies the all-city matching branch in /api/find-provider with real
 * dummy data, plus a region-scope regression so we prove normal region
 * matching is untouched. Production logic is NOT modified by this spec.
 *
 * Seeds 4 providers in the same category + city (all prefixed TEST_AJ_):
 *   A — implicit free (no provider_plans row), one JOD region
 *   B — active regions_5, one JOD region
 *   C — active all_jodhpur, ALL active JOD regions
 *   D — EXPIRED all_jodhpur, ALL JOD regions (simulates coverage drift)
 *
 * All-city task (scope='all_jodhpur', region_code=NULL) must match ONLY C.
 * Region task (scope='region') must still match A/B/C with the correct
 * per-provider match_scope + group metadata.
 *
 * Why Mode A (taskId): /api/find-provider only slices the result set for
 * anonymous (no-taskId) lookups. Seeding a task and passing taskId returns
 * the FULL match set, so the test providers can't be sliced out by other
 * live providers in the category, and it exercises the production
 * scope-from-task path. category is still read from the query string
 * (the route does not read it from the task row), so we pass both.
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from env or
 * web/.env.local) and a reachable app server (PLAYWRIGHT_BASE_URL or
 * http://127.0.0.1:3000). The whole suite skips if creds are absent.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
 *     npx playwright test e2e/all-jodhpur-matching.spec.ts --reporter=line
 */

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

import { appUrl } from "./_support/runtime";

// ─── Env loading (mirrors chat-notification-logs.spec.ts) ────────────────────
let cachedEnvLocal: Record<string, string> | null = null;
function loadEnvLocal(): Record<string, string> {
  if (cachedEnvLocal) return cachedEnvLocal;
  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) {
    cachedEnvLocal = {};
    return cachedEnvLocal;
  }
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    env[trimmed.slice(0, sep).trim()] = trimmed
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  cachedEnvLocal = env;
  return cachedEnvLocal;
}
function getEnv(name: string): string {
  return process.env[name] || loadEnvLocal()[name] || "";
}
function hasCreds(): boolean {
  return Boolean(
    (getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL")) &&
      getEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
}
function makeAdminClient(): SupabaseClient {
  const url = getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Test constants ──────────────────────────────────────────────────────────
const RUN_ID = String(Date.now()).slice(-7);
const PREFIX = "TEST_AJ";
const CATEGORY = "Electrician"; // active in `categories`

const P = {
  A: `TEST_AJ_A_${RUN_ID}`,
  B: `TEST_AJ_B_${RUN_ID}`,
  C: `TEST_AJ_C_${RUN_ID}`,
  D: `TEST_AJ_D_${RUN_ID}`,
};
const ALL_IDS = [P.A, P.B, P.C, P.D];
// 10-digit synthetic phones starting with 7 (passes [6-9] gate).
const ph = (n: number) => `79${RUN_ID}${n}`;

const TASK_AJ = `TK-AJ-${RUN_ID}`; // all-city task
const TASK_RG = `TK-RG-${RUN_ID}`; // region task
const ALL_TASKS = [TASK_AJ, TASK_RG];

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

// Resolved during seeding.
let testRegion = "";
let testRegionArea = "";

type ProviderItem = {
  ProviderID?: string;
  matchScope?: string;
  group?: string;
  area?: string;
};
type FindResponse = {
  ok?: boolean;
  count?: number;
  providers?: ProviderItem[];
  matchTier?: string;
  usedFallback?: boolean;
};

async function cleanup(c: SupabaseClient): Promise<void> {
  await c.from("provider_task_matches").delete().in("task_id", ALL_TASKS);
  await c.from("notification_logs").delete().in("task_id", ALL_TASKS);
  await c.from("provider_notifications").delete().in("provider_id", ALL_IDS);
  await c.from("tasks").delete().in("task_id", ALL_TASKS);
  await c.from("provider_areas").delete().in("provider_id", ALL_IDS);
  await c.from("provider_services").delete().in("provider_id", ALL_IDS);
  await c.from("provider_plans").delete().in("provider_id", ALL_IDS);
  await c.from("providers").delete().in("provider_id", ALL_IDS);
}

test.describe.configure({ mode: "serial" });

test.describe("All Jodhpur — Phase 2 backend matching (seeded)", () => {
  test.skip(
    !hasCreds(),
    "SUPABASE service-role credentials not available (env or web/.env.local)"
  );

  test.beforeAll(async () => {
    const c = makeAdminClient();
    await cleanup(c); // pre-clean any stale run

    // Resolve the active JOD region catalog + a representative canonical
    // area per region (so the canonicalization job leaves region_code
    // intact). Fail loudly if the catalog isn't seeded.
    const { data: regionRows, error: regionErr } = await c
      .from("service_regions")
      .select("region_code, city_code, active")
      .eq("active", true);
    expect(regionErr, "service_regions read").toBeNull();
    const jod = (regionRows ?? [])
      .filter((r) => {
        const city = String((r as { city_code?: unknown }).city_code ?? "").trim();
        return !city || city.toUpperCase() === "JOD";
      })
      .map((r) => String((r as { region_code?: unknown }).region_code ?? "").trim())
      .filter(Boolean);
    expect(jod.length, "need >=1 active JOD region seeded").toBeGreaterThan(0);

    const { data: sraRows } = await c
      .from("service_region_areas")
      .select("canonical_area, region_code, city_code, active")
      .eq("active", true)
      .order("canonical_area", { ascending: true });
    const areaByRegion = new Map<string, string>();
    for (const r of sraRows ?? []) {
      const rc = String((r as { region_code?: unknown }).region_code ?? "").trim();
      const ca = String((r as { canonical_area?: unknown }).canonical_area ?? "").trim();
      if (rc && ca && !areaByRegion.has(rc)) areaByRegion.set(rc, ca);
    }
    const repArea = (rc: string) => areaByRegion.get(rc) || rc;
    testRegion = jod[0];
    testRegionArea = repArea(testRegion);

    // Providers
    const providersInsert = await c.from("providers").insert([
      { provider_id: P.A, full_name: `${PREFIX} A ${RUN_ID}`, phone: ph(1), status: "active", verified: "yes" },
      { provider_id: P.B, full_name: `${PREFIX} B ${RUN_ID}`, phone: ph(2), status: "active", verified: "yes" },
      { provider_id: P.C, full_name: `${PREFIX} C ${RUN_ID}`, phone: ph(3), status: "active", verified: "yes" },
      { provider_id: P.D, full_name: `${PREFIX} D ${RUN_ID}`, phone: ph(4), status: "active", verified: "yes" },
    ]);
    expect(providersInsert.error, "providers insert").toBeNull();

    // Category services
    const servicesInsert = await c
      .from("provider_services")
      .insert(ALL_IDS.map((id) => ({ provider_id: id, category: CATEGORY })));
    expect(servicesInsert.error, "provider_services insert").toBeNull();

    // Coverage: A/B in one region; C/D across all JOD regions.
    const areaRows = [
      { provider_id: P.A, area: testRegionArea, city_code: "JOD", region_code: testRegion },
      { provider_id: P.B, area: testRegionArea, city_code: "JOD", region_code: testRegion },
      ...jod.map((rc) => ({ provider_id: P.C, area: repArea(rc), city_code: "JOD", region_code: rc })),
      ...jod.map((rc) => ({ provider_id: P.D, area: repArea(rc), city_code: "JOD", region_code: rc })),
    ];
    const areasInsert = await c.from("provider_areas").insert(areaRows);
    expect(areasInsert.error, "provider_areas insert").toBeNull();

    // Plans: A implicit free (no row); B regions_5 active; C all_jodhpur
    // active; D all_jodhpur EXPIRED.
    const plansInsert = await c.from("provider_plans").insert([
      { provider_id: P.B, plan_code: "regions_5", max_regions: 5, current_period_start: PAST, current_period_end: FUTURE },
      { provider_id: P.C, plan_code: "all_jodhpur", max_regions: 99, current_period_start: PAST, current_period_end: FUTURE },
      { provider_id: P.D, plan_code: "all_jodhpur", max_regions: 99, current_period_start: PAST, current_period_end: PAST },
    ]);
    expect(plansInsert.error, "provider_plans insert").toBeNull();

    // Tasks: one all-city, one region-scoped, both in the test category.
    const tasksInsert = await c.from("tasks").insert([
      {
        task_id: TASK_AJ,
        category: CATEGORY,
        area: "All Jodhpur",
        details: `${PREFIX} all-city ${RUN_ID}`,
        phone: ph(8),
        status: "submitted",
        city_code: "JOD",
        region_code: null,
        scope: "all_jodhpur",
      },
      {
        task_id: TASK_RG,
        category: CATEGORY,
        area: testRegionArea,
        details: `${PREFIX} region ${RUN_ID}`,
        phone: ph(9),
        status: "submitted",
        city_code: "JOD",
        region_code: testRegion,
        scope: "region",
      },
    ]);
    expect(tasksInsert.error, "tasks insert").toBeNull();
  });

  test.afterAll(async () => {
    await cleanup(makeAdminClient());
  });

  test("all-city task matches ONLY the active all_jodhpur provider (C)", async ({
    request,
  }) => {
    const res = await request.get(
      appUrl(
        `/api/find-provider?taskId=${encodeURIComponent(
          TASK_AJ
        )}&category=${encodeURIComponent(CATEGORY)}`
      )
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as FindResponse;
    expect(body.ok).toBe(true);
    expect(body.matchTier).toBe("all_jodhpur");

    const ids = (body.providers ?? []).map((p) => String(p.ProviderID || ""));
    expect(ids, "C (active all_jodhpur) included").toContain(P.C);
    expect(ids, "A (free) excluded").not.toContain(P.A);
    expect(ids, "B (regions_5) excluded").not.toContain(P.B);
    expect(ids, "D (expired all_jodhpur) excluded").not.toContain(P.D);

    // Every returned provider is labelled as a city-wide match.
    for (const p of body.providers ?? []) {
      expect(p.matchScope, `matchScope for ${p.ProviderID}`).toBe("all_jodhpur");
      expect(p.group, `group for ${p.ProviderID}`).toBe("available_across_jodhpur");
      expect(String(p.area), `area for ${p.ProviderID}`).toBe("All Jodhpur");
    }
  });

  test("all-city provider_task_matches row for C carries match_scope='all_jodhpur'", async () => {
    const c = makeAdminClient();
    const { data, error } = await c
      .from("provider_task_matches")
      .select("provider_id, match_scope, area")
      .eq("task_id", TASK_AJ);
    expect(error, "provider_task_matches read").toBeNull();
    const rows = data ?? [];
    const cRow = rows.find((r) => String(r.provider_id) === P.C);
    expect(cRow, "C has a match row").toBeTruthy();
    expect(cRow?.match_scope).toBe("all_jodhpur");
    expect(String(cRow?.area)).toBe("All Jodhpur");
    // Excluded providers must NOT have produced a match row.
    expect(rows.some((r) => String(r.provider_id) === P.A)).toBe(false);
    expect(rows.some((r) => String(r.provider_id) === P.B)).toBe(false);
    expect(rows.some((r) => String(r.provider_id) === P.D)).toBe(false);
  });

  test("region task still matches region providers with correct per-plan labels", async ({
    request,
  }) => {
    const res = await request.get(
      appUrl(
        `/api/find-provider?taskId=${encodeURIComponent(
          TASK_RG
        )}&category=${encodeURIComponent(CATEGORY)}`
      )
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as FindResponse;
    expect(body.ok).toBe(true);

    const byId = new Map<string, ProviderItem>();
    for (const p of body.providers ?? []) {
      byId.set(String(p.ProviderID || ""), p);
    }

    // A (free), B (regions_5), C (all_jodhpur covering this region) are all
    // physically in the region → all present. Labels differ by plan.
    expect(byId.has(P.A), "A present in region search").toBe(true);
    expect(byId.has(P.B), "B present in region search").toBe(true);
    expect(byId.has(P.C), "C present in region search").toBe(true);

    expect(byId.get(P.A)?.matchScope).toBe("region");
    expect(byId.get(P.A)?.group).toBe("other_providers_in_this_area");

    expect(byId.get(P.B)?.matchScope).toBe("region");
    expect(byId.get(P.B)?.group).toBe("available_in_this_region");

    expect(byId.get(P.C)?.matchScope).toBe("all_jodhpur");
    expect(byId.get(P.C)?.group).toBe("available_across_jodhpur");

    // Region response area stays human-readable (never the region_code).
    expect(String(byId.get(P.A)?.area)).toBe(testRegionArea);
  });
});
