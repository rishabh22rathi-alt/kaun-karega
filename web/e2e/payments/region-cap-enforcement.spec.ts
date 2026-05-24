/**
 * Server-side region-cap enforcement on /api/provider/update.
 *
 * Verifies the rule the Razorpay-first flow rests on: the provider's
 * effective plan caps `selectedRegionCodes.length` server-side. UI is
 * not exercised here — we hit the route directly with a signed
 * kk_auth_session cookie so the test fails fast and uniformly.
 *
 *   free        → max 1; 2 must be rejected
 *   regions_5   → max 5; 5 must be accepted, 6 must be rejected
 *   all_jodhpur → cityWide; no per-count cap (whole-city by design)
 *
 * Harness gate:
 *   This spec mutates real Supabase rows (providers + provider_plans)
 *   and writes plan rows that only the Razorpay webhook normally writes.
 *   It is opt-in via QA_HARNESS_RECONCILE=1, the same flag the existing
 *   provider-approval reconciliation suite uses. When the flag is unset
 *   the suite skips cleanly so default CI runs are unaffected.
 *
 * Required env (when running):
 *   QA_HARNESS_RECONCILE=1
 *   NEXT_PUBLIC_SUPABASE_URL=…
 *   SUPABASE_SERVICE_ROLE_KEY=…
 *   AUTH_SESSION_SECRET=…   (same secret the dev server uses)
 *
 * Cleanup: piggy-backs on cleanupHarnessRows() — providers are tagged
 * pledge_version=QA_HARNESS_RECONCILE so the existing marker-based
 * cleanup also removes the provider_plans rows we wrote (the cleanup
 * helper already includes provider_plans in its delete list).
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
  "QA_HARNESS_RECONCILE=1 not set — region-cap enforcement spec requires the QA harness env (Supabase service-role key + AUTH_SESSION_SECRET)";

function supabaseEnv(): { url: string; serviceKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  if (!url || !serviceKey) {
    throw new Error(
      "region-cap spec requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
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
        current_period_start: new Date().toISOString(),
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
    {
      method: "DELETE",
      headers: supabaseHeaders(env.serviceKey),
    }
  );
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

// 25 region codes mirror the real JOD service-region count; we slice
// for each scenario. The codes don't need to match real DB rows for
// the cap check itself — /api/provider/update enforces by counting the
// deduped string array against the plan's maxRegions before any DB
// write that depends on the values. (The downstream
// updateProviderInSupabase call may fail with non-existent region
// codes but that's a different error and would still surface as a
// non-PLAN_LIMIT response — our assertions verify the specific
// PLAN_LIMIT_EXCEEDED branch.)
const REGION_POOL = Array.from({ length: 25 }, (_, i) => `R-TEST-${i + 1}`);

test.describe("Region cap enforcement on /api/provider/update", () => {
  test.skip(!isReconcileHarnessEnabled(), SKIP_REASON);

  let seeded: SeededProvider | null = null;

  test.beforeAll(async ({ request }) => {
    seeded = await seedDummyProvider(request, {
      phoneSuffix: 700,
      name: "ZZ_QA_REGION_CAP",
      status: "active",
      verified: "yes",
    });
  });

  test.afterAll(async ({ request }) => {
    // Reuse the marker-based cleanup so provider + provider_plans rows
    // are removed by pledge_version match.
    await cleanupHarnessRows(request);
  });

  test("free plan rejects 2 selectedRegionCodes with PLAN_LIMIT_EXCEEDED", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    // No provider_plans row → implicit free.
    await deleteProviderPlan(request, seeded.providerId);

    const result = await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: ["Plumber"],
      areas: ["Sardarpura", "Shastri Nagar"],
      selectedRegionCodes: REGION_POOL.slice(0, 2),
    });
    expect(result.status).toBe(400);
    expect(result.json?.ok).toBe(false);
    expect(result.json?.error).toBe("PLAN_LIMIT_EXCEEDED");
    expect(result.json?.planCode).toBe("free");
    expect(result.json?.maxRegions).toBe(1);
    expect(result.json?.attempted).toBe(2);
  });

  test("regions_5 plan accepts 5 selectedRegionCodes (cap boundary)", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "regions_5",
      max_regions: 5,
      current_period_end: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });

    const result = await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: ["Plumber"],
      areas: ["Sardarpura", "Shastri Nagar"],
      selectedRegionCodes: REGION_POOL.slice(0, 5),
    });
    // Cap-check passes; downstream area write may fail on
    // non-existent test region codes — assert NOT the cap error.
    expect(result.json?.error).not.toBe("PLAN_LIMIT_EXCEEDED");
  });

  test("regions_5 plan rejects 6 selectedRegionCodes with PLAN_LIMIT_EXCEEDED", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "regions_5",
      max_regions: 5,
      current_period_end: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });

    const result = await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: ["Plumber"],
      areas: ["Sardarpura", "Shastri Nagar"],
      selectedRegionCodes: REGION_POOL.slice(0, 6),
    });
    expect(result.status).toBe(400);
    expect(result.json?.error).toBe("PLAN_LIMIT_EXCEEDED");
    expect(result.json?.planCode).toBe("regions_5");
    expect(result.json?.maxRegions).toBe(5);
    expect(result.json?.attempted).toBe(6);
  });

  test("all_jodhpur plan accepts the entire region set (cityWide, no per-count cap)", async ({
    request,
  }) => {
    if (!seeded) throw new Error("Provider not seeded");
    await upsertProviderPlan(request, seeded.providerId, {
      plan_code: "all_jodhpur",
      max_regions: 99,
      current_period_end: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });

    const result = await callProviderUpdate(request, seeded.phone, {
      name: seeded.name,
      categories: ["Plumber"],
      areas: ["Sardarpura", "Shastri Nagar"],
      selectedRegionCodes: REGION_POOL,
    });
    // cityWide rule has no per-count check; cap branch must not fire.
    expect(result.json?.error).not.toBe("PLAN_LIMIT_EXCEEDED");
  });
});
