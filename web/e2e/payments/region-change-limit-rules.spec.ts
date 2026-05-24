/**
 * Server-side region/category change rules — MVP edition.
 *
 * The per-period monthly addition throttle was removed for MVP.
 * Providers can change regions/categories any number of times within
 * their plan cap. This spec locks the surviving contracts:
 *
 *   - Plan cap still rejects over-cap additions.
 *   - Strict over-plan reduction still passes (7 → 6 even when
 *     maxRegions = 5).
 *   - Repeated saves with additions all succeed (no throttle).
 *   - provider_change_log still records every actual mutation — the
 *     audit history is preserved so a future throttle can be
 *     reintroduced as a pure read-side change.
 *
 * Harness gate:
 *   Mutates real Supabase rows (providers, provider_areas,
 *   provider_plans, provider_change_log). Opt-in via
 *   QA_HARNESS_RECONCILE=1. Skips cleanly when the flag is unset.
 *
 * Required env (when running):
 *   QA_HARNESS_RECONCILE=1
 *   NEXT_PUBLIC_SUPABASE_URL=…
 *   SUPABASE_SERVICE_ROLE_KEY=…
 *   AUTH_SESSION_SECRET=…
 */

import type { APIRequestContext } from "@playwright/test";

import { test, expect } from "../_support/test";
import { appUrl } from "../_support/runtime";
import {
  buildSignedAuthCookie,
  cleanupHarnessRows,
  isReconcileHarnessEnabled,
  seedDummyProvider,
  type SeededProvider,
} from "../_support/qaReconcile";

const SKIP_REASON =
  "QA_HARNESS_RECONCILE=1 not set — server-side region change rules spec requires the QA harness env (Supabase service-role key + AUTH_SESSION_SECRET)";

function supabaseEnv(): { url: string; serviceKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  if (!url || !serviceKey) {
    throw new Error(
      "region-change-rules spec requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return { url, serviceKey };
}

function supabaseHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation,resolution=merge-duplicates",
  };
}

async function upsertProviderPlan(
  request: APIRequestContext,
  providerId: string,
  row: {
    plan_code: string;
    max_regions: number;
    current_period_start: string | null;
    current_period_end: string | null;
  }
): Promise<void> {
  const env = supabaseEnv();
  const response = await request.fetch(`${env.url}/rest/v1/provider_plans`, {
    method: "POST",
    headers: supabaseHeaders(env.serviceKey),
    data: JSON.stringify([
      {
        provider_id: providerId,
        plan_code: row.plan_code,
        max_regions: row.max_regions,
        current_period_start: row.current_period_start,
        current_period_end: row.current_period_end,
        last_payment_id: "QA_HARNESS",
        updated_at: new Date().toISOString(),
      },
    ]),
  });
  if (!response.ok()) {
    throw new Error(
      `provider_plans upsert failed ${response.status()}: ${await response.text()}`
    );
  }
}

async function deleteProviderPlan(
  request: APIRequestContext,
  providerId: string
): Promise<void> {
  const env = supabaseEnv();
  await request.fetch(
    `${env.url}/rest/v1/provider_plans?provider_id=eq.${encodeURIComponent(providerId)}`,
    { method: "DELETE", headers: supabaseHeaders(env.serviceKey) }
  );
}

async function seedProviderAreas(
  request: APIRequestContext,
  providerId: string,
  rows: { area: string; city_code: string; region_code: string | null }[]
): Promise<void> {
  const env = supabaseEnv();
  await request.fetch(
    `${env.url}/rest/v1/provider_areas?provider_id=eq.${encodeURIComponent(providerId)}`,
    { method: "DELETE", headers: supabaseHeaders(env.serviceKey) }
  );
  if (rows.length === 0) return;
  const response = await request.fetch(`${env.url}/rest/v1/provider_areas`, {
    method: "POST",
    headers: supabaseHeaders(env.serviceKey),
    data: JSON.stringify(
      rows.map((r) => ({
        provider_id: providerId,
        area: r.area,
        city_code: r.city_code,
        region_code: r.region_code,
      }))
    ),
  });
  if (!response.ok()) {
    throw new Error(
      `provider_areas seed failed ${response.status()}: ${await response.text()}`
    );
  }
}

async function seedProviderServices(
  request: APIRequestContext,
  providerId: string,
  categories: string[]
): Promise<void> {
  const env = supabaseEnv();
  await request.fetch(
    `${env.url}/rest/v1/provider_services?provider_id=eq.${encodeURIComponent(providerId)}`,
    { method: "DELETE", headers: supabaseHeaders(env.serviceKey) }
  );
  if (categories.length === 0) return;
  await request.fetch(`${env.url}/rest/v1/provider_services`, {
    method: "POST",
    headers: supabaseHeaders(env.serviceKey),
    data: JSON.stringify(
      categories.map((c) => ({ provider_id: providerId, category: c }))
    ),
  });
}

async function deleteChangeLog(
  request: APIRequestContext,
  providerId: string
): Promise<void> {
  const env = supabaseEnv();
  await request.fetch(
    `${env.url}/rest/v1/provider_change_log?provider_id=eq.${encodeURIComponent(providerId)}`,
    { method: "DELETE", headers: supabaseHeaders(env.serviceKey) }
  );
}

async function countChangeLogRows(
  request: APIRequestContext,
  providerId: string,
  changeType?: "region_change" | "category_change"
): Promise<number> {
  const env = supabaseEnv();
  const query = changeType
    ? `provider_id=eq.${encodeURIComponent(providerId)}&change_type=eq.${changeType}`
    : `provider_id=eq.${encodeURIComponent(providerId)}`;
  const response = await request.fetch(
    `${env.url}/rest/v1/provider_change_log?${query}&select=id`,
    {
      method: "GET",
      headers: {
        ...supabaseHeaders(env.serviceKey),
        Prefer: "count=exact",
      },
    }
  );
  const contentRange = response.headers()["content-range"] ?? "";
  const total = contentRange.split("/")[1];
  return Number.isFinite(Number(total)) ? Number(total) : 0;
}

async function callProviderUpdate(
  request: APIRequestContext,
  providerPhone: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const cookie = buildSignedAuthCookie(providerPhone);
  const response = await request.post(appUrl("/api/provider/update"), {
    headers: {
      "Content-Type": "application/json",
      Cookie: `kk_auth_session=${encodeURIComponent(cookie)}`,
    },
    data: body,
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: response.status(), json };
}

const TEST_CATEGORY = "Plumber";
const QA_CITY = "JOD";

test.describe("Server-side region/category change rules — MVP (no monthly throttle)", () => {
  test.skip(!isReconcileHarnessEnabled(), SKIP_REASON);

  let seeded: SeededProvider | null = null;

  test.beforeAll(async ({ request }) => {
    seeded = await seedDummyProvider(request, {
      phoneSuffix: 720,
      name: "ZZ_QA_LIMIT_RULES",
      status: "active",
      verified: "yes",
    });
  });

  test.afterAll(async ({ request }) => {
    await cleanupHarnessRows(request);
  });

  test.beforeEach(async ({ request }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await deleteChangeLog(request, seeded.providerId);
    await deleteProviderPlan(request, seeded.providerId);
    await seedProviderServices(request, seeded.providerId, [TEST_CATEGORY]);
    await seedProviderAreas(request, seeded.providerId, []);
  });

  test("T1. Plan cap still rejects an over-cap addition (regions_5 → 6)", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "regions_5",
      max_regions: 5,
      current_period_start: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
      current_period_end: new Date(
        Date.now() + 23 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
    await seedProviderAreas(request, seeded.providerId, []);

    const result = await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: [TEST_CATEGORY],
      areas: ["A1", "A2", "A3", "A4", "A5", "A6"],
      cityCode: QA_CITY,
      selectedRegionCodes: [
        "JOD-01",
        "JOD-02",
        "JOD-03",
        "JOD-04",
        "JOD-06",
        "JOD-07",
      ],
    });
    expect(result.status).toBe(400);
    expect(result.json?.error).toBe("PLAN_LIMIT_EXCEEDED");
  });

  test("T2. Strict over-plan reduction still passes (7 → 6 on regions_5)", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await seedProviderAreas(request, seeded.providerId, [
      { area: "A1", city_code: QA_CITY, region_code: "JOD-01" },
      { area: "A2", city_code: QA_CITY, region_code: "JOD-02" },
      { area: "A3", city_code: QA_CITY, region_code: "JOD-03" },
      { area: "A4", city_code: QA_CITY, region_code: "JOD-04" },
      { area: "A5", city_code: QA_CITY, region_code: "JOD-06" },
      { area: "A6", city_code: QA_CITY, region_code: "JOD-07" },
      { area: "A7", city_code: QA_CITY, region_code: "JOD-10" },
    ]);
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "regions_5",
      max_regions: 5,
      current_period_start: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
      current_period_end: new Date(
        Date.now() + 23 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });

    const result = await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: [TEST_CATEGORY],
      areas: ["A1", "A2", "A3", "A4", "A5", "A6"],
      cityCode: QA_CITY,
      selectedRegionCodes: [
        "JOD-01",
        "JOD-02",
        "JOD-03",
        "JOD-04",
        "JOD-06",
        "JOD-07",
      ],
    });
    expect(result.json?.error).not.toBe("PLAN_LIMIT_EXCEEDED");
    expect(result.json?.error).not.toBe("MONTHLY_CHANGE_LIMIT_EXCEEDED");
  });

  test("T3. Repeated additions in a row all succeed; the old monthly throttle is gone", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "regions_5",
      max_regions: 5,
      current_period_start: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
      current_period_end: new Date(
        Date.now() + 23 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
    await seedProviderAreas(request, seeded.providerId, []);

    // Three saves back-to-back, each adding a new region.
    const saves = [
      {
        areas: ["A1"],
        codes: ["JOD-01"],
      },
      {
        areas: ["A1", "A2"],
        codes: ["JOD-01", "JOD-02"],
      },
      {
        areas: ["A1", "A2", "A3"],
        codes: ["JOD-01", "JOD-02", "JOD-03"],
      },
    ];
    for (const save of saves) {
      const result = await callProviderUpdate(request, seeded.phone, {
        name: seeded.name,
        categories: [TEST_CATEGORY],
        areas: save.areas,
        cityCode: QA_CITY,
        selectedRegionCodes: save.codes,
      });
      expect(result.json?.error).not.toBe("MONTHLY_CHANGE_LIMIT_EXCEEDED");
    }
  });

  test("T4. provider_change_log still records each actual mutation (audit preserved)", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "regions_5",
      max_regions: 5,
      current_period_start: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
      current_period_end: new Date(
        Date.now() + 23 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
    await seedProviderAreas(request, seeded.providerId, []);

    // Initial save adds 2 regions.
    await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: [TEST_CATEGORY],
      areas: ["A1", "A2"],
      cityCode: QA_CITY,
      selectedRegionCodes: ["JOD-01", "JOD-02"],
    });
    const afterFirst = await countChangeLogRows(
      request,
      seeded.providerId,
      "region_change"
    );
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    // Second save adds 1 more region.
    await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: [TEST_CATEGORY],
      areas: ["A1", "A2", "A3"],
      cityCode: QA_CITY,
      selectedRegionCodes: ["JOD-01", "JOD-02", "JOD-03"],
    });
    const afterSecond = await countChangeLogRows(
      request,
      seeded.providerId,
      "region_change"
    );
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });
});
