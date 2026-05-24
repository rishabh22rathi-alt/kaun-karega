/**
 * Provider edit region persistence.
 *
 * Locks the end-to-end contract behind /api/provider/update:
 * selectedRegionCodes is the authoritative region set, while provider_areas
 * is rebuilt from active service_region_areas on the server.
 */

import fs from "fs";
import path from "path";

import type { Page, Route } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
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

const REGION_FIXTURES = [
  { region_code: "JOD-01", region_name: "Region 01", areas: ["JOD-01 Area A", "JOD-01 Area B"] },
  { region_code: "JOD-02", region_name: "Region 02", areas: ["JOD-02 Area A"] },
  { region_code: "JOD-03", region_name: "Region 03", areas: ["JOD-03 Area A", "JOD-03 Area B"] },
  { region_code: "JOD-04", region_name: "Region 04", areas: ["JOD-04 Area A"] },
  { region_code: "JOD-05", region_name: "Region 05", areas: ["JOD-05 Area A"] },
  { region_code: "JOD-06", region_name: "Region 06", areas: ["JOD-06 Area A"] },
];

async function injectProviderUiHint(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_session_user",
      value: JSON.stringify({
        phone: QA_PROVIDER_PHONE,
        verified: true,
        createdAt: Date.now(),
      }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

async function bootstrapEditPage(page: Page, savedRegionCodes: string[] = []) {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page);

  await mockJson(
    page,
    "**/api/categories**",
    jsonOk({ data: COMMON_CATEGORIES.map((category) => ({ name: category.name, active: category.active })) })
  );
  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));
  await mockJson(page, "**/api/area-intelligence/regions**", jsonOk({ regions: REGION_FIXTURES }));
  await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk(buildProviderDashboardResponse()));
  await mockJson(page, "**/api/provider/notifications", jsonOk({ notifications: [] }));
  await mockJson(
    page,
    "**/api/provider/plan**",
    jsonOk({
      plan: { code: "regions_5", maxRegions: 5, currentPeriodEnd: null, active: true, ruleKind: "fixed" },
    })
  );

  const savedAreas = REGION_FIXTURES
    .filter((region) => savedRegionCodes.includes(region.region_code))
    .flatMap((region) => region.areas);

  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
    get_provider_by_phone: () =>
      jsonOk({
        provider: {
          ProviderID: QA_PROVIDER_ID,
          ProviderName: QA_PROVIDER_NAME,
          Phone: QA_PROVIDER_PHONE,
          Verified: "yes",
          OtpVerified: "yes",
          PendingApproval: "no",
          Status: "active",
          Services: [{ Category: QA_CATEGORY }],
          Areas: savedAreas.map((area) => ({ Area: area })),
          RegionCodes: savedRegionCodes,
        },
      }),
  });
}

function regionCard(page: Page, regionName: string) {
  return page.locator("div.rounded-2xl", {
    has: page.getByRole("heading", { level: 3, name: regionName }),
  });
}

async function pickRegion(page: Page, regionName: string) {
  await regionCard(page, regionName)
    .getByRole("button", { name: /^(Pick Region|Selected)/ })
    .click();
}

test.describe("provider region save persistence contract", () => {
  test("save payload contains final selectedRegionCodes and expanded areas", async ({ page }) => {
    const expectedCodes = ["JOD-01", "JOD-02", "JOD-03", "JOD-04", "JOD-06"];
    let captured: Record<string, unknown> | null = null;

    await bootstrapEditPage(page);
    await mockJson(page, "**/api/provider/update**", ({ body }) => {
      captured = body;
      return jsonOk({});
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible();
    for (const code of expectedCodes) {
      const region = REGION_FIXTURES.find((fixture) => fixture.region_code === code);
      if (region) await pickRegion(page, region.region_name);
    }
    await page.getByRole("button", { name: /^Save Changes$/ }).click();

    await expect.poll(() => captured, { timeout: 5_000 }).not.toBeNull();
    const body = captured as unknown as { selectedRegionCodes?: unknown[]; areas?: unknown[] };
    expect(body.selectedRegionCodes).toEqual(expectedCodes);
    expect(body.areas?.length).toBeGreaterThan(0);
    expect(body.areas).toEqual(expect.arrayContaining(["JOD-01 Area A", "JOD-06 Area A"]));
  });

  test("success modal waits for /api/provider/update ok:true", async ({ page }) => {
    const updateGate: { release?: () => void } = {};

    await bootstrapEditPage(page);
    await page.route("**/api/provider/update**", async (route: Route) => {
      await new Promise<void>((resolve) => {
        updateGate.release = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText("Edit Provider Profile")).toBeVisible();
    await pickRegion(page, "Region 01");
    await page.getByRole("button", { name: /^Save Changes$/ }).click();

    await expect(page.getByText("Changes Saved Successfully")).toHaveCount(0);
    updateGate.release?.();
    await expect(page.getByText("Changes Saved Successfully")).toBeVisible();
  });

  test("backend helper expands selectedRegionCodes from service_region_areas before provider_areas insert", () => {
    const root = path.resolve(__dirname, "../..");
    const file = fs.readFileSync(path.join(root, "lib/admin/adminProviderReads.ts"), "utf8");
    expect(file).toContain('.from("service_region_areas")');
    expect(file).toContain('.in("region_code", requestedRegionCodes)');
    expect(file).toContain('.from("provider_areas")');
    expect(file.indexOf('.from("service_region_areas")')).toBeLessThan(
      file.lastIndexOf('.from("provider_areas")')
    );
  });

  test("update route reports DB helper failure instead of returning success", () => {
    const root = path.resolve(__dirname, "../..");
    const file = fs.readFileSync(path.join(root, "app/api/provider/update/route.ts"), "utf8");
    expect(file).toContain("updateProviderInSupabase");
    expect(file).toContain("UPDATE_FAILED");
    expect(file).toContain("result.error");
    expect(file.indexOf("if (!result.success)")).toBeLessThan(file.indexOf("await invalidateSnapshots"));
  });

  test("dashboard-profile derives SelectedRegionCodes from provider_areas.region_code", () => {
    const root = path.resolve(__dirname, "../..");
    const file = fs.readFileSync(path.join(root, "app/api/provider/dashboard-profile/route.ts"), "utf8");
    expect(file).toContain("provider_areas");
    expect(file).toContain("region_code");
    expect(file).toContain("SelectedRegionCodes");
  });
});
