import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import { buildProviderDashboardResponse } from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockProviderDashboardApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

// Shape we rely on from buildProviderDashboardResponse(). The helper returns
// Record<string, unknown>; narrowing here keeps the spec type-clean without
// leaking new types into the shared _support module.
type ProviderDashboardResponse = {
  ok: boolean;
  provider: {
    Analytics: {
      Metrics?: Record<string, number>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function buildResponseWithMetrics(
  options: { metrics?: Record<string, number>; omitMetrics?: boolean } = {}
): ProviderDashboardResponse {
  const response = buildProviderDashboardResponse() as unknown as ProviderDashboardResponse;
  if (options.omitMetrics) {
    delete response.provider.Analytics.Metrics;
  } else if (options.metrics) {
    response.provider.Analytics = {
      ...response.provider.Analytics,
      Metrics: options.metrics,
    };
  }
  return response;
}

// Each stats card is a <div> with three <p> children: title, value, note.
// Find the card by its unique title text and navigate to the parent <div>.
// Scoped to <main> so the sidebar / header never leak into the match.
function cardByTitle(page: Page, title: string) {
  return page.getByRole("main").getByText(title, { exact: true }).locator("..");
}

test.describe("Provider dashboard: metric cards", () => {
  test("renders all five metrics and both rate notes from Analytics.Metrics", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await mockProviderDashboardApis(page, {
      dashboardResponse: buildResponseWithMetrics({
        metrics: {
          TotalRequestsInMyCategories: 4,
          TotalRequestsMatchedToMe: 3,
          TotalRequestsRespondedByMe: 2,
          TotalRequestsAcceptedByMe: 2,
          TotalRequestsCompletedByMe: 1,
          ResponseRate: 67,
          AcceptanceRate: 67,
        },
      }),
    });

    await gotoPath(page, "/provider/dashboard");

    // Value assertions are tight: second <p> inside the card is the big number.
    await expect(cardByTitle(page, "Requests In Your Services").locator("p").nth(1)).toHaveText("4");
    await expect(cardByTitle(page, "Matched To You").locator("p").nth(1)).toHaveText("3");
    await expect(cardByTitle(page, "Responded By You").locator("p").nth(1)).toHaveText("2");
    await expect(cardByTitle(page, "Accepted By You").locator("p").nth(1)).toHaveText("2");
    await expect(cardByTitle(page, "Completed By You").locator("p").nth(1)).toHaveText("1");

    // Rate notes live in the third <p> of their cards.
    await expect(cardByTitle(page, "Responded By You")).toContainText("Response rate 67%");
    await expect(cardByTitle(page, "Accepted By You")).toContainText("Acceptance rate 67%");

    diag.assertClean();
  });

  test("falls back to zero on every card when Metrics is absent", async ({ page, diag }) => {
    await bootstrapProviderSession(page);
    await mockProviderDashboardApis(page, {
      dashboardResponse: buildResponseWithMetrics({ omitMetrics: true }),
    });

    await gotoPath(page, "/provider/dashboard");

    for (const title of [
      "Requests In Your Services",
      "Matched To You",
      "Responded By You",
      "Accepted By You",
      "Completed By You",
    ]) {
      await expect(cardByTitle(page, title).locator("p").nth(1)).toHaveText("0");
    }
    await expect(cardByTitle(page, "Responded By You")).toContainText("Response rate 0%");
    await expect(cardByTitle(page, "Accepted By You")).toContainText("Acceptance rate 0%");

    diag.assertClean();
  });

  test("renders rates as 0% when matched count is zero (no divide-by-zero)", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await mockProviderDashboardApis(page, {
      dashboardResponse: buildResponseWithMetrics({
        metrics: {
          TotalRequestsInMyCategories: 5,
          TotalRequestsMatchedToMe: 0,
          TotalRequestsRespondedByMe: 0,
          TotalRequestsAcceptedByMe: 0,
          TotalRequestsCompletedByMe: 0,
          ResponseRate: 0,
          AcceptanceRate: 0,
        },
      }),
    });

    await gotoPath(page, "/provider/dashboard");

    await expect(cardByTitle(page, "Requests In Your Services").locator("p").nth(1)).toHaveText("5");
    await expect(cardByTitle(page, "Matched To You").locator("p").nth(1)).toHaveText("0");
    await expect(cardByTitle(page, "Responded By You").locator("p").nth(1)).toHaveText("0");
    await expect(cardByTitle(page, "Accepted By You").locator("p").nth(1)).toHaveText("0");
    await expect(cardByTitle(page, "Completed By You").locator("p").nth(1)).toHaveText("0");

    await expect(cardByTitle(page, "Responded By You")).toContainText("Response rate 0%");
    await expect(cardByTitle(page, "Accepted By You")).toContainText("Acceptance rate 0%");

    diag.assertClean();
  });
});
