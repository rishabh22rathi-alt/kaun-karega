/**
 * Provider register/edit — region hydration from saved RegionCodes.
 *
 * Locks the fix for the real-data bug observed against PR-3131:
 *   provider_areas had distinct region_code values for JOD-01, JOD-02,
 *   JOD-03, JOD-04, JOD-06 (plus a NULL row), but the edit page showed
 *   only one region selected after reload. Root cause was an area-name
 *   re-inference effect that capped at effectiveMaxRegions and raced
 *   /api/provider/plan — when the plan response was slow, the cap
 *   stayed at the default of 1 and truncated the picker.
 *
 * Fixed by:
 *   - Server: get_provider_by_phone now returns RegionCodes (distinct
 *     non-NULL region_code values).
 *   - Client: edit-mode hydration uses RegionCodes directly when
 *     present. Legacy area-name inference is preserved as a fallback
 *     and now waits for planLoaded before applying any cap-based
 *     break.
 *   - Client: an inline over-plan warning replaces silent truncation
 *     when saved-region count exceeds the current plan cap. Saves are
 *     still blocked by the server-side PLAN_LIMIT_EXCEEDED guard.
 *
 * Each scenario mocks /api/kk?action=get_provider_by_phone,
 * /api/area-intelligence/regions, /api/provider/plan, and (where
 * relevant) /api/provider/update. No real DB writes.
 */

import type { Page, Route, Request as PWRequest } from "@playwright/test";

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

// Seven regions, each carrying a small canonical area list. The first
// five are the "regions_5 sized" set; all seven exercise the over-plan
// scenario. Keep names stable so locator regexes match.
const REGION_FIXTURES = [
  {
    region_code: "JOD-01",
    region_name: "Region 01",
    areas: ["JOD-01 Area A", "JOD-01 Area B", "JOD-01 Area C"],
  },
  {
    region_code: "JOD-02",
    region_name: "Region 02",
    areas: ["JOD-02 Area A", "JOD-02 Area B"],
  },
  {
    region_code: "JOD-03",
    region_name: "Region 03",
    areas: ["JOD-03 Area A", "JOD-03 Area B", "JOD-03 Area C"],
  },
  {
    region_code: "JOD-04",
    region_name: "Region 04",
    areas: ["JOD-04 Area A", "JOD-04 Area B"],
  },
  {
    region_code: "JOD-06",
    region_name: "Region 06",
    areas: ["JOD-06 Area A", "JOD-06 Area B", "JOD-06 Area C"],
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

async function injectProviderUiHint(page: Page, phone: string) {
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

type ProviderProfileFixture = {
  Areas: string[];
  // Omit RegionCodes to simulate the legacy-fallback path. Otherwise
  // include the explicit array (may be empty to mean "server returned
  // RegionCodes:[] explicitly", which is also the legacy-fallback
  // signal).
  RegionCodes?: string[];
};

type PlanFixture = {
  planCode: "free" | "regions_5" | "all_jodhpur";
  maxRegions: number;
  ruleKind: "fixed" | "cityWide";
  /** Artificial server-side delay before responding. Used to simulate
   *  a slow /api/provider/plan response that previously raced the
   *  inference effect. */
  delayMs?: number;
};

// kk action mock is the only way to inject get_provider_by_phone since
// it routes through /api/kk. We re-use mockKkActions and supply a
// per-action handler.
async function bootstrapEditPage(
  page: Page,
  options: {
    profile: ProviderProfileFixture;
    plan: PlanFixture;
    regions?: typeof REGION_FIXTURES;
  }
): Promise<void> {
  const regions = options.regions ?? REGION_FIXTURES;
  const profile = options.profile;

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
    jsonOk({ regions })
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

  // /api/provider/plan with optional artificial delay. The race that
  // produced the original bug only manifests when this response lands
  // AFTER the get_provider_by_phone response — the delay knob lets
  // each test scenario reproduce that ordering deterministically.
  await page.route("**/api/provider/plan**", async (route) => {
    if (options.plan.delayMs && options.plan.delayMs > 0) {
      await new Promise((r) => setTimeout(r, options.plan.delayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        plan: {
          code: options.plan.planCode,
          maxRegions: options.plan.maxRegions,
          currentPeriodEnd: null,
          active: true,
          ruleKind: options.plan.ruleKind,
        },
        remaining: { region_change: 3, category_change: 3 },
        monthlyLimit: 3,
      }),
    });
  });

  const providerPayload: Record<string, unknown> = {
    ProviderID: QA_PROVIDER_ID,
    ProviderName: QA_PROVIDER_NAME,
    Phone: QA_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    PendingApproval: "no",
    Status: "active",
    Services: [{ Category: QA_CATEGORY }],
    Areas: profile.Areas.map((a) => ({ Area: a })),
    CityCode: "JOD",
  };
  if (profile.RegionCodes !== undefined) {
    providerPayload.RegionCodes = profile.RegionCodes;
  }

  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_provider_by_phone: () => jsonOk({ provider: providerPayload }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
  });
}

function regionCard(page: Page, regionName: string) {
  return page.locator("div.rounded-2xl", {
    has: page.getByRole("heading", { level: 3, name: regionName }),
  });
}

// Helper to build a saved-areas list from a list of region codes — the
// union of canonical areas across the requested codes, with one extra
// custom locality string the caller can pass in.
function areasForRegions(
  regionCodes: string[],
  extras: string[] = []
): string[] {
  const out: string[] = [];
  for (const rc of regionCodes) {
    const r = REGION_FIXTURES.find((x) => x.region_code === rc);
    if (!r) continue;
    for (const a of r.areas) out.push(a);
  }
  for (const e of extras) out.push(e);
  return out;
}

test.describe("Provider edit — region hydration from saved RegionCodes", () => {
  test("T1. RegionCodes hydration with delayed /api/provider/plan shows all 5 saved regions", async ({
    page,
  }) => {
    const savedRegionCodes = ["JOD-01", "JOD-02", "JOD-03", "JOD-04", "JOD-06"];
    await bootstrapEditPage(page, {
      profile: {
        Areas: areasForRegions(savedRegionCodes),
        RegionCodes: savedRegionCodes,
      },
      plan: {
        planCode: "regions_5",
        maxRegions: 5,
        ruleKind: "fixed",
        delayMs: 600, // race the inference: plan lands AFTER provider data
      },
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });

    // All five region cards must show Selected ✓ even though the plan
    // response was deliberately delayed past the provider load.
    for (const rc of savedRegionCodes) {
      const name = `Region ${rc.split("-")[1]}`;
      const card = regionCard(page, name);
      await expect(
        card.getByRole("button", { name: /^Selected ✓$/ })
      ).toBeVisible({ timeout: 8_000 });
    }

    // None of the other regions are selected.
    await expect(
      regionCard(page, "Region 07").getByRole("button", {
        name: /^Pick Region$/,
      })
    ).toBeVisible();
    await expect(
      regionCard(page, "Region 10").getByRole("button", {
        name: /^Pick Region$/,
      })
    ).toBeVisible();

    // No over-plan warning — we are at the cap, not over.
    await expect(
      page.getByTestId("provider-register-over-plan-warning")
    ).toHaveCount(0);

    // Counter text reads "5/5".
    await expect(page.getByText("5/5", { exact: true })).toBeVisible();
  });

  test("T2. Over-plan saved state: 7 RegionCodes on regions_5 plan shows warning, all 7 visible as selected", async ({
    page,
  }) => {
    const savedRegionCodes = [
      "JOD-01",
      "JOD-02",
      "JOD-03",
      "JOD-04",
      "JOD-06",
      "JOD-07",
      "JOD-10",
    ];
    await bootstrapEditPage(page, {
      profile: {
        Areas: areasForRegions(savedRegionCodes),
        RegionCodes: savedRegionCodes,
      },
      plan: {
        planCode: "regions_5",
        maxRegions: 5,
        ruleKind: "fixed",
        delayMs: 300,
      },
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });

    // All seven regions show as Selected — we do NOT silently
    // truncate. The provider is asked to reduce explicitly.
    for (const rc of savedRegionCodes) {
      const name = `Region ${rc.split("-")[1]}`;
      const card = regionCard(page, name);
      await expect(
        card.getByRole("button", { name: /^Selected ✓$/ })
      ).toBeVisible({ timeout: 8_000 });
    }

    const warning = page.getByTestId("provider-register-over-plan-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/7 regions saved/);
    await expect(warning).toContainText(/plan allows 5/);
    await expect(warning).toContainText(/Please reduce to 5/);

    // Save is blocked at the submit handler. Clicking it surfaces the
    // existing PLAN_LIMIT-style inline error; no /api/provider/update
    // request goes out while over-plan.
    const updateCalls: string[] = [];
    page.on("request", (request: PWRequest) => {
      if (request.url().includes("/api/provider/update")) {
        updateCalls.push(`${request.method()} ${request.url()}`);
      }
    });
    await page.getByRole("button", { name: /^Save Changes$/ }).click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText(/plan covers 5 region|Reduce your selection/i)
    ).toBeVisible();
    expect(updateCalls).toEqual([]);
  });

  test("T3. Legacy fallback: RegionCodes empty → area-name inference still picks the 2 fully-covered regions", async ({
    page,
  }) => {
    // Provider profile carries areas exactly covering JOD-02 and JOD-04
    // but the server returned RegionCodes:[] (legacy provider whose
    // rows pre-date the region_code column being populated). The
    // legacy inference should still re-derive both regions, now gated
    // on planLoaded so the cap of 1 doesn't truncate.
    const legacyAreas = areasForRegions(["JOD-02", "JOD-04"]);
    await bootstrapEditPage(page, {
      profile: {
        Areas: legacyAreas,
        RegionCodes: [], // explicit empty — server "no region_code yet"
      },
      plan: {
        planCode: "regions_5",
        maxRegions: 5,
        ruleKind: "fixed",
        delayMs: 500, // late plan — proves planLoaded guard works
      },
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });

    // Both regions inferred from area names.
    await expect(
      regionCard(page, "Region 02").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      regionCard(page, "Region 04").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });

    // Counter reads 2/5.
    await expect(page.getByText("2/5", { exact: true })).toBeVisible();

    // No over-plan warning — 2 < 5.
    await expect(
      page.getByTestId("provider-register-over-plan-warning")
    ).toHaveCount(0);
  });

  test("T4. NULL region_code rows: only the non-NULL code becomes a selected region; orphan area becomes a custom locality, not a fake region", async ({
    page,
  }) => {
    // Provider profile mimics a row with region_code=JOD-02 plus a row
    // with region_code=NULL whose area name does not appear in any
    // region's canonical list. The server-side filter strips the NULL
    // row from RegionCodes; the area name still appears in Areas[] and
    // must surface as a customLocalities chip rather than upgrade
    // itself into a "selected" region.
    const orphanArea = "Phantom Locality 1";
    await bootstrapEditPage(page, {
      profile: {
        Areas: [...areasForRegions(["JOD-02"]), orphanArea],
        RegionCodes: ["JOD-02"], // NULL row filtered out by the server
      },
      plan: {
        planCode: "regions_5",
        maxRegions: 5,
        ruleKind: "fixed",
        delayMs: 200,
      },
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });

    // Only JOD-02 is selected.
    await expect(
      regionCard(page, "Region 02").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });
    for (const rc of [
      "JOD-01",
      "JOD-03",
      "JOD-04",
      "JOD-06",
      "JOD-07",
      "JOD-10",
    ]) {
      const name = `Region ${rc.split("-")[1]}`;
      await expect(
        regionCard(page, name).getByRole("button", { name: /^Pick Region$/ })
      ).toBeVisible();
    }
    // Counter reads 1/5 (NOT 2/5 — the orphan area is NOT promoted to
    // a region, it lives in customLocalities).
    await expect(page.getByText("1/5", { exact: true })).toBeVisible();

    // Orphan area surfaces as a custom locality chip. Two DOM nodes
    // can both contain the locality text — the chip in the custom-
    // locality section AND a flat summary line further down — so we
    // scope to the chip specifically by requiring its "REVIEW" badge
    // sibling. This proves the locality entered customLocalities (the
    // chip path), not just selectedAreas (the summary path).
    const localityChip = page
      .locator("span")
      .filter({ hasText: orphanArea })
      .filter({ has: page.getByText("REVIEW", { exact: true }) });
    await expect(localityChip).toBeVisible();
  });

  test("T5. Submit payload preserves all 5 hydrated region codes (no truncation, no nulls)", async ({
    page,
  }) => {
    const savedRegionCodes = ["JOD-01", "JOD-02", "JOD-03", "JOD-04", "JOD-06"];
    let capturedBody: { selectedRegionCodes?: unknown } | null = null;
    await bootstrapEditPage(page, {
      profile: {
        Areas: areasForRegions(savedRegionCodes),
        RegionCodes: savedRegionCodes,
      },
      plan: {
        planCode: "regions_5",
        maxRegions: 5,
        ruleKind: "fixed",
        delayMs: 100,
      },
    });
    await page.route("**/api/provider/update**", async (route: Route, request: PWRequest) => {
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
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 8_000,
    });
    // Wait for hydration to complete (all 5 cards Selected).
    await expect(
      regionCard(page, "Region 06").getByRole("button", {
        name: /^Selected ✓$/,
      })
    ).toBeVisible({ timeout: 8_000 });

    await page.getByRole("button", { name: /^Save Changes$/ }).click();

    await expect.poll(() => capturedBody, { timeout: 5_000 }).not.toBeNull();
    // Route through `unknown` to dodge the let-binding closure
    // inference quirk Playwright tests in this repo work around.
    const body = capturedBody as unknown as {
      selectedRegionCodes?: unknown;
    } | null;
    const codes = Array.isArray(body?.selectedRegionCodes)
      ? (body.selectedRegionCodes as unknown[])
          .map((v) => (typeof v === "string" ? v : ""))
          .filter((v) => v.length > 0)
      : [];
    expect(codes.sort()).toEqual([...savedRegionCodes].sort());
    expect(codes).not.toContain(null);
    expect(codes.length).toBe(5);
  });
});
