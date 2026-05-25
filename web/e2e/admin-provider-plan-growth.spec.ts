/**
 * Localhost verification — Admin Dashboard "Provider Plan Growth".
 *
 * Mocks the single endpoint the tab consumes:
 *   GET /api/admin/provider-plans/growth-summary[?refresh=1]
 *
 * No real Supabase / Razorpay / FCM is touched. Admin cookie bootstrap
 * mirrors the pattern used by admin-scheduled-plan-activation.spec.ts.
 * Selectors use the data-testid attributes baked into
 * ProviderPlanGrowthTab.tsx by Commit B; no new test IDs are added.
 *
 * Test E (unauthorized 401) is the only test that hits the live Next.js
 * handler — and it stops at the requireAdminSession gate, so no DB read
 * and no state mutation occurs.
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { appUrl } from "./_support/runtime";
import { test, expect } from "./_support/test";

const ENDPOINT_PATTERN = "**/api/admin/provider-plans/growth-summary**";

async function openAccordion(
  page: import("@playwright/test").Page
): Promise<void> {
  const toggle = page.getByTestId("provider-plan-growth-tab-toggle");
  await expect(toggle).toBeVisible();
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await toggle.click();
  }
}

// Standard non-zero payload used by tests A, B, and C. Numbers match
// the values from the Commit C spec so admin-friendly Indian-locale
// formatting (1,234 with comma) is exercised.
const STD_DATA = {
  totals: {
    totalProviders: 1234,
    free: 1100,
    regions5: 110,
    allJodhpur: 24,
    expiredPaid: 6,
    activePaid: 134,
  },
  scheduled: {
    free: 8,
    regions5: 3,
    allJodhpur: 0,
    dueNow: 1,
  },
  expiring: {
    next3Days: 5,
    next7Days: 12,
    expiredButNotActivated: 2,
  },
  revenue: {
    currentMonthlyEstimate: 5834,
    regions5Revenue: 3410,
    allJodhpurRevenue: 2424,
    paidProviderCount: 134,
    freeToPaidConversionPercent: 10.9,
  },
  notes: [
    "Revenue is per 30-day cycle, not calendar month.",
    "Free count includes expired paid providers.",
    "Providers on ₹101 with scheduled ₹31 are counted as active ₹101 until activation.",
    "Scheduled counts are next-cycle movement only.",
    "Expiring next 7 days includes the next 3 days.",
  ],
};

const STD_CACHE_FRESH = {
  cached: false,
  last_updated_at: "2026-05-25T10:00:00.000Z",
  expires_at: "2026-05-25T10:05:00.000Z",
  ttl_seconds: 300,
  refresh_available: true,
  computed_duration_ms: 42,
};

test.describe("Admin: Provider Plan Growth tab (localhost)", () => {
  test("A. renders section, refresh button, and freshness pill", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, () => ({
      status: 200,
      body: { ok: true, data: STD_DATA, cache: STD_CACHE_FRESH },
    }));

    await gotoPath(page, "/admin/dashboard");

    await expect(
      page.getByText("Provider Plan Growth", { exact: true })
    ).toBeVisible();

    await openAccordion(page);

    await expect(
      page.getByTestId("provider-plan-growth-refresh")
    ).toBeVisible();
    await expect(
      page.getByTestId("provider-plan-growth-freshness-pill")
    ).toBeVisible();
  });

  test("B. summary cards render mocked values with en-IN formatting", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, () => ({
      status: 200,
      body: { ok: true, data: STD_DATA, cache: STD_CACHE_FRESH },
    }));

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    // Top stat grid. en-IN gives "1,234" for 1234, "1,100" for 1100,
    // and bare "110" / "24" / "134" / "8" for sub-thousand values.
    // Regex tolerates both comma-formatted and bare-digit rendering
    // so the assertion stays robust if locale resolution differs
    // across environments.
    await expect(
      page.getByTestId("provider-plan-growth-stat-total")
    ).toHaveText(/^1,?234$/);
    await expect(
      page.getByTestId("provider-plan-growth-stat-free")
    ).toHaveText(/^1,?100$/);
    await expect(
      page.getByTestId("provider-plan-growth-stat-regions5")
    ).toHaveText("110");
    await expect(
      page.getByTestId("provider-plan-growth-stat-all-jodhpur")
    ).toHaveText("24");
    await expect(
      page.getByTestId("provider-plan-growth-stat-active-paid")
    ).toHaveText("134");
    await expect(
      page.getByTestId("provider-plan-growth-stat-revenue")
    ).toContainText(/₹5,?834/);

    // Scheduled cards.
    await expect(
      page.getByTestId("provider-plan-growth-stat-scheduled-free")
    ).toHaveText("8");
    await expect(
      page.getByTestId("provider-plan-growth-stat-scheduled-regions5")
    ).toHaveText("3");
    await expect(
      page.getByTestId("provider-plan-growth-stat-due-now")
    ).toHaveText("1");
    // scheduled-all-jodhpur card is conditionally rendered (only when
    // count > 0). STD_DATA has 0, so the card must NOT exist.
    await expect(
      page.getByTestId("provider-plan-growth-stat-scheduled-all-jodhpur")
    ).toHaveCount(0);

    // Expiring cards.
    await expect(
      page.getByTestId("provider-plan-growth-stat-expiring-3d")
    ).toHaveText("5");
    await expect(
      page.getByTestId("provider-plan-growth-stat-expiring-7d")
    ).toHaveText("12");

    // Conversion meter + breakdown table.
    await expect(
      page.getByTestId("provider-plan-growth-conversion-value")
    ).toContainText("10.9%");
    await expect(
      page.getByTestId("provider-plan-growth-breakdown-table")
    ).toBeVisible();
  });

  test("C. Refresh button calls ?refresh=1 and flips pill Cached→Fresh", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Record every request to the endpoint so we can verify that at
    // least one of them carried `?refresh=1` after the click.
    const seenUrls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/admin/provider-plans/growth-summary")) {
        seenUrls.push(req.url());
      }
    });

    // Mock branches on URL: requests without refresh=1 return cached
    // (older timestamp), requests with refresh=1 return fresh (today's
    // timestamp). Older timestamp uses a clearly-past date so the pill
    // text is unambiguously "Cached · …" before the click.
    await mockJson(page, ENDPOINT_PATTERN, ({ request }) => {
      const isRefresh = request.url().includes("refresh=1");
      return {
        status: 200,
        body: {
          ok: true,
          data: STD_DATA,
          cache: {
            cached: !isRefresh,
            last_updated_at: isRefresh
              ? "2026-05-25T10:00:00.000Z"
              : "2026-05-20T10:00:00.000Z",
            expires_at: "2026-05-25T10:05:00.000Z",
            ttl_seconds: 300,
            refresh_available: true,
            computed_duration_ms: 42,
          },
        },
      };
    });

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    // Initial fetch (no refresh=1) → pill shows "Cached · …".
    await expect(
      page.getByTestId("provider-plan-growth-freshness-pill")
    ).toContainText(/Cached/, { timeout: 5_000 });

    // Click Refresh — should trigger a second fetch with refresh=1.
    await page.getByTestId("provider-plan-growth-refresh").click();

    // Pill flips to "Fresh · …".
    await expect(
      page.getByTestId("provider-plan-growth-freshness-pill")
    ).toContainText(/Fresh/, { timeout: 5_000 });

    // Verify the network request URL actually contained refresh=1.
    expect(seenUrls.some((u) => u.includes("refresh=1"))).toBe(true);
  });

  test("D. empty / zero state renders without crash", async ({ page }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, () => ({
      status: 200,
      body: {
        ok: true,
        data: {
          totals: {
            totalProviders: 0,
            free: 0,
            regions5: 0,
            allJodhpur: 0,
            expiredPaid: 0,
            activePaid: 0,
          },
          scheduled: { free: 0, regions5: 0, allJodhpur: 0, dueNow: 0 },
          expiring: {
            next3Days: 0,
            next7Days: 0,
            expiredButNotActivated: 0,
          },
          revenue: {
            currentMonthlyEstimate: 0,
            regions5Revenue: 0,
            allJodhpurRevenue: 0,
            paidProviderCount: 0,
            freeToPaidConversionPercent: 0,
          },
          notes: ["Revenue is per 30-day cycle, not calendar month."],
        },
        cache: STD_CACHE_FRESH,
      },
    }));

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    await expect(
      page.getByTestId("provider-plan-growth-stat-total")
    ).toHaveText("0");
    await expect(
      page.getByTestId("provider-plan-growth-stat-active-paid")
    ).toHaveText("0");
    await expect(
      page.getByTestId("provider-plan-growth-stat-revenue")
    ).toContainText("₹0");
    await expect(
      page.getByTestId("provider-plan-growth-conversion-value")
    ).toContainText("0.0%");
    await expect(
      page.getByTestId("provider-plan-growth-breakdown-table")
    ).toBeVisible();
    // Error banner must NOT render on a successful zero-state response.
    await expect(
      page.getByTestId("provider-plan-growth-error")
    ).toHaveCount(0);
  });

  test("E. unauthenticated GET returns 401", async ({ page }) => {
    // No bootstrapAdminSession() — a fresh page.request call carries
    // no admin cookies. The route's requireAdminSession() must reject
    // with 401 UNAUTHORIZED. This is the only test in this file that
    // hits the live Next.js handler; it stops at the auth gate, so no
    // DB read and no state mutation occurs.
    const res = await page.request.get(
      appUrl("/api/admin/provider-plans/growth-summary"),
      { failOnStatusCode: false }
    );
    expect(res.status()).toBe(401);
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("UNAUTHORIZED");
  });

  test("F. active vs scheduled counts do not double-count revenue", async ({
    page,
  }) => {
    // Provider on ₹101 with a scheduled ₹31. Active card must reflect
    // ₹101; the scheduled card must reflect the future ₹31; revenue
    // must count ONLY the current ₹101 (₹101 — never ₹132 or ₹31).
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, () => ({
      status: 200,
      body: {
        ok: true,
        data: {
          totals: {
            totalProviders: 1,
            free: 0,
            regions5: 0,
            allJodhpur: 1,
            expiredPaid: 0,
            activePaid: 1,
          },
          scheduled: { free: 0, regions5: 1, allJodhpur: 0, dueNow: 0 },
          expiring: {
            next3Days: 0,
            next7Days: 0,
            expiredButNotActivated: 0,
          },
          revenue: {
            currentMonthlyEstimate: 101,
            regions5Revenue: 0,
            allJodhpurRevenue: 101,
            paidProviderCount: 1,
            freeToPaidConversionPercent: 100.0,
          },
          notes: [],
        },
        cache: STD_CACHE_FRESH,
      },
    }));

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    await expect(
      page.getByTestId("provider-plan-growth-stat-all-jodhpur")
    ).toHaveText("1");
    await expect(
      page.getByTestId("provider-plan-growth-stat-scheduled-regions5")
    ).toHaveText("1");
    // regions5 ACTIVE must be 0 — the scheduled ₹31 has not activated.
    await expect(
      page.getByTestId("provider-plan-growth-stat-regions5")
    ).toHaveText("0");

    const revenueCard = page.getByTestId(
      "provider-plan-growth-stat-revenue"
    );
    await expect(revenueCard).toContainText(/₹101\b/);
    // Anti-regression: the wrong calculations (double-count or
    // wrong-plan) must NOT appear in the revenue card.
    await expect(revenueCard).not.toContainText("₹132");
    await expect(revenueCard).not.toContainText(/₹31\b/);
  });
});
