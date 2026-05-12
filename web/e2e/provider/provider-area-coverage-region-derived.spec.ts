/**
 * Provider dashboard area coverage — region-derived display.
 *
 * Post-patch:
 *   - getProviderAreaCoverageFromSupabase infers selected regions from
 *     provider_areas × service_region_areas overlap, then returns the
 *     CURRENT canonical_area list under those regions as
 *     ActiveApprovedAreas. Adding a new admin area under a selected
 *     region shows up automatically on next dashboard poll.
 *   - Legacy providers with no region overlap fall back to raw
 *     provider_areas (no behavioural change for that cohort).
 *
 * Source-level checks cover the server derivation logic; UI checks
 * cover the heading + helper text + the chip render.
 */

import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

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

function profile(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return {
    ...base,
    provider: { ...provider, ...overrides },
  };
}

test.describe("Provider dashboard coverage — heading + helper text", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
    await injectProviderUiHint(page, QA_PROVIDER_PHONE);
    await mockKkActions(page, {
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      get_my_needs: () => jsonOk({ needs: [] }),
      chat_get_threads: () => jsonOk({ threads: [] }),
    });
    await mockJson(
      page,
      "**/api/provider/notifications",
      jsonOk({ notifications: [] })
    );
  });

  test("section heading reads 'Areas Under Your Selected Regions' (no x/y counter) + helper text", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          Services: [{ Category: QA_CATEGORY, Status: "approved" }],
          AreaCoverage: {
            ActiveApprovedAreas: [
              { Area: QA_AREA, Status: "active" },
              { Area: "Shastri Nagar", Status: "active" },
            ],
            PendingAreaRequests: [],
            ResolvedOutcomes: [],
          },
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByText(/^Areas Under Your Selected Regions$/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(
        /These areas update automatically when admin updates your selected regions/i
      )
    ).toBeVisible();

    // The old "(x/y)" counter wording must be gone.
    await expect(
      page.getByText(/Active Approved Areas \(\d+\/\d+\)/)
    ).toHaveCount(0);

    // Chips render exactly what the payload provided — chip count is the
    // length of ActiveApprovedAreas (region-derived list).
    await expect(page.getByText(new RegExp(`^${QA_AREA}$`))).toBeVisible();
    await expect(page.getByText(/^Shastri Nagar$/)).toBeVisible();
  });

  test("chip list reflects the live area set when ActiveApprovedAreas changes between polls", async ({
    page,
  }) => {
    // Simulate an admin-added area: first poll returns 2 areas, then we
    // navigate again and the second poll returns 3 (e.g., a new admin
    // area "Pal Road" landed under the provider's region).
    const baseAreas = [
      { Area: QA_AREA, Status: "active" },
      { Area: "Shastri Nagar", Status: "active" },
    ];
    let payload = profile({
      Services: [{ Category: QA_CATEGORY, Status: "approved" }],
      AreaCoverage: {
        ActiveApprovedAreas: baseAreas,
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    });

    await mockJson(page, "**/api/provider/dashboard-profile**", () =>
      jsonOk(payload)
    );

    await gotoPath(page, "/provider/dashboard");
    await expect(page.getByText(/^Shastri Nagar$/)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/^Pal Road$/)).toHaveCount(0);

    // Admin adds "Pal Road" to the region. Next dashboard load picks it
    // up automatically — no provider-side write needed.
    payload = profile({
      Services: [{ Category: QA_CATEGORY, Status: "approved" }],
      AreaCoverage: {
        ActiveApprovedAreas: [
          ...baseAreas,
          { Area: "Pal Road", Status: "active" },
        ],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    });
    await page.reload();
    await expect(page.getByText(/^Pal Road$/)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("dashboard-profile source: region-derived coverage + legacy fallback", () => {
  const root = path.resolve(__dirname, "../..");

  test("getProviderAreaCoverageFromSupabase reads service_region_areas + falls back to provider_areas", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/provider/dashboard-profile/route.ts"),
      "utf8"
    );
    // Reads the region catalog at request time.
    expect(file).toContain('.from("service_region_areas")');
    expect(file).toMatch(/canonical_area, region_code, active/);
    // Selected-region inference + fallback variables both exist.
    expect(file).toContain("regionDerivedActiveAreas");
    expect(file).toContain("fallbackActiveAreas");
    // No-overlap providers fall through to raw provider_areas.
    expect(file).toMatch(
      /regionDerivedActiveAreas\s*&&\s*regionDerivedActiveAreas\.length\s*>\s*0[\s\S]{0,80}fallbackActiveAreas/
    );
  });
});

/**
 * MANUAL NOTES — matching is unchanged
 * ------------------------------------
 * /api/find-provider still ILIKEs against provider_areas; the dashboard
 * display is now region-derived, so a provider can briefly see an area
 * on the dashboard that the matcher won't yet route a task to. That's
 * acceptable for the display fix the task scope allows — the safe path
 * to align matching is to also refresh provider_areas on each register/
 * update via the region expansion (already in place for new submissions
 * via the /provider/register region picker; legacy providers' rows are
 * not auto-rewritten by the dashboard).
 */
