import type { Page } from "@playwright/test";

import { mockCommonCatalogRoutes } from "../_support/routes";
import { gotoPath, getHomeCategoryInput } from "../_support/home";
import { test, expect } from "../_support/test";

const hamburger = (page: Page) => page.getByLabel("Open menu");
const closeSidebar = (page: Page) => page.getByLabel("Close sidebar");
const trustTrustedTile = (page: Page) =>
  page.getByText("Trusted", { exact: true }).first();
const statsServiceTypes = (page: Page) =>
  page.getByText("Service Types", { exact: true }).first();

test.describe("PATCH 5 — Issue 1: mobile hamburger reliability", () => {
  test("mobile cold load — hamburger visible", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");
    await expect(hamburger(page)).toBeVisible({ timeout: 5_000 });
  });

  test("desktop → mobile resize — hamburger appears within 3s", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    // Allow the desktop-state dispatch to settle (would mark isSidebarOpen=true).
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(hamburger(page)).toBeVisible({ timeout: 3_000 });
  });

  test("mobile open/close cycle — hamburger reappears after close", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");
    await expect(hamburger(page)).toBeVisible({ timeout: 5_000 });

    await hamburger(page).click();
    // Once opened, hamburger should disappear.
    await expect(hamburger(page)).toBeHidden({ timeout: 2_000 });

    // Close via the explicit X button inside the open drawer.
    await expect(closeSidebar(page)).toBeVisible({ timeout: 2_000 });
    await closeSidebar(page).click();

    await expect(hamburger(page)).toBeVisible({ timeout: 3_000 });
  });
});

test.describe("PATCH 5 — Issue 2: homepage strip friction (mobile)", () => {
  test("mobile focus hides trust + stats strips", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");
    await expect(trustTrustedTile(page)).toBeVisible();
    await expect(statsServiceTypes(page)).toBeVisible();

    await getHomeCategoryInput(page).click();

    await expect(trustTrustedTile(page)).toBeHidden({ timeout: 2_000 });
    await expect(statsServiceTypes(page)).toBeHidden({ timeout: 2_000 });
  });

  test("mobile typing keeps strips hidden", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");

    const input = getHomeCategoryInput(page);
    await input.click();
    await input.fill("el");

    await expect(trustTrustedTile(page)).toBeHidden();
    await expect(statsServiceTypes(page)).toBeHidden();
  });

  test("mobile clear+blur restores strips", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");

    const input = getHomeCategoryInput(page);
    await input.click();
    await input.fill("el");
    await input.fill("");
    await input.evaluate((el: HTMLInputElement) => el.blur());

    await expect(trustTrustedTile(page)).toBeVisible({ timeout: 3_000 });
    await expect(statsServiceTypes(page)).toBeVisible({ timeout: 3_000 });
  });
});

test.describe("PATCH 5 — Issue 2: desktop strips remain visible on focus", () => {
  test("desktop 1280 — trust + stats strips stay visible on focus", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    await expect(trustTrustedTile(page)).toBeVisible();
    await expect(statsServiceTypes(page)).toBeVisible();

    await getHomeCategoryInput(page).click();

    // Both strips must remain visible on desktop after focus.
    await expect(trustTrustedTile(page)).toBeVisible();
    await expect(statsServiceTypes(page)).toBeVisible();
  });
});
