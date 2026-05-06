import type { Page } from "@playwright/test";

import { mockCommonCatalogRoutes } from "../_support/routes";
import { gotoPath, getHomeCategoryInput } from "../_support/home";
import { test, expect } from "../_support/test";

async function readScrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

async function readRect(page: Page, locator: ReturnType<Page["locator"]>) {
  return locator.boundingBox();
}

test.describe("PATCH 7 — homepage category dropdown keyboard visibility", () => {
  test("dropdown visible inside narrow 390x400 viewport", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 400 });
    await gotoPath(page, "/");

    const input = getHomeCategoryInput(page);
    await input.click();
    await input.fill("plu");

    const dropdown = page.locator(
      'div.absolute.z-50.overflow-hidden.rounded-xl.bg-white.shadow-2xl'
    ).first();
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(150);
    const rect = await dropdown.boundingBox();
    expect(rect).not.toBeNull();
    if (rect) {
      // After scrollIntoView({ block: "nearest" }) the dropdown's body
      // (or at least its top edge) should be within the layout viewport.
      expect(rect.y).toBeGreaterThanOrEqual(-1);
      expect(rect.y).toBeLessThan(400);
    }
  });

  test("normal 390x844 — dropdown opens but page does not jump", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPath(page, "/");

    const scrollBefore = await readScrollY(page);

    const input = getHomeCategoryInput(page);
    await input.click();
    await input.fill("plu");

    const dropdown = page.locator(
      'div.absolute.z-50.overflow-hidden.rounded-xl.bg-white.shadow-2xl'
    ).first();
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(150);
    const scrollAfter = await readScrollY(page);

    // scrollIntoView({ block: "nearest" }) is a no-op if the element is
    // already fully in view. Allow a small tolerance for sub-pixel changes.
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);
  });

  test("desktop 1280x900 — dropdown opens and is in view", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");

    const input = getHomeCategoryInput(page);
    await input.click();
    await input.fill("plu");

    const dropdown = page.locator(
      'div.absolute.z-50.overflow-hidden.rounded-xl.bg-white.shadow-2xl'
    ).first();
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(200);
    const rect = await dropdown.boundingBox();
    expect(rect).not.toBeNull();
    if (rect) {
      // After scrollIntoView({ block: "nearest" }) the dropdown must be
      // within the viewport. Allow rect.y >= -1 for sub-pixel rounding.
      expect(rect.y).toBeGreaterThanOrEqual(-1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(900);
    }
  });
});

async function reachAreaInput(page: Page) {
  const categoryInput = getHomeCategoryInput(page);
  await categoryInput.click();
  await categoryInput.fill("Plumber");
  await categoryInput.press("Enter");

  // Step 2 (WhenNeedIt) appears once category is set; click the first chip.
  const rightNow = page.getByRole("button", { name: /^Right now$/ }).first();
  await expect(rightNow).toBeVisible({ timeout: 3_000 });
  await rightNow.click();

  // Step 3 (AreaSelection) appears once time is set; reveal the typed-area input.
  const typeArea = page.getByRole("button", { name: /^Type your area$/ }).first();
  await expect(typeArea).toBeVisible({ timeout: 3_000 });
  await typeArea.click();
}

test.describe("PATCH 7 — AreaSelection dropdown keyboard visibility", () => {
  test("dropdown visible inside narrow 390x400 viewport", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 390, height: 400 });
    await gotoPath(page, "/");
    await reachAreaInput(page);

    const areaInput = page.locator('input[placeholder="Type your area"]').first();
    await expect(areaInput).toBeVisible({ timeout: 3_000 });
    await areaInput.fill("sh");

    const dropdown = page.locator('div.absolute.z-50.max-h-48').first();
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(200);
    const rect = await dropdown.boundingBox();
    expect(rect).not.toBeNull();
    if (rect) {
      // Dropdown should be at least partially within the layout viewport.
      expect(rect.y + rect.height).toBeGreaterThan(0);
      expect(rect.y).toBeLessThan(400);
    }
  });

  test("desktop 1280x900 — AreaSelection dropdown opens, no page jump", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    await reachAreaInput(page);

    const scrollBefore = await readScrollY(page);

    const areaInput = page.locator('input[placeholder="Type your area"]').first();
    await areaInput.fill("sh");

    const dropdown = page.locator('div.absolute.z-50.max-h-48').first();
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(200);
    const scrollAfter = await readScrollY(page);
    // Already-visible dropdown should produce minimal/no scroll.
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);
  });
});
