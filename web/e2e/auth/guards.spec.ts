import { bootstrapUserSession } from "../_support/auth";
import { QA_USER_PHONE } from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockCommonCatalogRoutes } from "../_support/routes";
import { mockUserRequestsApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("Auth: route guards and logout", () => {
  test("protected user and admin routes redirect guests to login", async ({
    page,
    diag,
  }) => {
    await gotoPath(page, "/dashboard/my-requests");
    await expect(page).toHaveURL(/\/login$/);

    await gotoPath(page, "/admin/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fdashboard/);

    await gotoPath(page, "/provider/login?next=/provider/dashboard");
    await expect(
      page.getByRole("link", { name: /continue to login/i })
    ).toHaveAttribute("href", "/login?next=%2Fprovider%2Fdashboard");

    diag.assertClean();
  });

  test("logout clears the client session and returns the app to guest navigation", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page, QA_USER_PHONE);
    await mockCommonCatalogRoutes(page);
    await mockUserRequestsApis(page, { requests: [], globalThreads: [], taskThreads: [] });

    await gotoPath(page, "/dashboard/my-requests");
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: "Logout" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(sidebar.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: /register as service provider/i })
    ).toBeVisible();

    diag.assertClean();
  });

  test("a verified user session survives reloads on protected routes", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page, QA_USER_PHONE);
    await mockCommonCatalogRoutes(page);
    await mockUserRequestsApis(page, { requests: [], globalThreads: [], taskThreads: [] });

    await gotoPath(page, "/dashboard/my-requests");
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/dashboard\/my-requests/);
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();

    diag.assertClean();
  });
});
