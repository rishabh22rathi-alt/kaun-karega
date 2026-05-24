/**
 * Provider region card — inline expand/collapse for the area preview.
 *
 * Before this fix, each region card sliced its `areas[]` to the first
 * six entries and appended static text "+N more". The provider had no
 * way to inspect the remaining areas before picking the region. The
 * fix turns "+N more" into a real button that toggles an inline
 * expansion of the full list, with a "Show less" affordance to
 * collapse.
 *
 * These specs lock the contract:
 *   - Short regions (≤6 areas)  → no toggle, no expansion.
 *   - Long regions (>6 areas)   → toggle reads "+{N-6} more"; click
 *                                  expands inline; aria-expanded flips;
 *                                  click again collapses.
 *   - Expansion state is independent of selection — picking the region
 *     does NOT collapse the expanded panel and does NOT change the
 *     toggle's text/state.
 *
 * The submit payload is not exercised here (covered by
 * provider-edit-save-region-enable.spec.ts). This spec is UI-only.
 */

import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_ID,
  QA_PROVIDER_NAME,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

const SMALL_REGION_AREAS = [
  "Small Area A",
  "Small Area B",
  "Small Area C",
  "Small Area D",
];

// 25 area names — exceeds the 6-area preview window by 19. The
// hardcoded names are stable across runs so the test asserts the exact
// toggle label "+19 more".
const BIG_REGION_AREAS = Array.from(
  { length: 25 },
  (_, i) => `Big Area ${String(i + 1).padStart(2, "0")}`
);

const REGIONS = [
  {
    region_code: "R-SMALL",
    region_name: "Small Region",
    areas: SMALL_REGION_AREAS,
  },
  {
    region_code: "R-BIG",
    region_name: "Big Region",
    areas: BIG_REGION_AREAS,
  },
];

// Provider register/edit reads the unsigned UI-hint cookie via
// getUserPhone() on mount. Without it the page redirects to /login.
async function injectProviderUiHint(page: Page, phone: string) {
  await page.context().addCookies([
    {
      name: "kk_session_user",
      value: JSON.stringify({
        phone,
        verified: true,
        createdAt: Date.now(),
      }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

async function mockEditPage(page: Page): Promise<void> {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page, QA_PROVIDER_PHONE);

  await mockJson(
    page,
    "**/api/categories**",
    jsonOk({
      data: COMMON_CATEGORIES.map((category) => ({
        name: category.name,
        active: category.active,
      })),
    })
  );
  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ regions: REGIONS })
  );

  const dashboardResponse = buildProviderDashboardResponse();
  await mockJson(
    page,
    "**/api/provider/dashboard-profile**",
    jsonOk(dashboardResponse)
  );

  const provider = {
    ProviderID: QA_PROVIDER_ID,
    ProviderName: QA_PROVIDER_NAME,
    Phone: QA_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    PendingApproval: "no",
    Status: "active",
    Services: [{ Category: QA_CATEGORY }],
    Areas: [{ Area: QA_AREA }],
  };

  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_provider_by_phone: () => jsonOk({ provider }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
  });

  await mockJson(
    page,
    "**/api/provider/notifications",
    jsonOk({ notifications: [] })
  );
}

function regionCard(page: Page, regionName: string) {
  return page.locator("div.rounded-2xl", {
    has: page.getByRole("heading", { level: 3, name: regionName }),
  });
}

test.describe("Provider region card — inline expand/collapse", () => {
  test("R-SMALL (≤6 areas): no toggle button rendered", async ({ page }) => {
    await mockEditPage(page);
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    const card = regionCard(page, "Small Region");
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId("provider-region-areas-toggle-R-SMALL")
    ).toHaveCount(0);
    await expect(
      page.getByTestId("provider-region-areas-full-R-SMALL")
    ).toHaveCount(0);
    // All four small-region areas are visible inline.
    for (const area of SMALL_REGION_AREAS) {
      await expect(card.getByText(area)).toBeVisible();
    }
  });

  test("R-BIG (>6 areas): collapsed state shows '+19 more' toggle and only the first 6 names", async ({
    page,
  }) => {
    await mockEditPage(page);
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    const card = regionCard(page, "Big Region");
    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("+19 more");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Areas 1..6 visible; area 7..25 not visible.
    for (const area of BIG_REGION_AREAS.slice(0, 6)) {
      await expect(card.getByText(area)).toBeVisible();
    }
    await expect(card.getByText("Big Area 07")).toHaveCount(0);
    await expect(card.getByText("Big Area 25")).toHaveCount(0);
    // Full-list container only mounts when expanded.
    await expect(
      page.getByTestId("provider-region-areas-full-R-BIG")
    ).toHaveCount(0);
  });

  test("clicking '+19 more' expands inline; all 25 areas visible; toggle becomes 'Show less' with aria-expanded=true", async ({
    page,
  }) => {
    await mockEditPage(page);
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");
    await toggle.click();

    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const full = page.getByTestId("provider-region-areas-full-R-BIG");
    await expect(full).toBeVisible();
    // All 25 area names present in the expanded container.
    for (const area of BIG_REGION_AREAS) {
      await expect(full).toContainText(area);
    }
  });

  test("clicking 'Show less' collapses; toggle returns to '+19 more' with aria-expanded=false", async ({
    page,
  }) => {
    await mockEditPage(page);
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");
    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await toggle.click();

    await expect(toggle).toHaveText("+19 more");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByTestId("provider-region-areas-full-R-BIG")
    ).toHaveCount(0);
  });

  test("expansion state is independent of selection: expand → Pick Region keeps the panel open and the toggle in expanded state", async ({
    page,
  }) => {
    await mockEditPage(page);
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    const card = regionCard(page, "Big Region");
    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");
    const pickButton = card.getByRole("button", {
      name: /^(Pick Region|Selected ✓)$/,
    });

    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await pickButton.click();

    // Selection flipped — Pick Region → Selected ✓.
    await expect(
      card.getByRole("button", { name: /^Selected ✓$/ })
    ).toBeVisible();
    // Expansion preserved.
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByTestId("provider-region-areas-full-R-BIG")
    ).toBeVisible();
  });

  test("submit payload (selectedRegionCodes) is unaffected by expansion state", async ({
    page,
  }) => {
    let captured: Record<string, unknown> | null = null;
    await mockEditPage(page);
    await mockJson(page, "**/api/provider/update**", ({ body }) => {
      captured = body;
      return jsonOk({});
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible({
      timeout: 5_000,
    });

    // Expand both regions in turn, then pick R-BIG only.
    await page.getByTestId("provider-region-areas-toggle-R-BIG").click();
    const bigCard = regionCard(page, "Big Region");
    await bigCard.getByRole("button", { name: /^Pick Region$/ }).click();

    await page.getByRole("button", { name: /^Save Changes$/ }).click();

    await expect.poll(() => captured, { timeout: 5_000 }).not.toBeNull();
    // Route through `unknown` so the narrow survives the let-binding
    // closure inference quirk used elsewhere in this suite.
    const codes =
      (captured as unknown as { selectedRegionCodes?: string[] } | null)
        ?.selectedRegionCodes ?? [];
    expect(codes).toEqual(["R-BIG"]);
  });
});
