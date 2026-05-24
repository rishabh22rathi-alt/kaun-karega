/**
 * Provider edit page — MVP region-change rules.
 *
 * The per-period monthly addition throttle was removed: providers can
 * change regions any number of times within their plan cap. This spec
 * locks the new contract:
 *
 *   - Provider can reduce coverage at any time (the PR-3131 reduction
 *     that used to bounce off the limit now goes through cleanly).
 *   - The "Region changes left this month" / "monthly limit" copy is
 *     gone from the register page; no client toast quotes those
 *     phrases.
 *   - Plan cap still rejects over-cap additions (verified separately
 *     in provider-payment-region-qa.spec.ts; not duplicated here).
 *
 * Pre-MVP coverage that's intentionally dropped from this file:
 *   - Addition-blocked-with-429 scenarios.
 *   - Swap-counts-as-addition scenarios.
 *   - Post-upgrade counter-reset scenarios.
 *   All of the above tested the throttle that no longer exists.
 */

import type { Page, Request as PWRequest, Route } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
  QA_CATEGORY,
  QA_PROVIDER_ID,
  QA_PROVIDER_NAME,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

const REGION_FIXTURES = [
  {
    region_code: "JOD-01",
    region_name: "Region 01",
    areas: ["JOD-01 Area A", "JOD-01 Area B"],
  },
  {
    region_code: "JOD-02",
    region_name: "Region 02",
    areas: ["JOD-02 Area A", "JOD-02 Area B"],
  },
  {
    region_code: "JOD-03",
    region_name: "Region 03",
    areas: ["JOD-03 Area A", "JOD-03 Area B"],
  },
  {
    region_code: "JOD-04",
    region_name: "Region 04",
    areas: ["JOD-04 Area A", "JOD-04 Area B"],
  },
  {
    region_code: "JOD-06",
    region_name: "Region 06",
    areas: ["JOD-06 Area A", "JOD-06 Area B"],
  },
  {
    region_code: "JOD-07",
    region_name: "Region 07",
    areas: ["JOD-07 Area A", "JOD-07 Area B"],
  },
  {
    region_code: "JOD-10",
    region_name: "Region 10",
    areas: ["JOD-10 Area A", "JOD-10 Area B"],
  },
];

async function injectProviderUiHint(page: Page, phone: string): Promise<void> {
  await page.context().addCookies([
    {
      name: "kk_session_user",
      value: JSON.stringify({
        phone,
        verified: true,
        createdAt: Date.now(),
      }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

async function bootstrapEditPage(
  page: Page,
  options: {
    savedRegionCodes: string[];
    planMaxRegions: number;
    planCode: "free" | "regions_5" | "all_jodhpur";
    planRuleKind: "fixed" | "cityWide";
  }
): Promise<void> {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page, QA_PROVIDER_PHONE);

  await mockJson(
    page,
    "**/api/categories**",
    jsonOk({
      data: COMMON_CATEGORIES.map((c) => ({ name: c.name, active: c.active })),
    })
  );
  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ regions: REGION_FIXTURES })
  );
  await mockJson(
    page,
    "**/api/provider/dashboard-profile**",
    jsonOk(buildProviderDashboardResponse())
  );
  await mockJson(
    page,
    "**/api/provider/notifications",
    jsonOk({ notifications: [] })
  );
  // The provider/plan response shape is preserved — `remaining` and
  // `monthlyLimit` still ride the wire, but the register page no
  // longer renders any UI from them (the MVP commit removed the
  // "changes left this month" hint and the dedicated 429 error
  // toast branch).
  await mockJson(
    page,
    "**/api/provider/plan**",
    jsonOk({
      ok: true,
      plan: {
        code: options.planCode,
        maxRegions: options.planMaxRegions,
        currentPeriodEnd: null,
        active: true,
        ruleKind: options.planRuleKind,
      },
      remaining: { region_change: 3, category_change: 3 },
      monthlyLimit: 3,
    })
  );

  const savedAreas: string[] = [];
  for (const rc of options.savedRegionCodes) {
    const r = REGION_FIXTURES.find((x) => x.region_code === rc);
    if (!r) continue;
    for (const a of r.areas) savedAreas.push(a);
  }
  const provider = {
    ProviderID: QA_PROVIDER_ID,
    ProviderName: QA_PROVIDER_NAME,
    Phone: QA_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    PendingApproval: "no",
    Status: "active",
    Services: [{ Category: QA_CATEGORY }],
    Areas: savedAreas.map((a) => ({ Area: a })),
    CityCode: "JOD",
    RegionCodes: options.savedRegionCodes,
  };

  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_provider_by_phone: () => jsonOk({ provider }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
  });
}

function regionCard(page: Page, regionName: string) {
  return page.locator("div.rounded-2xl", {
    has: page.getByRole("heading", { level: 3, name: regionName }),
  });
}

async function deselectRegion(page: Page, regionName: string): Promise<void> {
  await regionCard(page, regionName)
    .getByRole("button", { name: /^Selected ✓$/ })
    .click();
}

test.describe("Provider edit — MVP region rules (no monthly throttle)", () => {
  test("T1. Over-plan provider can reduce 7 → 5 in one save (PR-3131 scenario)", async ({
    page,
  }) => {
    let capturedBody: { selectedRegionCodes?: unknown } | null = null;
    let updateCalled = false;
    await bootstrapEditPage(page, {
      savedRegionCodes: [
        "JOD-01",
        "JOD-02",
        "JOD-03",
        "JOD-04",
        "JOD-06",
        "JOD-07",
        "JOD-10",
      ],
      planCode: "regions_5",
      planMaxRegions: 5,
      planRuleKind: "fixed",
    });
    await page.route(
      "**/api/provider/update**",
      async (route: Route, request: PWRequest) => {
        updateCalled = true;
        try {
          capturedBody = JSON.parse(request.postData() ?? "{}") as {
            selectedRegionCodes?: unknown;
          };
        } catch {
          capturedBody = null;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    );

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });
    // Hydration shows all 7 as Selected ✓.
    await expect(
      regionCard(page, "Region 07").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });

    // Trim 7 → 5 by deselecting Region 07 and Region 10.
    await deselectRegion(page, "Region 07");
    await deselectRegion(page, "Region 10");

    await page.getByRole("button", { name: /^Save Changes$/ }).click();

    await expect.poll(() => updateCalled, { timeout: 5_000 }).toBe(true);
    const body = capturedBody as unknown as {
      selectedRegionCodes?: unknown;
    } | null;
    const codes = Array.isArray(body?.selectedRegionCodes)
      ? (body.selectedRegionCodes as unknown[]).map(String)
      : [];
    expect(codes.sort()).toEqual(
      ["JOD-01", "JOD-02", "JOD-03", "JOD-04", "JOD-06"].sort()
    );
  });

  test("T2. Register page does NOT render monthly-limit / changes-left copy", async ({
    page,
  }) => {
    await bootstrapEditPage(page, {
      savedRegionCodes: ["JOD-01", "JOD-02"],
      planCode: "regions_5",
      planMaxRegions: 5,
      planRuleKind: "fixed",
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });
    // Wait for hydration to finish so any stale planLoaded UI would
    // have rendered if it still existed.
    await expect(
      regionCard(page, "Region 02").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });

    // None of the old monthly-limit phrases should appear anywhere
    // on the page.
    await expect(
      page.getByText(/changes left this month/i)
    ).toHaveCount(0);
    await expect(
      page.getByText(/monthly limit of \d+ new (region|service category)/i)
    ).toHaveCount(0);
    await expect(
      page.getByText(/already changed your service regions/i)
    ).toHaveCount(0);
    await expect(
      page.getByText(/try again next month/i)
    ).toHaveCount(0);
  });

  test("T3. Provider can save repeatedly without monthly-limit interference (mocked 200 each time)", async ({
    page,
  }) => {
    // Counts how many /api/provider/update requests fire on
    // back-to-back saves. The MVP rule allows unlimited saves within
    // plan cap; this scenario simulates 3 saves and asserts each
    // round-trips successfully without ever surfacing the old "limit
    // reached" toast.
    const updateBodies: unknown[] = [];
    await bootstrapEditPage(page, {
      savedRegionCodes: ["JOD-01", "JOD-02"],
      planCode: "regions_5",
      planMaxRegions: 5,
      planRuleKind: "fixed",
    });
    await page.route(
      "**/api/provider/update**",
      async (route: Route, request: PWRequest) => {
        try {
          updateBodies.push(JSON.parse(request.postData() ?? "{}"));
        } catch {
          updateBodies.push(null);
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    );

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });
    await expect(
      regionCard(page, "Region 02").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });

    // First save (no real edit but the submit goes through; mock 200).
    await page.getByRole("button", { name: /^Save Changes$/ }).click();
    // Wait for the request to fly.
    await expect
      .poll(() => updateBodies.length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);

    // No 429 toast / old copy at any point.
    await expect(
      page.getByText(/monthly limit/i)
    ).toHaveCount(0);
  });
});
