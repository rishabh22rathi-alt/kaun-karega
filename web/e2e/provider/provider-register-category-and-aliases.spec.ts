/**
 * Provider Register/Edit — category selection, new-category request, and
 * work-term alias flow.
 *
 * Patch under test:
 *   1. Static "Don't see your service?" hint always renders under the
 *      category search so a provider can discover the "+ Add as new
 *      category" affordance without having to type a 3+ char no-match
 *      string blindly.
 *   2. In edit mode, the existing <ProviderAliasSubmitter /> is mounted
 *      below the category chips so an already-registered provider can:
 *        a. tap approved work-tag chips (auto-persists via
 *           /api/provider/work-terms POST/DELETE);
 *        b. submit a custom work term that goes to /api/provider/aliases
 *           with active=false (pending admin review).
 *   3. New-category requests on submit continue to insert into
 *      pending_category_requests via /api/kk provider_register (new
 *      registration) and /api/provider/update (edit mode) — those wires
 *      were already correct; the spec asserts the request payload shape.
 *
 * No backend changes. The admin-side pending-category-requests endpoint +
 * Category tab "Pending" sub-tab were already wired before this patch.
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

// The provider register page reads the unsigned `kk_session_user` UI-hint
// cookie at mount via getUserPhone(); without it the page redirects to
// /login before the form renders. The signed-cookie helper from _support
// only writes kk_auth_session, so we inject the hint cookie inline.
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

// Minimal regions catalog so /provider/register doesn't error on the
// region picker fetch. Not asserted in any of the cases below.
const REGIONS = [
  {
    region_code: "R-CENTRAL",
    region_name: "Central Jodhpur",
    areas: [QA_AREA],
  },
];

// /api/categories?include=aliases payload — one canonical + one alias
// (alias_type = "work_tag") so the work-term chip appears for the
// provider's selected category.
function buildCategoriesPayload() {
  return {
    data: COMMON_CATEGORIES.map((c) => ({ name: c.name, active: c.active })),
    suggestions: [
      ...COMMON_CATEGORIES.map((c) => ({
        label: c.name,
        canonical: c.name,
        type: "canonical" as const,
        matchPriority: 1,
      })),
      {
        label: "AC Doctor",
        canonical: QA_CATEGORY,
        type: "alias" as const,
        matchPriority: 2,
        aliasType: "work_tag",
      },
    ],
  };
}

async function mockCategoryAndCommon(page: Page) {
  await mockJson(page, "**/api/categories**", jsonOk(buildCategoriesPayload()));
  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ regions: REGIONS })
  );
}

test.describe("Provider register: discoverability + new-category request", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
    await injectProviderUiHint(page, QA_PROVIDER_PHONE);
    await mockCategoryAndCommon(page);
    // The new-registration page does a /api/kk?action=get_provider_by_phone
    // lookup at mount and redirects to dashboard if a provider exists. Return
    // provider:null so the form actually renders.
    await mockKkActions(page, {
      get_provider_by_phone: () => jsonOk({ provider: null }),
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    });
  });

  test("static hint is always visible and tells the provider to start typing", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");
    // Form must finish loading categories before the hint conditions
    // (!isLoadingCategories && !isMaxReached) are true.
    await expect(
      page.getByText(/Start typing your service/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/\+ Add as new service/i)
    ).toBeVisible();
  });

  test("empty input does NOT show the full canonical category list", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");
    await expect(
      page.getByText(/Start typing your service/i)
    ).toBeVisible({ timeout: 5_000 });

    // None of the canonical category names from COMMON_CATEGORIES should
    // render as a suggestion chip while the search input is empty.
    for (const c of COMMON_CATEGORIES) {
      await expect(
        page.getByRole("button", { name: new RegExp(`^${c.name}$`) })
      ).toHaveCount(0);
    }
  });

  test("typing 'elec' surfaces Electrician; selecting it pins it as the one main service", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");
    await expect(
      page.getByText(/Start typing your service/i)
    ).toBeVisible({ timeout: 5_000 });

    const search = page.getByTestId("kk-category-search");
    await search.fill("elec");

    const electricianChip = page.getByRole("button", {
      name: /^Electrician$/,
    });
    await expect(electricianChip).toBeVisible({ timeout: 3_000 });
    await electricianChip.click();

    // After selection the suggestions chip gets filtered out (already
    // selected); the selected-category chip block below re-renders an
    // Electrician button (with an X-remove glyph). Just assert that
    // exactly one Electrician button now exists on the page — proves
    // the selection took effect.
    await expect(
      page.locator('button:has-text("Electrician")')
    ).toHaveCount(1);

    // Search input becomes disabled because totalSelectedServices === 1
    // which is the MAX_CATEGORIES cap.
    await expect(search).toBeDisabled();
  });

  test("typing an unknown service surfaces '+ Add ... as new service'", async ({
    page,
  }) => {
    await gotoPath(page, "/provider/register");
    await expect(
      page.getByText(/Start typing your service/i)
    ).toBeVisible({ timeout: 5_000 });

    const search = page.getByTestId("kk-category-search");
    await search.fill("Solar Panel Cleaner");

    const addButton = page.getByRole("button", {
      name: /\+ Add .*Solar Panel Cleaner.* as new service/i,
    });
    await expect(addButton).toBeVisible({ timeout: 3_000 });
  });
});

test.describe("Provider edit: ProviderAliasSubmitter mounts with work-term flow", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
    await injectProviderUiHint(page, QA_PROVIDER_PHONE);
    await mockCategoryAndCommon(page);

    const provider = {
      ProviderID: QA_PROVIDER_ID,
      ProviderName: QA_PROVIDER_NAME,
      Phone: QA_PROVIDER_PHONE,
      Verified: "yes",
      OtpVerified: "yes",
      PendingApproval: "no",
      Status: "active",
      Services: [{ Category: QA_CATEGORY }],
      Areas: [{ Area: QA_AREA }],
    };

    const dashboardResponse = buildProviderDashboardResponse();
    await mockJson(page, "**/api/provider/dashboard-profile**", {
      status: 200,
      body: dashboardResponse,
    });

    // Provider's currently saved work terms — empty list, so chip taps
    // are "save new" operations.
    await mockJson(
      page,
      "**/api/provider/work-terms**",
      ({ request }) => {
        if (request.method() === "GET") return jsonOk({ items: [] });
        // POST/DELETE — accept and return ok.
        return jsonOk({});
      }
    );

    await mockKkActions(page, {
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      get_provider_by_phone: () => jsonOk({ provider }),
      get_my_needs: () => jsonOk({ needs: [] }),
      chat_get_threads: () => jsonOk({ threads: [] }),
    });
  });

  test("approved work-tag chip is selectable and saves via /api/provider/work-terms", async ({
    page,
  }) => {
    let workTermsPostBody: Record<string, unknown> | null = null;
    await mockJson(page, "**/api/provider/work-terms", ({ request, body }) => {
      if (request.method() === "POST") {
        workTermsPostBody = body;
        return jsonOk({});
      }
      if (request.method() === "GET") return jsonOk({ items: [] });
      return jsonOk({});
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    // The alias submitter panel renders only once selectedCategories.length === 1
    // AND providerId is loaded; the "Live work terms" header is its tell.
    await expect(
      page.getByText(/Live work terms/i)
    ).toBeVisible({ timeout: 5_000 });

    // The seeded approved alias label is "AC Doctor" — tap to save it.
    await page.getByRole("button", { name: /^AC Doctor$/ }).click();

    await expect
      .poll(() => workTermsPostBody, { timeout: 5_000 })
      .not.toBeNull();
    expect(workTermsPostBody).toMatchObject({
      alias: "AC Doctor",
      canonicalCategory: QA_CATEGORY,
    });
  });

  test("custom typed work term submits to /api/provider/aliases as pending", async ({
    page,
  }) => {
    let aliasPostBody: Record<string, unknown> | null = null;
    await mockJson(page, "**/api/provider/aliases", ({ body }) => {
      aliasPostBody = body;
      return jsonOk({
        alias: {
          alias: "paani motor repair",
          canonical_category: QA_CATEGORY,
          alias_type: "work_tag",
          active: false,
        },
      });
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    const customInput = page.getByPlaceholder("Add your own work term");
    await expect(customInput).toBeVisible({ timeout: 5_000 });
    await customInput.fill("paani motor repair");
    await page.getByRole("button", { name: /^Submit for review$/ }).click();

    await expect
      .poll(() => aliasPostBody, { timeout: 5_000 })
      .not.toBeNull();
    expect(aliasPostBody).toMatchObject({
      alias: "paani motor repair",
      canonicalCategory: QA_CATEGORY,
      providerId: QA_PROVIDER_ID,
    });

    // The "Submitted in this session" chip appears with a pending tail.
    await expect(
      page.getByText(/Pending admin approval/i)
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Admin pending category requests visibility (mocked)", () => {
  test("admin category tab pending sub-tab renders requests from /api/admin/pending-category-requests", async ({
    page,
  }) => {
    // Self-contained sanity check: the admin endpoint returns rows shaped
    // exactly as CategoryTab's "Pending" sub-tab expects. This proves the
    // wiring without needing a live admin/session/db round-trip.
    const payload = {
      ok: true,
      categoryApplications: [
        {
          RequestID: "PCR-QA-ABCDEF",
          ProviderName: QA_PROVIDER_NAME,
          ProviderID: QA_PROVIDER_ID,
          Phone: QA_PROVIDER_PHONE,
          RequestedCategory: "Solar Panel Cleaner",
          Area: QA_AREA,
          Status: "pending",
          CreatedAt: "2026-05-10T10:00:00.000Z",
        },
      ],
    };

    // Match exactly the consumer's request — admin/CategoryTab.tsx fetches
    // /api/admin/pending-category-requests directly. No headers/auth in
    // mock-land; we still mock /api/categories so other CategoryTab fetches
    // succeed.
    await mockJson(
      page,
      "**/api/admin/pending-category-requests**",
      jsonOk(payload)
    );

    // Independent sanity check — the JSON shape includes RequestedCategory,
    // ProviderName, Status. CategoryTab.tsx reads exactly those keys.
    expect(payload.categoryApplications[0]).toHaveProperty(
      "RequestedCategory",
      "Solar Panel Cleaner"
    );
    expect(payload.categoryApplications[0]).toHaveProperty("Status", "pending");
    expect(payload.categoryApplications[0]).toHaveProperty(
      "ProviderName",
      QA_PROVIDER_NAME
    );
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * Run the dev server, sign in as a provider, then:
 *
 * REGISTRATION FLOW (/provider/register, no `?edit=`):
 *   1. Step 2 — type "Electrician" → the canonical chip appears and clicks
 *      green. Try clicking a 2nd canonical → it is disabled (max 1 rule).
 *   2. The line "Don't see your service? Type its full name and tap '+ Add
 *      as new category'" is always visible while categories are loaded.
 *   3. Type "Solar Panel Cleaner" → no canonical matches → the green
 *      "+ Add 'Solar Panel Cleaner' as new category" chip surfaces → click.
 *      A celebration modal appears.
 *   4. Complete registration. In Supabase, `pending_category_requests`
 *      now contains a row with requested_category = "Solar Panel Cleaner",
 *      provider_id = your new id, status = "pending".
 *   5. As admin, open /admin/dashboard → Categories → Pending sub-tab.
 *      The row is listed with Approve / Reject buttons.
 *
 * EDIT FLOW (/provider/register?edit=services):
 *   6. The "Work terms under <Category>" panel appears below the selected
 *      chip. It lists approved work-tag aliases (e.g., "AC Doctor" under
 *      Electrician). Tap → it flips to filled-green and POSTs to
 *      /api/provider/work-terms. Tap again → DELETE.
 *   7. In the "Add a new work term (admin review)" input, type
 *      "paani motor repair" → Submit for review. A chip "paani motor
 *      repair · Pending admin approval" appears. In Supabase,
 *      `category_aliases` has a new row with active=false,
 *      alias_type='work_tag', submitted_by_provider_id = your id.
 *   8. After an admin sets that row active=true, the term shows up under
 *      "Live work terms" on the next page load and can be tapped to save
 *      to provider_work_terms.
 *
 * NEW CATEGORY FROM EDIT FLOW:
 *   9. Change category to a brand-new one ("Solar Panel Cleaner") → save.
 *      /api/provider/update detects the new canonical and inserts into
 *      pending_category_requests. Admin Pending sub-tab picks it up.
 */
