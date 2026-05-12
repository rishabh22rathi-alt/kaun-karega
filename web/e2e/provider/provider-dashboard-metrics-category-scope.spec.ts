/**
 * Provider dashboard metric tiles — current-category scoping.
 *
 * Post-patch: `getProviderMetricsFromSupabase` intersects the provider's
 * provider_services categories with `categories.active=true` and then
 * filters all provider_task_matches counts (matched / responded /
 * accepted) on `provider_task_matches.category`. After a category
 * switch, historical matches under the OLD category no longer count
 * toward the new category's tiles. Pending and rejected requests are
 * excluded because they never become an `active=true` canonical until
 * admin approval lands.
 *
 * Runtime tests cover dashboard rendering with mocked metrics payloads.
 * The query filter itself is asserted via source-level regex against
 * the route file — the route runs behind a session cookie and the
 * provider_task_matches mutation surface isn't exposed to Playwright.
 */

import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

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

function profileWithMetrics(
  services: Array<{ Category: string; Status: string }>,
  metrics: Record<string, number>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  const baseAnalytics = (provider.Analytics as Record<string, unknown>) || {};
  return {
    ...base,
    provider: {
      ...provider,
      Services: services,
      Analytics: {
        ...baseAnalytics,
        Metrics: {
          TotalRequestsInMyCategories: 0,
          TotalRequestsMatchedToMe: 0,
          TotalRequestsRespondedByMe: 0,
          TotalRequestsAcceptedByMe: 0,
          TotalRequestsCompletedByMe: 0,
          ResponseRate: 0,
          AcceptanceRate: 0,
          ...metrics,
        },
      },
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: QA_AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
      ...overrides,
    },
  };
}

async function tileValue(page: Page, title: RegExp | string) {
  // Each tile renders the title as a heading-like label and the count
  // as an adjacent large number. Locate the title and read the number
  // sitting next to it inside the same card.
  const card = page
    .locator("p", { hasText: title })
    .locator("..")
    .first();
  return card;
}

test.describe("Provider dashboard tiles scope to current approved category", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
    await injectProviderUiHint(page, QA_PROVIDER_PHONE);
    await mockKkActions(page, {
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      get_my_needs: () => jsonOk({ needs: [] }),
      chat_get_threads: () => jsonOk({ threads: [] }),
    });
    await mockJson(
      page,
      "**/api/provider/notifications",
      jsonOk({ notifications: [] })
    );
  });

  test("legacy category had 2 matches; after switching to new approved category with 0 matches, tiles show 0", async ({
    page,
  }) => {
    // SIM: provider just switched from "Plumber" (2 historical matches)
    // to "Solar Installer" (0 matches under new category). With the
    // patched server filter, the new-category dashboard returns zeroes.
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithMetrics(
          [{ Category: "Solar Installer", Status: "approved" }],
          {
            TotalRequestsInMyCategories: 0,
            TotalRequestsMatchedToMe: 0,
            TotalRequestsRespondedByMe: 0,
          }
        )
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const matched = await tileValue(page, "Matched To You");
    await expect(matched).toContainText("0", { timeout: 5_000 });
    const chatOpened = await tileValue(page, "Chat Opened By You");
    await expect(chatOpened).toContainText("0");
    const reqs = await tileValue(page, "Requests In Your Services");
    await expect(reqs).toContainText("0");
  });

  test("new match under current category increments the tile to 1", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithMetrics(
          [{ Category: "Solar Installer", Status: "approved" }],
          {
            TotalRequestsInMyCategories: 1,
            TotalRequestsMatchedToMe: 1,
            TotalRequestsRespondedByMe: 0,
          }
        )
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const matched = await tileValue(page, "Matched To You");
    await expect(matched).toContainText("1", { timeout: 5_000 });
    const reqs = await tileValue(page, "Requests In Your Services");
    await expect(reqs).toContainText("1");
  });

  test("pending category request alone yields 0 tiles (no active approved category)", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithMetrics(
          // Only a pending request — no approved category. Server returns 0s.
          [{ Category: "Saree Showroom", Status: "pending" }],
          {
            TotalRequestsInMyCategories: 0,
            TotalRequestsMatchedToMe: 0,
            TotalRequestsRespondedByMe: 0,
          }
        )
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const matched = await tileValue(page, "Matched To You");
    await expect(matched).toContainText("0", { timeout: 5_000 });
    const chatOpened = await tileValue(page, "Chat Opened By You");
    await expect(chatOpened).toContainText("0");
  });

  test("rejected category does not influence tiles", async ({ page }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithMetrics(
          [{ Category: QA_CATEGORY, Status: "approved" }],
          {
            // 3 historical matches were under the approved category — those
            // are honest current-category numbers and DO appear.
            TotalRequestsInMyCategories: 3,
            TotalRequestsMatchedToMe: 3,
            TotalRequestsRespondedByMe: 2,
          },
          {
            RejectedCategoryRequests: [
              {
                RequestedCategory: "Tarot Reader",
                Reason: "Not serviceable",
                ActionAt: "2026-05-12T10:00:00.000Z",
              },
            ],
          }
        )
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const matched = await tileValue(page, "Matched To You");
    await expect(matched).toContainText("3", { timeout: 5_000 });
    const reqs = await tileValue(page, "Requests In Your Services");
    await expect(reqs).toContainText("3");
    // The rejected request is visible in its own section, not on tiles.
    await expect(
      page.getByText(/Rejected Service Category Requests/i)
    ).toBeVisible();
  });
});

test.describe("dashboard-profile source: metrics filter on provider_task_matches.category", () => {
  const root = path.resolve(__dirname, "../..");

  test("getProviderMetricsFromSupabase intersects with categories.active=true and filters by category", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/provider/dashboard-profile/route.ts"),
      "utf8"
    );
    // Active-categories intersection variable.
    expect(file).toContain("activeApprovedCategoryList");
    expect(file).toMatch(
      /activeApprovedCategoryList = rawCategoryList\.filter/
    );
    // All three count queries now filter on provider_task_matches.category.
    const matches = file.match(/\.in\("category", categoryList\)/g) || [];
    // Expect at least three call sites — matched, responded, accepted.
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Empty-list short-circuit guards against `.in("category", [])`.
    expect(file).toMatch(
      /categoryList\.length === 0[\s\S]{0,40}emptyCount/
    );
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * 1. Seed Provider P with two provider_task_matches rows under category
 *    "Plumber" (the approved category at the time of matching).
 * 2. Have P switch their main category to a brand-new "Solar Installer"
 *    via /provider/register?edit=services + admin Approves the request.
 *    provider_services now has one row {category:"Solar Installer"}.
 * 3. Open /provider/dashboard for P:
 *      Requests In Your Services = 0  (no Solar Installer tasks yet)
 *      Matched To You             = 0  (Plumber matches filtered out)
 *      Chat Opened By You         = 0
 *    Pre-patch, "Matched To You" would still show 2.
 * 4. /api/find-provider inserts a new provider_task_matches row with
 *    category="Solar Installer". Reload:
 *      Matched To You             = 1
 * 5. Provider tap Open Chat once → match_status flips to "responded":
 *      Chat Opened By You         = 1
 * 6. Submit a new pending request "Tarot Reader" → admin not yet acted:
 *    tiles unchanged (pending status excluded from approved list).
 * 7. Admin rejects "Tarot Reader" → rejected request appears in its own
 *    block; tiles unchanged.
 */
