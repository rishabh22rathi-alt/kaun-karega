import type { Page } from "@playwright/test";

import {
  QA_ADMIN_PHONE,
  QA_PROVIDER_PHONE,
  QA_USER_PHONE,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { appUrl } from "../_support/runtime";
import {
  mockAdminDashboardApis,
  mockProviderDashboardApis,
  mockUserRequestsApis,
} from "../_support/scenarios";
import { test, expect } from "../_support/test";

async function loginAs(
  page: Page,
  { phone, isAdmin }: { phone: string; isAdmin: boolean }
): Promise<void> {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: encodeURIComponent(
        JSON.stringify({
          phone,
          verified: true,
          createdAt: Date.now(),
        })
      ),
      url: appUrl("/"),
      sameSite: "Lax" as const,
    },
    ...(isAdmin
      ? [
          {
            name: "kk_admin",
            value: "1",
            url: appUrl("/"),
            sameSite: "Lax" as const,
          },
        ]
      : []),
  ]);
}

test.describe("Auth: OTP flows", () => {
  test.use({ baseURL: "http://127.0.0.1:3000" });

  test("user session lands on My Requests", async ({ page, diag }) => {
    await mockUserRequestsApis(page, { requests: [], globalThreads: [], taskThreads: [] });
    await loginAs(page, { phone: QA_USER_PHONE, isAdmin: false });

    await gotoPath(page, "/dashboard/my-requests");

    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();

    diag.assertClean();
  });

  test("admin session opens the admin dashboard", async ({ page, diag }) => {
    await mockAdminDashboardApis(page);
    await loginAs(page, { phone: QA_ADMIN_PHONE, isAdmin: true });

    await gotoPath(page, "/admin/dashboard");

    await expect(page.getByText("Admin Dashboard")).toBeVisible();

    diag.assertClean();
  });

  test("provider session lands on the provider dashboard", async ({ page, diag }) => {
    await mockProviderDashboardApis(page);
    await loginAs(page, { phone: QA_PROVIDER_PHONE, isAdmin: false });

    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByText("Provider Intelligence Dashboard")).toBeVisible();
    await expect(page.getByRole("main").getByText("Phone Verified").first()).toBeVisible();

    diag.assertClean();
  });
});
