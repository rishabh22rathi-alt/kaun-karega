import type { Page } from "@playwright/test";

import { mockCommonCatalogRoutes } from "../_support/routes";
import { gotoPath, getHomeCategoryInput } from "../_support/home";
import { test, expect } from "../_support/test";

const VIEWPORTS = [
  { name: "mobile 390px", width: 390, height: 844 },
  { name: "tablet 768px", width: 768, height: 1024 },
  { name: "desktop 1024px", width: 1024, height: 768 },
  { name: "desktop 1280px", width: 1280, height: 900 },
];

function overlayLocator(page: Page) {
  return page.locator('div[aria-hidden="true"].pointer-events-none.bg-white').first();
}

function searchButtonLocator(page: Page) {
  return page.getByRole("button", { name: "Search", exact: true }).first();
}

function iconLocator(page: Page) {
  return page.locator("span.shrink-0.text-xl").first();
}

test.describe("Public: homepage typewriter overlay (PATCH 4)", () => {
  for (const vp of VIEWPORTS) {
    test(`@${vp.name} — overlay sits left of Search button, magnifier remains visible`, async ({
      page,
    }) => {
      await mockCommonCatalogRoutes(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoPath(page, "/");

      await expect(overlayLocator(page)).toBeVisible({ timeout: 5_000 });

      const overlayBox = await overlayLocator(page).boundingBox();
      const buttonBox = await searchButtonLocator(page).boundingBox();
      const iconBox = await iconLocator(page).boundingBox();

      expect(overlayBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(iconBox).not.toBeNull();

      if (overlayBox && buttonBox && iconBox) {
        // Magnifier renders with non-zero box (visible).
        expect(iconBox.width).toBeGreaterThan(0);
        expect(iconBox.height).toBeGreaterThan(0);
        // Icon's right edge sits to the left of overlay's left edge —
        // bg-white no longer covers the icon area.
        expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(overlayBox.x);
        // Overlay's right edge sits to the left of Search button's left edge
        // (1px tolerance for sub-pixel rounding).
        expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(buttonBox.x + 1);
      }
    });
  }

  test("overlay disappears on focus and reappears after clear+blur", async ({ page }) => {
    await mockCommonCatalogRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");

    await expect(overlayLocator(page)).toBeVisible({ timeout: 5_000 });

    const input = getHomeCategoryInput(page);
    await input.click();
    await expect(overlayLocator(page)).toBeHidden({ timeout: 2_000 });

    await input.fill("el");
    await expect(overlayLocator(page)).toBeHidden();

    await input.fill("");
    await input.evaluate((el: HTMLInputElement) => el.blur());

    await expect(overlayLocator(page)).toBeVisible({ timeout: 3_000 });
  });
});
