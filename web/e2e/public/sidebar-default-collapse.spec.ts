import { mockCommonCatalogRoutes } from "../_support/routes";
import { gotoPath } from "../_support/home";
import { test, expect } from "../_support/test";

async function readSidebarWidthPx(page: import("@playwright/test").Page): Promise<number> {
  const value = await page.evaluate(() => {
    const shell = document.getElementById("kk-app-shell");
    if (!shell) return "";
    return getComputedStyle(shell).getPropertyValue("--kk-sidebar-width").trim();
  });
  const match = value.match(/^(-?\d+(?:\.\d+)?)\s*(px|rem)?$/i);
  if (!match) return Number.NaN;
  const num = Number(match[1]);
  const unit = (match[2] || "px").toLowerCase();
  return unit === "rem" ? num * 16 : num;
}

test.describe("Public: sidebar default collapse state by viewport (PATCH 3B)", () => {
  test("guest at 768px (tablet portrait) defaults collapsed (~80px)", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoPath(page, "/");
    await expect(page.locator("aside").first()).toBeVisible();
    await expect.poll(() => readSidebarWidthPx(page), { timeout: 5_000 }).toBe(80);
  });

  test("guest at 820px (tablet) defaults collapsed (~80px)", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await gotoPath(page, "/");
    await expect(page.locator("aside").first()).toBeVisible();
    await expect.poll(() => readSidebarWidthPx(page), { timeout: 5_000 }).toBe(80);
  });

  test("guest at 1024px (desktop boundary) defaults expanded (~288px)", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoPath(page, "/");
    await expect(page.locator("aside").first()).toBeVisible();
    await expect.poll(() => readSidebarWidthPx(page), { timeout: 5_000 }).toBe(288);
  });

  test("guest at 1280px (wide desktop) defaults expanded (~288px)", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    await expect(page.locator("aside").first()).toBeVisible();
    await expect.poll(() => readSidebarWidthPx(page), { timeout: 5_000 }).toBe(288);
  });
});
