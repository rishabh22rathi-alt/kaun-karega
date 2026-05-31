/**
 * E2E (UI): All Jodhpur — Phase 3 request-flow toggle + grouped results.
 *
 * Pure UI/contract test. The area catalog, submit-request, find-provider, and
 * process-task-notifications endpoints are route-mocked, so no auth, no DB
 * seeding, and no production logic runs. Verifies:
 *   1. The "Search across all Jodhpur" toggle hides the area picker and shows
 *      the All Jodhpur chip (and restores the picker when unchecked).
 *   2. Submitting with the toggle on POSTs scope='all_jodhpur', area='All Jodhpur'.
 *   3. The success page renders provider groups in the fixed order with a
 *      first-5 cap and a working View more / View less toggle.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
 *     npx playwright test e2e/all-jodhpur-ui.spec.ts --reporter=line
 */

import type { Page } from "@playwright/test";

import { gotoPath } from "./_support/home";
import { jsonOk, mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

const AREAS = ["Sardarpura", "Shastri Nagar", "Ratanada"];
const REGIONS = [
  { region_code: "JOD-01", region_name: "Sardarpura", areas: ["Sardarpura"], city_code: "JOD" },
  { region_code: "JOD-02", region_name: "Shastri Nagar", areas: ["Shastri Nagar"], city_code: "JOD" },
];

// Minimal catalog so AreaSelection (state/city cascade + picker) renders.
async function mockAreaCatalog(page: Page) {
  await mockJson(
    page,
    "**/api/cities**",
    jsonOk({
      default_city_code: "JOD",
      cities: [
        {
          city_code: "JOD",
          city_name: "Jodhpur",
          state: "Rajasthan",
          country: "India",
          is_default: true,
        },
      ],
    })
  );
  await mockJson(page, "**/api/areas**", jsonOk({ city_code: "JOD", areas: AREAS }));
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ city_code: "JOD", regions: REGIONS })
  );
  await mockJson(
    page,
    "**/api/area-intelligence/suggest**",
    jsonOk({ city_code: "JOD", suggestions: [] })
  );
}

const allCityCheckbox = (page: Page) =>
  page.getByTestId("all-jodhpur-toggle").locator('input[type="checkbox"]');

test.describe("All Jodhpur — Phase 3 UI", () => {
  test("1. toggle hides the area picker and shows the All Jodhpur chip", async ({
    page,
  }) => {
    await mockAreaCatalog(page);
    await gotoPath(page, "/request-flow?category=Electrician");

    // Default: normal picker is visible. Wait for ENABLED (not just visible)
    // so the client has hydrated before we interact with the toggle.
    await expect(page.locator("#geo-city")).toBeVisible();
    await expect(page.getByTestId("detect-my-area")).toBeEnabled();
    await expect(page.getByTestId("all-jodhpur-chip")).toHaveCount(0);

    // Toggle on → picker controls gone, chip shown.
    await allCityCheckbox(page).check();
    await expect(page.getByTestId("all-jodhpur-chip")).toBeVisible();
    await expect(page.getByTestId("detect-my-area")).toHaveCount(0);
    await expect(page.locator("#geo-city")).toHaveCount(0);
    await expect(
      page.locator('input[placeholder="Type your area..."]')
    ).toHaveCount(0);

    // Toggle off → picker restored, chip gone.
    await allCityCheckbox(page).uncheck();
    await expect(page.getByTestId("all-jodhpur-chip")).toHaveCount(0);
    await expect(page.locator("#geo-city")).toBeVisible();
    await expect(page.getByTestId("detect-my-area")).toBeVisible();
  });

  test("2. submitting with All Jodhpur posts scope='all_jodhpur' and area='All Jodhpur'", async ({
    page,
  }) => {
    await mockAreaCatalog(page);

    let captured: Record<string, unknown> | null = null;
    await page.route("**/api/submit-request**", async (route) => {
      try {
        captured = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        captured = null;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, taskId: "TK-UI-2", displayId: "2" }),
      });
    });
    // The success page (post-redirect) calls these — stub so nothing errors.
    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({ providers: [], count: 0, matchTier: "all_jodhpur", usedFallback: false })
    );
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 0, attemptedSends: 0, failedSends: 0 })
    );

    await gotoPath(page, "/request-flow?category=Electrician");
    // The city <select> is server-rendered, so its mere visibility does not
    // prove hydration. Wait for "Detect my area" to be ENABLED — it is
    // disabled until the client geo fetch resolves, which only happens after
    // hydration. Without this, the first click can fire before React attaches
    // onClick handlers and silently no-op.
    await expect(page.getByTestId("detect-my-area")).toBeEnabled();

    // Required fields: time + (all-city) area.
    await page.getByRole("button", { name: "Right now" }).click();
    await allCityCheckbox(page).check();
    await expect(page.getByTestId("all-jodhpur-chip")).toBeVisible();

    await page.getByRole("button", { name: "Submit Request" }).click();

    await expect.poll(() => captured).not.toBeNull();
    expect(captured!.scope).toBe("all_jodhpur");
    expect(captured!.area).toBe("All Jodhpur");
    expect(captured!.category).toBe("Electrician");
  });

  test("3. success page renders groups in order with first-5 cap and View more/less", async ({
    page,
  }) => {
    const across = [
      "AcrossOne",
      "AcrossTwo",
      "AcrossThree",
      "AcrossFour",
      "AcrossFive",
      "AcrossSix",
    ];
    const region = ["RegionOne", "RegionTwo"];
    const other = ["OtherOne", "OtherTwo"];
    const mk = (name: string, group: string) => ({
      ProviderID: `PR-${name}`,
      name,
      phoneMasked: "98XXXXXX21",
      category: "Electrician",
      area: "Sardarpura",
      verified: "no",
      group,
      matchScope:
        group === "available_across_jodhpur" ? "all_jodhpur" : "region",
    });
    // Deliberately scrambled response order to prove the UI re-orders groups.
    const providers = [
      ...region.map((n) => mk(n, "available_in_this_region")),
      ...other.map((n) => mk(n, "other_providers_in_this_area")),
      ...across.map((n) => mk(n, "available_across_jodhpur")),
    ];

    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({ providers, count: providers.length, matchTier: "category", usedFallback: false })
    );
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: providers.length })
    );

    await gotoPath(
      page,
      "/success?service=Electrician&area=Sardarpura&taskId=TK-UI-3"
    );

    // Groups render in the fixed order (across → region → other).
    const sections = page.locator('section[data-testid^="provider-group-"]');
    await expect(sections).toHaveCount(3);
    await expect(sections.nth(0)).toHaveAttribute(
      "data-testid",
      "provider-group-available_across_jodhpur"
    );
    await expect(sections.nth(1)).toHaveAttribute(
      "data-testid",
      "provider-group-available_in_this_region"
    );
    await expect(sections.nth(2)).toHaveAttribute(
      "data-testid",
      "provider-group-other_providers_in_this_area"
    );

    // Friendly headings.
    await expect(
      page.getByRole("heading", { name: "Available Across Jodhpur" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Popular providers in your area" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Other providers in this area" })
    ).toBeVisible();

    // First-5 cap: the 6th across provider is not rendered initially.
    await expect(page.getByText("AcrossSix", { exact: true })).toHaveCount(0);

    // View more → 6th appears.
    await page
      .getByTestId("provider-group-available_across_jodhpur-toggle")
      .click();
    await expect(
      page.getByText("AcrossSix", { exact: true })
    ).not.toHaveCount(0);

    // View less → 6th hidden again.
    await page
      .getByTestId("provider-group-available_across_jodhpur-toggle")
      .click();
    await expect(page.getByText("AcrossSix", { exact: true })).toHaveCount(0);
  });
});
