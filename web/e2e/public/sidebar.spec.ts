import { mockCommonCatalogRoutes } from "../_support/routes";
import { gotoPath } from "../_support/home";
import { test, expect } from "../_support/test";

test.describe("Public: sidebar and CTAs", () => {
  test("guest provider CTA routes through login with the provider register next-path", async ({
    page,
    diag,
  }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    await sidebar.getByRole("button", { name: /register as service provider/i }).click();
    await expect(
      page.getByText("Become a Service Provider")
    ).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/provider/register");

    diag.assertClean();
  });
});
