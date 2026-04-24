import { bootstrapUserSession } from "../_support/auth";
import {
  QA_AREA,
  QA_CATEGORY,
  QA_REQUEST_DETAILS,
} from "../_support/data";
import { completeHomeRequestFlow, gotoPath, submitHomeForm } from "../_support/home";
import {
  jsonOk,
  mockCommonCatalogRoutes,
  mockJson,
  mockSubmitRequestSuccess,
} from "../_support/routes";
import { mockUserRequestsApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("Public: homepage flow", () => {
  test("homepage search UI gates submit until service, time, and area are selected", async ({
    page,
    diag,
  }) => {
    await mockCommonCatalogRoutes(page);
    await gotoPath(page, "/");

    await expect(page.getByRole("button", { name: /^search$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /find providers/i })).toHaveCount(0);

    await completeHomeRequestFlow(page, {
      service: QA_CATEGORY,
      time: "Today",
      area: QA_AREA,
      details: QA_REQUEST_DETAILS,
    });

    const submitButton = page.getByRole("button", { name: /find providers/i });
    await expect(page.getByText("Service:")).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Describe"]')).toBeVisible();
    await expect(submitButton).toBeEnabled();

    diag.assertClean();
  });

  test("logged-in public submit route lands on success page with expected CTAs", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockCommonCatalogRoutes(page);
    await mockUserRequestsApis(page, { requests: [], globalThreads: [], taskThreads: [] });
    await mockSubmitRequestSuccess(page);
    await mockJson(
      page,
      "**/api/process-task-notifications**",
      jsonOk({ matchedProviders: 1, attemptedSends: 1, failedSends: 0 })
    );
    await mockJson(
      page,
      "**/api/find-provider**",
      jsonOk({
        count: 1,
        providers: [
          {
            name: "ZZ QA Provider",
            phone: "9999999902",
            verified: "yes",
          },
        ],
      })
    );

    await gotoPath(page, "/");
    await completeHomeRequestFlow(page, {
      service: QA_CATEGORY,
      time: "Today",
      area: QA_AREA,
      details: QA_REQUEST_DETAILS,
    });
    await submitHomeForm(page);

    await expect(page).toHaveURL(/\/success/);
    await expect(page.getByText("Task Submitted Successfully")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /show service provider numbers/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /go to my requests/i })).toBeVisible();

    diag.assertClean();
  });
});
