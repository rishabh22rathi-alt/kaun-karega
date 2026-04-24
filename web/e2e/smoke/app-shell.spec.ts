import { mockCommonCatalogRoutes } from "../_support/routes";
import { gotoPath } from "../_support/home";
import { test, expect } from "../_support/test";

test.describe("Smoke: app shell", () => {
  test("guest homepage shell loads and the desktop sidebar shell stays visible", async ({
    page,
    diag,
  }) => {
    await mockCommonCatalogRoutes(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.getByText("How it works")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register as provider/i })
    ).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Login" })).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: /register as service provider/i })
    ).toBeVisible();

    diag.assertClean();
  });
});
