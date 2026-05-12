/**
 * Provider dashboard — re-registration warning when admin removed the
 * provider's last service category.
 *
 * Backend contract: /api/provider/dashboard-profile returns
 *   provider.needsServiceReRegistration === true
 * when the provider has zero provider_services rows. The dashboard
 * surfaces a prominent rose card with a CTA to /provider/register?edit=services.
 *
 * Self-contained: mocks /api/provider/dashboard-profile and /api/kk so
 * the test stays independent of Supabase data and migrations.
 */

import type { Page, Route } from "@playwright/test";

import { bootstrapProviderSession } from "./_support/auth";
import { test, expect } from "./_support/test";

const ZZ_PROVIDER_PHONE = "9999999931";
const ZZ_PROVIDER_ID = "ZZ-QA-REREG-9001";
const ZZ_PROVIDER_NAME = "ZZ QA Re-Registration Provider";
const ZZ_AREA = "ZZ Sardarpura QA";
const ZZ_CATEGORY = "ZZ QA Plumber";

// Provider dashboard's client useEffect uses the browser overload of
// getAuthSession(), which reads the unsigned `kk_session_user` UI-hint
// cookie via document.cookie. bootstrapProviderSession only writes the
// signed `kk_auth_session`, so we also seed the UI-hint cookie here.
// Both are required for the dashboard to render past the "Please login"
// guard.
async function seedProviderSession(page: Page, phone = ZZ_PROVIDER_PHONE) {
  await bootstrapProviderSession(page, phone);
  const session = { phone, verified: true as const, createdAt: Date.now() };
  await page.context().addCookies([
    {
      name: "kk_session_user",
      value: encodeURIComponent(JSON.stringify(session)),
      url: "http://127.0.0.1:3000/",
      sameSite: "Lax",
    },
  ]);
}

type ProfileOverrides = {
  Services?: { Category: string; Status?: string }[];
  needsServiceReRegistration?: boolean;
  Status?: string;
  PendingApproval?: string;
};

function makeProfile(overrides: ProfileOverrides = {}) {
  const services = overrides.Services ?? [];
  return {
    ProviderID: ZZ_PROVIDER_ID,
    ProviderName: ZZ_PROVIDER_NAME,
    Phone: ZZ_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    OtpVerifiedAt: new Date().toISOString(),
    Status: overrides.Status ?? "pending",
    PendingApproval: overrides.PendingApproval ?? "yes",
    needsServiceReRegistration:
      overrides.needsServiceReRegistration ?? services.length === 0,
    Services: services,
    Areas: [{ Area: ZZ_AREA }],
    RejectedCategoryRequests: [],
    AreaCoverage: {
      ActiveApprovedAreas: [{ Area: ZZ_AREA, Status: "active" }],
      PendingAreaRequests: [],
      ResolvedOutcomes: [],
    },
    Analytics: {
      Metrics: {
        TotalRequestsInMyCategories: 0,
        TotalRequestsMatchedToMe: 0,
        TotalRequestsRespondedByMe: 0,
        TotalRequestsAcceptedByMe: 0,
        TotalRequestsCompletedByMe: 0,
        ResponseRate: 0,
        AcceptanceRate: 0,
      },
      AreaDemand: [],
      SelectedAreaDemand: [],
      CategoryDemandByRange: {
        today: [],
        last7Days: [],
        last30Days: [],
        last365Days: [],
      },
      RecentMatchedRequests: [],
    },
  };
}

async function mockDashboardProfile(page: Page, overrides: ProfileOverrides) {
  await page.route(
    "**/api/provider/dashboard-profile**",
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, provider: makeProfile(overrides) }),
      });
    }
  );
}

async function mockKkBaseline(page: Page) {
  await page.route("**/api/kk**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, threads: [], needs: [], provider: null }),
    });
  });
}

// Empty stubs for the side-channel endpoints the provider dashboard
// loads in parallel. Without these the diag fixture trips on 404s
// from /api/provider/notifications and /api/provider/work-terms.
async function mockProviderSideChannels(page: Page) {
  await page.route("**/api/provider/notifications**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, notifications: [], unread: 0 }),
    });
  });
  await page.route("**/api/provider/work-terms**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, providerId: ZZ_PROVIDER_ID, items: [] }),
    });
  });
}

async function gotoDashboard(page: Page) {
  await page.goto("/provider/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

test.describe("Provider dashboard: service re-registration warning", () => {
  test("provider with zero categories sees re-registration warning and CTA", async ({
    page,
    diag,
  }) => {
    await seedProviderSession(page);
    await mockKkBaseline(page);
    await mockProviderSideChannels(page);
    await mockDashboardProfile(page, {
      Services: [],
      needsServiceReRegistration: true,
      Status: "pending",
      PendingApproval: "yes",
    });
    await gotoDashboard(page);

    const warning = page.getByTestId("service-reregistration-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(
      /Service category rejected \/ needs re-registration/i
    );
    await expect(warning).toContainText(
      /Your service category was removed by admin\. Please re-register your service category to start receiving work again\./i
    );

    // CTA points at the services edit flow specifically — not just /register.
    const cta = page.getByTestId("service-reregistration-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute(
      "href",
      "/provider/register?edit=services"
    );

    // Status badge surfaces the dedicated re-registration label
    // instead of the generic "Pending Admin Approval" copy. The label
    // appears in two places — the status pill in the profile header
    // and the heading inside the warning card — so we expect at least
    // 2 matches.
    await expect(
      page.getByText("Service category rejected / needs re-registration", {
        exact: true,
      })
    ).toHaveCount(2);

    diag.assertClean();
  });

  test("provider with remaining categories does not see re-registration warning", async ({
    page,
    diag,
  }) => {
    await seedProviderSession(page);
    await mockKkBaseline(page);
    await mockProviderSideChannels(page);
    await mockDashboardProfile(page, {
      Services: [{ Category: ZZ_CATEGORY, Status: "approved" }],
      needsServiceReRegistration: false,
      Status: "active",
      PendingApproval: "no",
    });
    await gotoDashboard(page);

    // Warning is suppressed when at least one service remains.
    await expect(
      page.getByTestId("service-reregistration-warning")
    ).toHaveCount(0);
    await expect(
      page.getByTestId("service-reregistration-cta")
    ).toHaveCount(0);

    // Approved category is rendered normally on the dashboard.
    await expect(page.getByText(ZZ_CATEGORY, { exact: true }).first()).toBeVisible();

    diag.assertClean();
  });
});
