/**
 * ProviderPlanCard — badge presentation rules (Phase 1 stabilization).
 *
 * The "Active" pill on the provider's plan card is reserved for PAID
 * active plans only. Rendering it on Free (where effectivePlan() returns
 * active:true by design) reads as "you paid for the free plan" to a
 * non-technical provider. These specs lock that contract:
 *
 *   - Free plan       → no Active badge, no Expired badge.
 *   - Paid active     → Active badge visible.
 *   - Paid expired    → Expired badge visible, no Active badge.
 *
 * No payment flow is exercised here — checkout buttons are clicked in a
 * separate spec when payments go live. This spec only verifies the
 * render contract that gates that future work.
 */

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
import type { Page } from "@playwright/test";

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

function profileWithPlan(
  plan: {
    code: string;
    maxRegions: number;
    currentPeriodEnd: string | null;
    active: boolean;
  }
): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return {
    ...base,
    provider: { ...provider, Plan: plan },
  };
}

test.describe("ProviderPlanCard — badge presentation", () => {
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

  test("free plan: card visible, Active badge hidden, Expired badge hidden", async ({
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
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-active-badge")).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-expired-badge")).toHaveCount(0);
  });

  test("paid active plan (regions_5): Active badge visible, Expired badge hidden", async ({
    page,
  }) => {
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "regions_5",
          maxRegions: 5,
          currentPeriodEnd: future,
          active: true,
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-active-badge")).toBeVisible();
    await expect(page.getByTestId("provider-plan-expired-badge")).toHaveCount(0);
  });

  test("paid expired plan: Expired badge visible, Active badge hidden", async ({
    page,
  }) => {
    // effectivePlan() on the server collapses an expired-paid row to
    // { code: "free", active: false, currentPeriodEnd: <past> } so the
    // mock here mirrors that wire shape — the card relies on it.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: past,
          active: false,
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-expired-badge")).toBeVisible();
    await expect(page.getByTestId("provider-plan-active-badge")).toHaveCount(0);
  });
});
