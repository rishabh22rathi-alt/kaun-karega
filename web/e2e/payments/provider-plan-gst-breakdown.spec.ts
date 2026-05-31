/**
 * Phase A: GST breakdown surfaced in the payment UI.
 *
 * Verifies the PaymentTermsModal shows base + GST (18%) + total payable
 * before the Razorpay window opens, for:
 *   - immediate upgrade free → regions_5   (₹31.00 + ₹5.58 = ₹36.58)
 *   - immediate upgrade free → all_jodhpur (₹101.00 + ₹18.18 = ₹119.18)
 *   - scheduled-paid-lower all_jodhpur → regions_5 (picker charge
 *     summary + terms modal ₹31.00 / ₹5.58 / ₹36.58)
 *
 * NOTE: like the rest of e2e/, this navigates real pages and therefore
 * requires a running dev server (PLAYWRIGHT_BASE_URL or :3000). The
 * GST arithmetic itself is covered server-free by gst-breakdown.spec.ts.
 */

import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
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
      value: JSON.stringify({ phone, verified: true, createdAt: Date.now() }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

function profileWithPlan(plan: {
  code: string;
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
  paymentsEnabled: boolean;
}): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return { ...base, provider: { ...provider, Plan: plan } };
}

async function installRazorpayStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { Razorpay?: unknown };
    w.Razorpay = function StubRazorpay() {
      return { open: () => {} };
    } as unknown as Window["Razorpay"];
  });
}

test.describe("Phase A — GST breakdown in payment UI", () => {
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
    await installRazorpayStub(page);
  });

  test("immediate upgrade free → regions_5 shows ₹31 + GST ₹5.58 = ₹36.58", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await gotoPath(page, "/provider/dashboard");

    await page.getByTestId("provider-plan-upgrade-regions-5").click();

    await expect(page.getByTestId("payment-terms-modal")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("payment-terms-base")).toHaveText("₹31.00");
    await expect(page.getByTestId("payment-terms-gst")).toHaveText("₹5.58");
    await expect(page.getByTestId("payment-terms-total")).toHaveText("₹36.58");
  });

  test("immediate upgrade free → all_jodhpur shows ₹101 + GST ₹18.18 = ₹119.18", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await gotoPath(page, "/provider/dashboard");

    await page.getByTestId("provider-plan-upgrade-all-jodhpur").click();

    await expect(page.getByTestId("payment-terms-modal")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("payment-terms-base")).toHaveText("₹101.00");
    await expect(page.getByTestId("payment-terms-gst")).toHaveText("₹18.18");
    await expect(page.getByTestId("payment-terms-total")).toHaveText("₹119.18");
  });

  test("scheduled all_jodhpur → regions_5 shows GST breakup (picker + terms)", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "all_jodhpur",
          maxRegions: 9999,
          currentPeriodEnd: "2026-06-30T00:00:00.000Z",
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    // Region catalogue for the scheduled picker (needs ≥5 to pick 5).
    await mockJson(
      page,
      "**/api/area-intelligence/regions**",
      jsonOk({
        regions: [
          { region_code: "R1", region_name: "Region One", areas: [] },
          { region_code: "R2", region_name: "Region Two", areas: [] },
          { region_code: "R3", region_name: "Region Three", areas: [] },
          { region_code: "R4", region_name: "Region Four", areas: [] },
          { region_code: "R5", region_name: "Region Five", areas: [] },
          { region_code: "R6", region_name: "Region Six", areas: [] },
        ],
      })
    );
    await gotoPath(page, "/provider/dashboard");

    // Current plan is all_jodhpur → choosing ₹31 is a scheduled-lower.
    await page.getByTestId("provider-plan-compare-cta-regions_5").click();

    // Picker surfaces the GST-inclusive charge summary up front.
    await expect(page.getByTestId("scheduled-region-picker")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByTestId("scheduled-region-picker-charge")
    ).toContainText("₹36.58");

    for (const code of ["R1", "R2", "R3", "R4", "R5"]) {
      await page.getByTestId(`scheduled-region-option-${code}`).click();
    }
    await page.getByTestId("scheduled-region-picker-continue").click();

    // Terms modal repeats the full base / GST / total receipt.
    await expect(page.getByTestId("payment-terms-modal")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("payment-terms-base")).toHaveText("₹31.00");
    await expect(page.getByTestId("payment-terms-gst")).toHaveText("₹5.58");
    await expect(page.getByTestId("payment-terms-total")).toHaveText("₹36.58");
  });
});
