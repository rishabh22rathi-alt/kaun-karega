import { bootstrapProviderSession } from "../_support/auth";
import {
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_NAME,
  QA_THREAD_ID,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockProviderDashboardApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("Provider: dashboard and profile states", () => {
  test("provider dashboard renders profile, demand data, and the task-response chat entry point", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await mockProviderDashboardApis(page);

    // Purpose: verify the main provider dashboard remains readable and actionable after API changes.
    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByText("Provider Intelligence Dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: QA_PROVIDER_NAME })).toBeVisible();
    await expect(page.getByRole("main").getByText("Phone Verified").first()).toBeVisible();
    await expect(page.getByText("Requests In Your Services", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent Matched Requests", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(QA_CATEGORY).first()).toBeVisible();
    await expect(page.getByRole("main").getByText(QA_AREA).first()).toBeVisible();

    const openChatButton = page.getByRole("button", { name: /open chat/i }).first();
    await openChatButton.scrollIntoViewIfNeeded();
    await openChatButton.click();

    await expect(page).toHaveURL(new RegExp(`/chat/thread/${QA_THREAD_ID}$`));
    await expect(
      page.getByRole("heading", { name: /customer conversation/i })
    ).toBeVisible();
    await expect(page.getByText("Viewing as: Provider")).toBeVisible();

    diag.assertClean();
  });

  test("pending approval providers still get the correct verification-state messaging and management links", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await mockProviderDashboardApis(page, {
      dashboardResponse: buildProviderDashboardResponse({
        provider: {
          ProviderID: "PR-QA-PENDING",
          ProviderName: QA_PROVIDER_NAME,
          Phone: "9999999902",
          Verified: "no",
          OtpVerified: "no",
          PendingApproval: "yes",
          Status: "pending",
          Services: [{ Category: QA_CATEGORY }],
          Areas: [{ Area: QA_AREA }],
          Analytics: {
            Metrics: {
              TotalRequestsInMyCategories: 0,
              TotalRequestsMatchedToMe: 0,
              TotalRequestsRespondedByMe: 0,
              TotalRequestsAcceptedByMe: 0,
              TotalRequestsCompletedByMe: 0,
              ResponseRate: 0,
              AcceptanceRate: 0,
            },
            AreaDemand: [],
            SelectedAreaDemand: [],
            CategoryDemandByRange: {},
            RecentMatchedRequests: [],
          },
          AreaCoverage: {
            ActiveApprovedAreas: [{ Area: QA_AREA, Status: "active" }],
            PendingAreaRequests: [{ RequestedArea: "New Area", Status: "pending" }],
            ResolvedOutcomes: [],
          },
        },
      }),
    });

    // Purpose: verify the amber approval branch remains distinct from the verified state.
    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByRole("main").getByText("Pending Admin Approval").first()).toBeVisible();
    await expect(
      page.getByText(/categories are waiting for admin review/i).first()
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Edit Services & Areas" })).toHaveAttribute(
      "href",
      "/provider/register?edit=services"
    );
    await expect(page.getByRole("main").getByRole("link", { name: "Update Areas" })).toHaveAttribute(
      "href",
      "/provider/register?edit=areas"
    );

    diag.assertClean();
  });
});
