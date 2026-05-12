/**
 * Provider Dashboard → "Edit Services" → Save Changes button enable rule.
 *
 * Regression coverage for the bug where Save Changes stayed silently
 * disabled until the inference effect happened to produce exactly 3
 * regions. The fix:
 *   1. Removes `selectedRegions.length === MIN_REGIONS` from `canSubmit`
 *      so the button is clickable whenever name + at least one category
 *      are set.
 *   2. Moves the region-count check into `handleSubmit`, surfacing an
 *      inline error if the count is not exactly 3 (mirrors the
 *      existing pledge-gate pattern).
 *   3. Clears `submitError` whenever selectedRegions / customLocalities
 *      change so the inline error disappears as the provider corrects it.
 *
 * The submit payload (`name`, `categories`, `areas`) is unchanged.
 */

import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
  QA_AREA,
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

// The provider/register page reads the client-side UI-hint cookie
// `kk_session_user` (NOT the signed `kk_auth_session`) via getUserPhone()
// at mount; without it the page redirects to /login before the form
// renders. Existing bootstrapProviderSession only sets the signed cookie,
// so we set the UI hint inline here.
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

// Three regions, each backed by a real canonical area in COMMON_AREAS so
// inference can pick them up if the saved provider areas match.
const REGIONS = [
  { region_code: "R-CENTRAL", region_name: "Central Jodhpur", areas: [QA_AREA] },
  { region_code: "R-NORTH", region_name: "North Jodhpur", areas: ["Shastri Nagar"] },
  { region_code: "R-EAST", region_name: "East Jodhpur", areas: ["Ratanada"] },
  { region_code: "R-WEST", region_name: "West Jodhpur", areas: ["Pal Road"] },
];

async function mockProviderEditPage(page: Page, providerAreas: string[]) {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page, QA_PROVIDER_PHONE);

  await mockJson(
    page,
    "**/api/categories**",
    jsonOk({
      data: COMMON_CATEGORIES.map((category) => ({
        name: category.name,
        active: category.active,
      })),
    })
  );

  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));

  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ regions: REGIONS })
  );

  const dashboardResponse = buildProviderDashboardResponse();
  await mockJson(page, "**/api/provider/dashboard-profile**", {
    status: 200,
    body: dashboardResponse,
  });

  const provider = {
    ProviderID: QA_PROVIDER_ID,
    ProviderName: QA_PROVIDER_NAME,
    Phone: QA_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    PendingApproval: "no",
    Status: "active",
    Services: [{ Category: QA_CATEGORY }],
    Areas: providerAreas.map((a) => ({ Area: a })),
  };

  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_provider_by_phone: () => jsonOk({ provider }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
  });
}

async function getSaveButton(page: Page) {
  return page.getByRole("button", { name: /^Save Changes$/ });
}

async function pickRegion(page: Page, regionName: string) {
  // Each region renders as <div class="rounded-2xl ..."> containing an
  // <h3> with the region name and a "Pick Region" / "Selected ✓" button.
  // Anchor on the h3, then walk up to its card ancestor and click the
  // toggle button inside it.
  const card = page.locator("div.rounded-2xl", {
    has: page.getByRole("heading", { level: 3, name: regionName }),
  });
  await card
    .getByRole("button", { name: /^(Pick Region|Selected ✓)$/ })
    .click();
}

test.describe("Provider edit: Save Changes enable + region count validation", () => {
  test("Save Changes is enabled even when inferred regions ≠ 3", async ({
    page,
  }) => {
    // Provider has a single saved area — inference will pick at most one
    // region. Pre-patch this would leave Save Changes disabled.
    await mockProviderEditPage(page, [QA_AREA]);
    await gotoPath(page, "/provider/register?edit=services");

    await expect(page.getByText("Edit Provider Profile")).toBeVisible();

    const save = await getSaveButton(page);
    await expect(save).toBeEnabled({ timeout: 5_000 });
  });

  test("clicking Save with <3 regions shows inline error and does not submit", async ({
    page,
  }) => {
    let updateCalled = false;
    await mockProviderEditPage(page, [QA_AREA]);
    await mockJson(page, "**/api/provider/update**", () => {
      updateCalled = true;
      return jsonOk({});
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible();

    const save = await getSaveButton(page);
    await expect(save).toBeEnabled({ timeout: 5_000 });
    await save.click();

    await expect(
      page.getByText(/Please pick exactly 3 service regions/i)
    ).toBeVisible({ timeout: 3_000 });
    expect(updateCalled).toBe(false);
  });

  test("editing region selection clears the stale error and re-enables save", async ({
    page,
  }) => {
    await mockProviderEditPage(page, [QA_AREA]);
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible();

    const save = await getSaveButton(page);
    await save.click();
    await expect(
      page.getByText(/Please pick exactly 3 service regions/i)
    ).toBeVisible();

    // Toggling any region triggers the submitError-clearing effect.
    await pickRegion(page, "North Jodhpur");

    await expect(
      page.getByText(/Please pick exactly 3 service regions/i)
    ).toHaveCount(0);
    await expect(save).toBeEnabled();
  });

  test("save with exactly 3 regions posts /api/provider/update with merged areas", async ({
    page,
  }) => {
    let captured: Record<string, unknown> | null = null;
    // Start the provider with NO saved areas so inference produces 0
    // regions; we then click 3 region cards manually.
    await mockProviderEditPage(page, []);
    await mockJson(page, "**/api/provider/update**", ({ body }) => {
      captured = body;
      return jsonOk({});
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible();

    await pickRegion(page, "Central Jodhpur");
    await pickRegion(page, "North Jodhpur");
    await pickRegion(page, "East Jodhpur");

    const save = await getSaveButton(page);
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => captured, { timeout: 5_000 }).not.toBeNull();
    expect(captured).toMatchObject({
      name: expect.any(String),
      categories: expect.any(Array),
      areas: expect.any(Array),
    });
    const areas = (captured as { areas?: string[] })?.areas ?? [];
    // Each picked region contributes its canonical_area to the union.
    expect(areas).toEqual(
      expect.arrayContaining([QA_AREA, "Shastri Nagar", "Ratanada"])
    );
  });

  test("adding a custom locality enables save without affecting the 3-region rule", async ({
    page,
  }) => {
    await mockProviderEditPage(page, []);

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible();

    const save = await getSaveButton(page);
    // Save is already enabled (no region/locality required for enable).
    await expect(save).toBeEnabled();

    const localityInput = page.locator(
      'input[placeholder="e.g. Demo Colony"]'
    );
    await localityInput.fill("Demo Colony");
    await localityInput.press("Enter");

    // Locality is now in the list; save still enabled; but submit should
    // still hit the 3-region inline error since custom localities don't
    // count toward the requirement. The chip renders the locality text
    // alongside an inline "REVIEW" badge, so we look for the chip's
    // remove button which is keyed on the locality name.
    const localityChip = page
      .locator("span", { hasText: "Demo Colony" })
      .filter({ hasText: "REVIEW" });
    await expect(localityChip).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      page.getByText(/Please pick exactly 3 service regions/i)
    ).toBeVisible();
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * 1. Sign in as a provider with saved areas that don't fully cover any
 *    region (e.g., one area each from three different regions). Open
 *    /provider/dashboard → "Edit my services".
 * 2. Expected: Save Changes button is ENABLED. Pre-patch behaviour was
 *    silently disabled.
 * 3. Click Save Changes without picking 3 regions → red inline error:
 *    "Please pick exactly 3 service regions before saving. Custom
 *    localities don't count toward this requirement."
 * 4. Pick three region cards → error clears; click Save Changes → POST
 *    /api/provider/update body should contain areas = union of the 3
 *    regions' canonical areas (plus any custom localities you added).
 * 5. Refresh /provider/dashboard → those three regions remain inferred
 *    in the editor and the saved areas reflect the union.
 * 6. Deselect one region → Save Changes stays enabled; click → inline
 *    error returns. Re-select → error clears, save succeeds.
 * 7. Add and remove a custom locality (input under "Missing your
 *    locality?") → Save Changes remains enabled across both edits; the
 *    locality is submitted as part of `areas` in the update payload.
 */
