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

test.describe("All Jodhpur — Phase 3 UI", () => {
  test("1. tile is visible by default, collapses the picker on click, and can be cleared", async ({
    page,
  }) => {
    await mockAreaCatalog(page);
    await gotoPath(page, "/request-flow?category=Electrician");

    // Default: normal picker is visible. Wait for ENABLED (not just visible)
    // so the client has hydrated before we interact.
    await expect(page.locator("#geo-city")).toBeVisible();
    await expect(page.getByTestId("detect-my-area")).toBeEnabled();
    // The tile is a first-class option — no typing required to discover it.
    await expect(page.getByTestId("all-jodhpur-tile")).toBeVisible();
    await expect(page.getByTestId("all-jodhpur-chip")).toHaveCount(0);

    // Click tile → picker controls gone, chip shown.
    await page.getByTestId("all-jodhpur-tile").click();
    await expect(page.getByTestId("all-jodhpur-chip")).toBeVisible();
    await expect(page.getByTestId("detect-my-area")).toHaveCount(0);
    await expect(page.locator("#geo-city")).toHaveCount(0);
    await expect(
      page.getByTestId("area-input")
    ).toHaveCount(0);

    // Clear → picker restored, chip gone, tile back.
    await page.getByTestId("all-jodhpur-clear").click();
    await expect(page.getByTestId("all-jodhpur-chip")).toHaveCount(0);
    await expect(page.locator("#geo-city")).toBeVisible();
    await expect(page.getByTestId("all-jodhpur-tile")).toBeVisible();
  });

  test("2. clicking the tile and submitting posts scope='all_jodhpur' and area='All Jodhpur'", async ({
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

    // Required fields: time + (all-city) area via the tile.
    await page.getByRole("button", { name: "Right now" }).click();
    await page.getByTestId("all-jodhpur-tile").click();
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

  test("4. typing 'jodhpur' offers Search across all Jodhpur (not the bare city) and submits all_jodhpur", async ({
    page,
  }) => {
    await mockAreaCatalog(page);
    // Catalog includes the bare "Jodhpur" alias + an "Outer Jodhpur" area to
    // prove the bare city is suppressed while real areas survive.
    await mockJson(
      page,
      "**/api/areas**",
      jsonOk({
        city_code: "JOD",
        areas: ["Sardarpura", "Shastri Nagar", "Ratanada", "Jodhpur", "Outer Jodhpur"],
      })
    );

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
        body: JSON.stringify({ ok: true, taskId: "TK-UI-4", displayId: "4" }),
      });
    });
    await mockJson(page, "**/api/find-provider**", jsonOk({ providers: [], count: 0 }));
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 0 })
    );

    await gotoPath(page, "/request-flow?category=Electrician");
    await expect(page.getByTestId("detect-my-area")).toBeEnabled();

    await page.getByTestId("area-input").fill("jodhpur");

    // The All-Jodhpur option appears; the bare "Jodhpur" area does not.
    await expect(page.getByTestId("all-jodhpur-suggestion")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Jodhpur", exact: true })
    ).toHaveCount(0);

    await page.getByTestId("all-jodhpur-suggestion").click();
    await expect(page.getByTestId("all-jodhpur-chip")).toBeVisible();

    await page.getByRole("button", { name: "Right now" }).click();
    await page.getByRole("button", { name: "Submit Request" }).click();

    await expect.poll(() => captured).not.toBeNull();
    expect(captured!.scope).toBe("all_jodhpur");
    expect(captured!.area).toBe("All Jodhpur");
  });

  test("5. selecting a normal area (Sardarpura) submits scope='region'", async ({
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
        body: JSON.stringify({ ok: true, taskId: "TK-UI-5", displayId: "5" }),
      });
    });
    await mockJson(page, "**/api/find-provider**", jsonOk({ providers: [], count: 0 }));
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 0 })
    );

    await gotoPath(page, "/request-flow?category=Electrician");
    await expect(page.getByTestId("detect-my-area")).toBeEnabled();

    // Pick a normal area via the popular-region chip.
    await page
      .getByRole("button", { name: "Sardarpura", exact: true })
      .first()
      .click();
    await expect(page.getByText("Selected area/region")).toBeVisible();

    await page.getByRole("button", { name: "Right now" }).click();
    await page.getByRole("button", { name: "Submit Request" }).click();

    await expect.poll(() => captured).not.toBeNull();
    expect(captured!.scope).toBe("region");
    expect(captured!.area).toBe("Sardarpura");
  });

  test("6. all-city empty result shows the helpful message, not region providers", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({ providers: [], count: 0, matchTier: "all_jodhpur", usedFallback: false })
    );
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 0 })
    );

    await gotoPath(
      page,
      "/success?service=Electrician&area=All%20Jodhpur&taskId=TK-UI-6"
    );

    await expect(page.getByTestId("all-jodhpur-empty")).toBeVisible();
    await expect(page.getByTestId("all-jodhpur-empty")).toContainText(
      "serving all of Jodhpur"
    );
    await expect(page.getByTestId("all-jodhpur-empty")).toContainText(
      "Choose your area to see local providers"
    );
    // No provider group sections rendered (no free/region providers shown).
    await expect(
      page.locator('section[data-testid^="provider-group-"]')
    ).toHaveCount(0);

    // CTA returns to request-flow with the category preserved and NO scope
    // param (so the picker starts in normal region mode, not all-city).
    const cta = page.getByTestId("all-jodhpur-choose-area");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText("Choose Area Instead");
    await expect(cta).toHaveAttribute("href", "/request-flow?category=Electrician");
  });
});
