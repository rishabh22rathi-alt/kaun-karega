/**
 * Homepage AreaSelection must surface canonical areas that come from
 * `service_region_areas` (Admin → Regions) in addition to the legacy
 * `areas` table. Regression coverage for the bug where region-only areas
 * such as "Guro Ka Talab", "Gopi Krishna Vihar", "Dau Ki Dhani" never
 * appeared in suggestions or in "Show all areas" because /api/areas
 * gated them on provider coverage.
 *
 * Strategy: fully mocked /api/areas and /api/area-intelligence/suggest so
 * the test is deterministic and exercises ONLY the homepage UI contract
 * (typed suggestions, Show-all list, no duplicates). The patch under
 * test changes /api/areas to merge legacy + service_region_areas without
 * a provider-coverage precondition — we simulate that merged payload here.
 */

import type { Locator, Page } from "@playwright/test";

import { mockCommonCatalogRoutes, mockJson, jsonOk } from "./_support/routes";
import { gotoPath, getHomeCategoryInput } from "./_support/home";
import { test, expect } from "./_support/test";

const LEGACY_AREAS = ["Sardarpura", "Shastri Nagar", "Ratanada", "Pal Road"];
const REGION_AREAS = ["Guro Ka Talab", "Gopi Krishna Vihar", "Dau Ki Dhani"];
const MERGED_AREAS = [...LEGACY_AREAS, ...REGION_AREAS].sort((a, b) =>
  a.localeCompare(b)
);

// AreaSelection's suggestion panel container — see AreaSelection.tsx, the
// `<div ref={dropdownRef}>` rendered when `renderDropdown` is true. The
// `top-full` + `max-h-80` + `overflow-y-auto` combination is unique to
// this panel; the popular-area chips ABOVE the input share none of these
// classes. Scoping locators to this container is what keeps Playwright's
// strict mode happy when a quick-suggestion chip (e.g. "Sardarpura") and
// a dropdown row (also "Sardarpura") render simultaneously.
function suggestionPanel(page: Page): Locator {
  return page.locator("div.absolute.top-full.z-50.max-h-80").first();
}

function suggestionRow(page: Page, area: string): Locator {
  return suggestionPanel(page).getByRole("button", {
    name: new RegExp(`^${area}$`),
  });
}

async function reachAreaInput(page: Page) {
  const categoryInput = getHomeCategoryInput(page);
  await categoryInput.click();
  await categoryInput.fill("Plumber");
  await categoryInput.press("Enter");

  const rightNow = page.getByRole("button", { name: /^Right now$/ }).first();
  await expect(rightNow).toBeVisible({ timeout: 5_000 });
  await rightNow.click();

  const typeArea = page.getByRole("button", { name: /^Type your area$/ }).first();
  await expect(typeArea).toBeVisible({ timeout: 5_000 });
  await typeArea.click();
}

test.describe("Homepage AreaSelection — service_region_areas surfacing", () => {
  test.beforeEach(async ({ page }) => {
    // /api/areas returns the merged (legacy ∪ service_region_areas) list,
    // honoring the `q` filter the same way the production route does.
    await mockCommonCatalogRoutes(page, { areas: MERGED_AREAS });

    // /api/area-intelligence/suggest returns canonical_area rows from
    // service_region_areas, gated by 2-char minimum and case-insensitive
    // substring — mirrors web/app/api/area-intelligence/suggest/route.ts.
    await mockJson(page, "**/api/area-intelligence/suggest**", ({ request }) => {
      const q = (
        new URL(request.url()).searchParams.get("query") || ""
      )
        .trim()
        .toLowerCase();
      if (q.length < 2) return jsonOk({ query: q, suggestions: [] });
      const suggestions = REGION_AREAS.filter((area) =>
        area.toLowerCase().includes(q)
      ).map((label) => ({
        type: "canonical_area",
        label,
        canonical_area: label,
        region_code: "JODHPUR",
        region_name: "Jodhpur",
      }));
      return jsonOk({ query: q, suggestions });
    });
  });

  test("typing 'gur' surfaces Guro Ka Talab from service_region_areas", async ({
    page,
  }) => {
    await gotoPath(page, "/");
    await reachAreaInput(page);

    const areaInput = page
      .locator('input[placeholder="Type your area"]')
      .first();
    await areaInput.fill("gur");

    await expect(suggestionRow(page, "Guro Ka Talab")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Show all areas lists merged legacy + service_region_areas", async ({
    page,
  }) => {
    await gotoPath(page, "/");
    await reachAreaInput(page);

    const areaInput = page
      .locator('input[placeholder="Type your area"]')
      .first();
    // Force the no-match error path so the "Show all areas" link renders.
    await areaInput.fill("zzqaunknownareaname");
    const useThisArea = page.getByRole("button", { name: /Use this area/ });
    await useThisArea.click();
    const showAll = page
      .getByRole("button", { name: /Show all areas/ })
      .first();
    await expect(showAll).toBeVisible({ timeout: 5_000 });
    await showAll.click();

    const panel = suggestionPanel(page);
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Every merged area must render as a row INSIDE the dropdown panel.
    // Scoping to `panel` ignores the popular-area chips above the input.
    for (const area of MERGED_AREAS) {
      await expect(suggestionRow(page, area)).toBeVisible();
    }

    // No duplicates: each name should appear exactly once inside the
    // dropdown panel (the chip row is intentionally excluded).
    for (const area of MERGED_AREAS) {
      const count = await suggestionRow(page, area).count();
      expect(count, `duplicate dropdown row for ${area}`).toBe(1);
    }
  });

  test("legacy areas still surface from substring search", async ({ page }) => {
    await gotoPath(page, "/");
    await reachAreaInput(page);

    const areaInput = page
      .locator('input[placeholder="Type your area"]')
      .first();

    await areaInput.fill("sar");
    await expect(suggestionRow(page, "Sardarpura")).toBeVisible({
      timeout: 5_000,
    });

    await areaInput.fill("");
    await areaInput.fill("shastri");
    await expect(suggestionRow(page, "Shastri Nagar")).toBeVisible({
      timeout: 5_000,
    });
  });
});

/**
 * MANUAL TEST NOTES (run against a real Supabase dev DB)
 * ------------------------------------------------------
 * 1. In Admin → Regions, create or confirm an active service_region_area:
 *      region_code: <any active region>
 *      canonical_area: "Guro Ka Talab"
 *      active: true
 *    (Repeat for "Gopi Krishna Vihar" and "Dau Ki Dhani".)
 *
 * 2. Hit /api/areas directly:
 *      curl http://localhost:3000/api/areas | jq '.areas | length'
 *      curl 'http://localhost:3000/api/areas?q=gur' | jq '.areas'
 *    Expect "Guro Ka Talab" in the full list and the prefix query result.
 *
 * 3. On the homepage, pick any category and timing, then "Type your area":
 *    - Type "gur" → "Guro Ka Talab" appears in the dropdown.
 *    - Type "sar" → "Sardarpura" still appears (legacy unaffected).
 *    - Type "shastri" → "Shastri Nagar" still appears (legacy unaffected).
 *    - Trigger Show-all (type an unknown area, click "Use this area" →
 *      "Show all areas") and confirm all three region areas + legacy
 *      areas are listed, each exactly once.
 *
 * 4. Cache: /api/areas TTL is 5 minutes. If a freshly added area does not
 *    appear, wait up to 5 minutes or restart the dev server to flush.
 */
