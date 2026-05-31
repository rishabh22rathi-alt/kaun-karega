/**
 * E2E (bug hunt): Provider listing across the plan matrix after All Jodhpur.
 *
 * Adversarial — actively probes area-wise listing, all-city listing, downgrade,
 * expired all_jodhpur drift, provider_areas drift, and grouping. Seeds 5
 * providers under a dummy category and exercises both region and all-city
 * matching via /api/find-provider (Mode A taskId, so the result set is never
 * sliced and only TEST_PLAN_MATRIX providers can match the unique category).
 *
 * Providers (all category = TEST_PLAN_MATRIX_SERVICE):
 *   A = free (no plan row), test region only
 *   B = active regions_5, test region + 4 others
 *   C = active all_jodhpur, ALL active JOD regions
 *   D = EXPIRED all_jodhpur, ALL regions (deliberate drift)
 *   E = expired regions_5 (effective free), test region only (downgrade case)
 *
 * Production code is NOT changed by this spec. If a real bug surfaces, the
 * test fails loudly and the report documents it (no silent pass).
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
 *     npx playwright test e2e/provider-plan-listing-matrix.spec.ts --reporter=line
 */

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

import { appUrl } from "./_support/runtime";

// ─── Env loading (mirrors all-jodhpur-matching.spec.ts) ──────────────────────
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
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Constants ───────────────────────────────────────────────────────────────
const RUN_ID = String(Date.now()).slice(-7);
const PREFIX = "TEST_PLAN_MATRIX";
const CATEGORY = "TEST_PLAN_MATRIX_SERVICE";

const P = {
  A: `${PREFIX}_A_${RUN_ID}`,
  B: `${PREFIX}_B_${RUN_ID}`,
  C: `${PREFIX}_C_${RUN_ID}`,
  D: `${PREFIX}_D_${RUN_ID}`,
  E: `${PREFIX}_E_${RUN_ID}`,
};
const ALL_IDS = [P.A, P.B, P.C, P.D, P.E];
const ph = (n: number) => `78${RUN_ID}${n}`; // 10-digit, starts 7

const TASK_RG = `TK-PMX-RG-${RUN_ID}`;
const TASK_AJ = `TK-PMX-AJ-${RUN_ID}`;
const ALL_TASKS = [TASK_RG, TASK_AJ];

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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
  await c.from("categories").delete().eq("name", CATEGORY);
}

// Mode A find-provider: full match set (no slice), returns a providerId → item
// map limited to TEST_PLAN_MATRIX providers.
async function findByTask(
  request: import("@playwright/test").APIRequestContext,
  taskId: string
): Promise<{ body: FindResponse; mine: Map<string, ProviderItem> }> {
  const res = await request.get(
    appUrl(
      `/api/find-provider?taskId=${encodeURIComponent(
        taskId
      )}&category=${encodeURIComponent(CATEGORY)}`
    )
  );
  expect(res.status()).toBe(200);
  const body = (await res.json()) as FindResponse;
  expect(body.ok).toBe(true);
  const mine = new Map<string, ProviderItem>();
  for (const p of body.providers ?? []) {
    const id = String(p.ProviderID || "");
    if (id.startsWith(PREFIX)) mine.set(id, p);
  }
  return { body, mine };
}

test.describe.configure({ mode: "serial" });

test.describe("Provider plan listing matrix (bug hunt)", () => {
  test.skip(!hasCreds(), "SUPABASE service-role creds not available");

  test.beforeAll(async () => {
    const c = makeAdminClient();
    await cleanup(c);

    // Active JOD region catalog + representative canonical area per region.
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
    expect(jod.length, "need >=5 active JOD regions").toBeGreaterThanOrEqual(5);

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
    const otherFour = jod.slice(1, 5); // 4 regions != testRegion

    // Dummy category (active so the matching gate passes).
    const catIns = await c
      .from("categories")
      .insert({ name: CATEGORY, active: true });
    expect(catIns.error, "categories insert").toBeNull();

    // Providers
    const provIns = await c.from("providers").insert([
      { provider_id: P.A, full_name: `${PREFIX} A`, phone: ph(1), status: "active", verified: "yes" },
      { provider_id: P.B, full_name: `${PREFIX} B`, phone: ph(2), status: "active", verified: "yes" },
      { provider_id: P.C, full_name: `${PREFIX} C`, phone: ph(3), status: "active", verified: "yes" },
      { provider_id: P.D, full_name: `${PREFIX} D`, phone: ph(4), status: "active", verified: "yes" },
      { provider_id: P.E, full_name: `${PREFIX} E`, phone: ph(5), status: "active", verified: "yes" },
    ]);
    expect(provIns.error, "providers insert").toBeNull();

    const svcIns = await c
      .from("provider_services")
      .insert(ALL_IDS.map((id) => ({ provider_id: id, category: CATEGORY })));
    expect(svcIns.error, "provider_services insert").toBeNull();

    const areaRow = (id: string, rc: string) => ({
      provider_id: id,
      area: repArea(rc),
      city_code: "JOD",
      region_code: rc,
    });
    const areaRows = [
      areaRow(P.A, testRegion), // free: test region only
      areaRow(P.B, testRegion), // regions_5: test region + 4 others
      ...otherFour.map((rc) => areaRow(P.B, rc)),
      ...jod.map((rc) => areaRow(P.C, rc)), // all_jodhpur active: all regions
      ...jod.map((rc) => areaRow(P.D, rc)), // expired all_jodhpur: drift, all regions
      areaRow(P.E, testRegion), // downgraded/free: test region only
    ];
    const areaIns = await c.from("provider_areas").insert(areaRows);
    expect(areaIns.error, "provider_areas insert").toBeNull();

    const planIns = await c.from("provider_plans").insert([
      // A: no row (implicit free)
      { provider_id: P.B, plan_code: "regions_5", max_regions: 5, current_period_start: PAST, current_period_end: FUTURE },
      { provider_id: P.C, plan_code: "all_jodhpur", max_regions: 99, current_period_start: PAST, current_period_end: FUTURE },
      { provider_id: P.D, plan_code: "all_jodhpur", max_regions: 99, current_period_start: PAST, current_period_end: PAST },
      // E: expired regions_5 → effective free (downgrade)
      { provider_id: P.E, plan_code: "regions_5", max_regions: 5, current_period_start: PAST, current_period_end: PAST },
    ]);
    expect(planIns.error, "provider_plans insert").toBeNull();

    const taskIns = await c.from("tasks").insert([
      {
        task_id: TASK_RG,
        category: CATEGORY,
        area: testRegionArea,
        details: `${PREFIX} region ${RUN_ID}`,
        phone: ph(7),
        status: "submitted",
        city_code: "JOD",
        region_code: testRegion,
        scope: "region",
      },
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
    ]);
    expect(taskIns.error, "tasks insert").toBeNull();
  });

  test.afterAll(async () => {
    await cleanup(makeAdminClient());
  });

  test("Test 1 — region search: per-plan grouping + D not labelled all_jodhpur", async ({
    request,
  }) => {
    const { mine } = await findByTask(request, TASK_RG);

    // All five physically cover the test region → all five matched.
    for (const id of ALL_IDS) {
      expect(mine.has(id), `${id} present in region search`).toBe(true);
    }

    // C = city-wide; B = this region; A/E = other (free). Per-plan labels.
    expect(mine.get(P.C)?.matchScope).toBe("all_jodhpur");
    expect(mine.get(P.C)?.group).toBe("available_across_jodhpur");

    expect(mine.get(P.B)?.matchScope).toBe("region");
    expect(mine.get(P.B)?.group).toBe("available_in_this_region");

    expect(mine.get(P.A)?.matchScope).toBe("region");
    expect(mine.get(P.A)?.group).toBe("other_providers_in_this_area");
    expect(mine.get(P.E)?.matchScope).toBe("region");
    expect(mine.get(P.E)?.group).toBe("other_providers_in_this_area");

    // D (expired all_jodhpur) MUST NOT be labelled all_jodhpur — even though
    // it appears here via stale region rows (expiry drift). This is the key
    // safety check: an expired city-wide provider is never treated as
    // city-wide in matching.
    expect(
      mine.get(P.D)?.matchScope,
      "expired all_jodhpur D must NOT be matchScope=all_jodhpur in region search"
    ).toBe("region");
    expect(mine.get(P.D)?.group).toBe("other_providers_in_this_area");

    console.log(
      "[DRIFT] D (expired all_jodhpur) appears in region search via stale provider_areas, " +
        "correctly labelled region/other (not all_jodhpur). This is expiry drift — " +
        "remediated by reconcileProviderCoverage(D), which would trim D to 1 region."
    );
  });

  test("Test 2 — all-city search: ONLY active all_jodhpur (C); D excluded (expired)", async ({
    request,
  }) => {
    const { body, mine } = await findByTask(request, TASK_AJ);
    expect(body.matchTier).toBe("all_jodhpur");

    expect(mine.has(P.C), "C (active all_jodhpur) included").toBe(true);
    expect(mine.has(P.A), "A (free) excluded").toBe(false);
    expect(mine.has(P.B), "B (regions_5) excluded").toBe(false);
    expect(mine.has(P.D), "D (expired all_jodhpur) excluded").toBe(false);
    expect(mine.has(P.E), "E (downgraded free) excluded").toBe(false);

    // Every TEST_PLAN_MATRIX provider returned must be a city-wide match.
    for (const [id, item] of mine) {
      expect(item.matchScope, `${id} matchScope`).toBe("all_jodhpur");
      expect(item.group, `${id} group`).toBe("available_across_jodhpur");
      expect(String(item.area), `${id} area`).toBe("All Jodhpur");
    }
  });

  test("Test 3 — downgraded/free provider E appears area-wise but NOT city-wide", async ({
    request,
  }) => {
    const region = await findByTask(request, TASK_RG);
    const city = await findByTask(request, TASK_AJ);

    // The suspected bug: a downgraded provider disappearing entirely.
    expect(
      region.mine.has(P.E),
      "REGRESSION: downgraded/free provider E must still appear in its region search"
    ).toBe(true);
    expect(region.mine.get(P.E)?.matchScope).toBe("region");

    // ...but it must NOT leak into all-city results.
    expect(
      city.mine.has(P.E),
      "downgraded/free provider E must NOT appear in all-city search"
    ).toBe(false);
  });

  test("Test 4 — expiry-drift report: D over-covers region-wise, safe city-wide", async ({
    request,
  }) => {
    const c = makeAdminClient();

    // Observed pre-reconcile state.
    const region = await findByTask(request, TASK_RG);
    const city = await findByTask(request, TASK_AJ);

    const dRegion = region.mine.has(P.D);
    const dCity = city.mine.has(P.D);

    // Persisted match_scope on provider_task_matches for the region task.
    const { data: ptm } = await c
      .from("provider_task_matches")
      .select("provider_id, match_scope")
      .eq("task_id", TASK_RG)
      .eq("provider_id", P.D);
    const dPersistedScope = (ptm ?? [])[0]?.match_scope ?? null;

    console.log("[DRIFT REPORT] expired all_jodhpur provider D:");
    console.log(`  - appears in REGION search:    ${dRegion} (label=${region.mine.get(P.D)?.matchScope ?? "n/a"})`);
    console.log(`  - appears in ALL-CITY search:  ${dCity}`);
    console.log(`  - provider_task_matches.match_scope (region task): ${dPersistedScope}`);
    console.log(
      "  - Interpretation: D over-covers REGION-wise via stale provider_areas (expiry drift), " +
        "but is correctly EXCLUDED city-wide (plan-based) and never labelled all_jodhpur. " +
        "reconcileProviderCoverage(D) is the remediation (trims D's areas to its effective cap). " +
        "Not invoked here: the /api/admin/provider-coverage/rebuild endpoint requires an admin session."
    );

    // SAFE invariants that must hold regardless of drift:
    expect(dCity, "expired all_jodhpur D must be excluded from all-city search").toBe(false);
    if (dRegion) {
      expect(
        region.mine.get(P.D)?.matchScope,
        "drifting D must be labelled region (never all_jodhpur)"
      ).toBe("region");
      expect(dPersistedScope, "persisted match_scope for D must be region").toBe("region");
    }
  });
});
