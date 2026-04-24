import {
  bootstrapAdminSession,
  bootstrapProviderSession,
  bootstrapUserSession,
} from "../_support/auth";
import { QA_AREA } from "../_support/data";
import {
  getHomeCategoryInput,
  gotoPath,
} from "../_support/home";
import { mockCommonCatalogRoutes } from "../_support/routes";
import {
  mockAdminDashboardApis,
  mockProviderRegistrationApis,
  mockUserRequestsApis,
} from "../_support/scenarios";
import {
  auditInteractiveTargets,
  expectNoBrokenInteractiveTargets,
} from "../_support/ui-audit";
import { test, expect } from "../_support/test";

test.describe("UI audit: interactive controls", () => {
  test("homepage controls classify cleanly across menu, search, and CTA surfaces", async ({
    page,
  }, testInfo) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    const sidebar = page.locator("aside");

    const results = await auditInteractiveTargets(testInfo, [
      {
        id: "home-menu-toggle",
        kind: "menu",
        locator: page.getByLabel("Open menu"),
        detail: "Desktop shell keeps the mobile menu toggle hidden in this scenario.",
      },
      {
        id: "home-service-input",
        kind: "input",
        locator: getHomeCategoryInput(page),
        action: async () => {
          await getHomeCategoryInput(page).fill("Electrician");
          await expect(getHomeCategoryInput(page)).toHaveValue("Electrician");
        },
      },
      {
        id: "home-find-providers-submit",
        kind: "button",
        locator: page.getByRole("button", { name: /find providers/i }),
        detail: "Hidden until the service, time, and area steps are completed.",
      },
      {
        id: "home-provider-cta",
        kind: "button",
        locator: page.getByRole("button", { name: /register as provider/i }),
        action: async () => {
          await page.getByRole("button", { name: /register as provider/i }).click();
          await expect(page).toHaveURL(/\/provider\/register/);
          await page.goBack({ waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle");
        },
      },
      {
        id: "home-login-link",
        kind: "link",
        locator: sidebar.getByRole("link", { name: "Login" }),
        action: async () => {
          await sidebar.getByRole("link", { name: "Login" }).click();
          await expect(page).toHaveURL(/\/login$/);
          await page.goBack({ waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle");
        },
      },
    ]);

    expectNoBrokenInteractiveTargets(results, "Homepage interactive audit");
  });

  test("user request surfaces expose working response and chat controls", async ({
    page,
  }, testInfo) => {
    await bootstrapUserSession(page);
    await mockUserRequestsApis(page);
    await gotoPath(page, "/dashboard/my-requests");

    const results = await auditInteractiveTargets(testInfo, [
      {
        id: "my-requests-view-responses",
        kind: "button",
        locator: page.getByRole("button", { name: /view responses/i }),
        action: async () => {
          await page.getByRole("button", { name: /view responses/i }).click();
          await expect(page.getByRole("button", { name: /open chat/i })).toBeVisible();
        },
      },
      {
        id: "my-requests-open-chat",
        kind: "button",
        locator: page.getByRole("button", { name: /open chat/i }),
        action: async () => {
          await page.getByRole("button", { name: /open chat/i }).click();
          await expect(page).toHaveURL(/\/chat\/thread\/.+\?actor=user/);
        },
      },
    ]);

    expectNoBrokenInteractiveTargets(results, "My Requests interactive audit");
  });

  test("provider edit links remain interactive from the dashboard shell", async ({
    page,
  }, testInfo) => {
    await bootstrapProviderSession(page);
    await mockProviderRegistrationApis(page);
    await gotoPath(page, "/provider/dashboard");

    const providerResults = await auditInteractiveTargets(testInfo, [
      {
        id: "provider-edit-services-link",
        kind: "link",
        locator: page.getByRole("link", { name: "Edit Services & Areas" }),
        action: async () => {
          await page.getByRole("link", { name: "Edit Services & Areas" }).click();
          await expect(page).toHaveURL(/\/provider\/register\?edit=services/);
          await expect(page.getByText("Edit Provider Profile")).toBeVisible();
          await page.goBack({ waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle");
        },
      },
      {
        id: "provider-update-areas-link",
        kind: "link",
        locator: page.getByRole("link", { name: "Update Areas" }),
        action: async () => {
          await page.getByRole("link", { name: "Update Areas" }).click();
          await expect(page).toHaveURL(/\/provider\/register\?edit=areas/);
          await expect(page.getByText("Edit Provider Profile")).toBeVisible();
          await page.goBack({ waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle");
        },
      },
    ]);
    expectNoBrokenInteractiveTargets(providerResults, "Provider interactive audit");
  });

  test("admin operational controls remain interactive across verification, issue, and chat panels", async ({
    page,
  }, testInfo) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await gotoPath(page, "/admin/dashboard");
    const pendingProviderRow = page.locator("tr").filter({ hasText: "PR-QA-PENDING" });
    const issueRow = page.locator("tr").filter({ hasText: "ISSUE-QA-0001" });
    const chatRow = page.locator("tr").filter({ hasText: "THREAD-QA-0001" });

    const adminResults = await auditInteractiveTargets(testInfo, [
      {
        id: "admin-refresh-data",
        kind: "button",
        locator: page.getByRole("button", { name: /refresh data/i }),
        action: async () => {
          await page.getByRole("button", { name: /refresh data/i }).click();
          await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
        },
      },
      {
        id: "admin-providers-toggle",
        kind: "button",
        locator: page.getByRole("button", { name: /providers needing attention/i }),
        action: async () => {
          const approveButton = pendingProviderRow.getByRole("button", { name: /^approve$/i });
          if (!(await approveButton.isVisible().catch(() => false))) {
            await page.getByRole("button", { name: /providers needing attention/i }).click();
          }
          await expect(approveButton).toBeVisible();
        },
      },
      {
        id: "admin-approve-provider",
        kind: "button",
        locator: pendingProviderRow.getByRole("button", { name: /^approve$/i }),
        action: async () => {
          await pendingProviderRow.getByRole("button", { name: /^approve$/i }).click();
          await expect(
            pendingProviderRow.getByRole("button", { name: /^unverify$/i })
          ).toBeVisible();
        },
      },
      {
        id: "admin-areas-toggle",
        kind: "button",
        locator: page.getByRole("button", { name: /areas management/i }),
        action: async () => {
          const aliasButton = page.getByRole("button", { name: /view aliases/i });
          if (!(await aliasButton.isVisible().catch(() => false))) {
            await page.getByRole("button", { name: /areas management/i }).click();
          }
          await expect(aliasButton).toBeVisible();
        },
      },
      {
        id: "admin-map-unmapped-area",
        kind: "button",
        locator: page.getByRole("button", { name: /^map$/i }),
        action: async () => {
          await page
            .locator('input[list="admin-area-canonical-options"]')
            .fill(QA_AREA);
          await page.getByRole("button", { name: /^map$/i }).click();
          await expect(page.getByText("Sardar Pura West")).toHaveCount(0);
        },
      },
      {
        id: "admin-reported-issues-toggle",
        kind: "button",
        locator: page.getByRole("button", { name: /reported issues/i }),
        action: async () => {
          const resolveButton = issueRow.getByRole("button", { name: /mark resolved/i });
          if (!(await resolveButton.isVisible().catch(() => false))) {
            await page.getByRole("button", { name: /reported issues/i }).click();
          }
          await expect(resolveButton).toBeVisible();
        },
      },
      {
        id: "admin-resolve-issue",
        kind: "button",
        locator: issueRow.getByRole("button", { name: /mark resolved/i }),
        action: async () => {
          await issueRow.getByRole("button", { name: /mark resolved/i }).click();
          await expect(
            issueRow.locator("span").filter({ hasText: /^resolved$/i }).first()
          ).toBeVisible();
        },
      },
      {
        id: "admin-chat-monitoring-toggle",
        kind: "button",
        locator: page.getByRole("button", { name: /chat monitoring/i }),
        action: async () => {
          const openButton = chatRow.getByRole("button", { name: /^open$/i });
          if (!(await openButton.isVisible().catch(() => false))) {
            await page.getByRole("button", { name: /chat monitoring/i }).click();
          }
          await expect(openButton).toBeVisible();
        },
      },
      {
        id: "admin-open-chat-thread",
        kind: "button",
        locator: chatRow.getByRole("button", { name: /^open$/i }),
        action: async () => {
          await chatRow.getByRole("button", { name: /^open$/i }).click();
          await expect(page.getByText(/ThreadID:\s*THREAD-QA-0001/i)).toBeVisible();
        },
      },
    ]);

    expectNoBrokenInteractiveTargets(adminResults, "Admin interactive audit");
  });
});
