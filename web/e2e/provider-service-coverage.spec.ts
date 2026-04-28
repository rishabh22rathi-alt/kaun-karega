/**
 * Provider dashboard — "Service Coverage" card (formerly "Area Coverage").
 *
 * Covers the recent restructure that:
 *   1. Renames the card from "Area Coverage" to "Service Coverage" with a
 *      new descriptive subtitle.
 *   2. Adds two category-focused subsections:
 *        - "Active Approved Service Categories (X/3)"
 *        - "Pending Service Category Requests"
 *      sourced from the per-service Status decorated by the dashboard-profile
 *      API (active categories vs. pending_category_requests).
 *   3. Conditionally renders a "Rejected Service Category Requests" subsection
 *      from the new RejectedCategoryRequests payload when status="rejected"
 *      rows exist in pending_category_requests.
 *   4. Hides the legacy "Pending Area Requests" and "Resolved Area Outcomes"
 *      subsections entirely when their arrays are empty (was always rendered).
 *   5. Top "Services (X/3)" chip card now distinguishes a "rejected" Status
 *      with rose styling and a " · Rejected" suffix.
 *
 * Self-contained: mocks /api/provider/dashboard-profile and /api/kk so the
 * test does not depend on Supabase data or migrations.
 */

import type { Page, Route } from "@playwright/test";

import { test, expect } from "./_support/test";

const ZZ_PROVIDER_PHONE = "9999999921";
const ZZ_PROVIDER_ID = "ZZ-QA-SC-9001";
const ZZ_PROVIDER_NAME = "ZZ QA Service Coverage Provider";

const ZZ_AREA_1 = "ZZ Sardarpura QA";
const ZZ_AREA_2 = "ZZ Shastri Nagar QA";

const ZZ_APPROVED_CATEGORY = "ZZ QA Plumber";
const ZZ_APPROVED_CATEGORY_2 = "ZZ QA Electrician";
const ZZ_PENDING_CATEGORY = "ZZ QA Pending Tutor";
const ZZ_REJECTED_CATEGORY = "ZZ QA Rejected Astrologer";
const ZZ_REJECTION_REASON = "Not a supported service category";
const ZZ_REJECTION_AT = "2026-04-20T14:00:00.000Z";

const SERVICE_COVERAGE_DESCRIPTION =
  "Areas are auto-approved. New service categories require admin review.";

async function injectProviderCookie(page: Page, phone = ZZ_PROVIDER_PHONE) {
  const session = { phone, verified: true as const, createdAt: Date.now() };
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: encodeURIComponent(JSON.stringify(session)),
      url: "http://127.0.0.1:3000/",
      sameSite: "Lax",
    },
  ]);
}

type DashboardOverrides = {
  Services?: { Category: string; Status?: string }[];
  RejectedCategoryRequests?: {
    RequestedCategory: string;
    Reason?: string;
    ActionAt?: string;
  }[];
  AreaCoverage?: Record<string, unknown>;
};

function makeProfile(overrides: DashboardOverrides = {}) {
  const services = overrides.Services ?? [
    { Category: ZZ_APPROVED_CATEGORY, Status: "approved" },
    { Category: ZZ_APPROVED_CATEGORY_2, Status: "approved" },
  ];
  const rejected = overrides.RejectedCategoryRequests ?? [];
  const areaCoverage = overrides.AreaCoverage ?? {
    ActiveApprovedAreas: [
      { Area: ZZ_AREA_1, Status: "active" },
      { Area: ZZ_AREA_2, Status: "active" },
    ],
    PendingAreaRequests: [],
    ResolvedOutcomes: [],
  };

  return {
    ProviderID: ZZ_PROVIDER_ID,
    ProviderName: ZZ_PROVIDER_NAME,
    Phone: ZZ_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    OtpVerifiedAt: new Date().toISOString(),
    PendingApproval: "no",
    Services: services,
    Areas: services
      ? [{ Area: ZZ_AREA_1 }, { Area: ZZ_AREA_2 }]
      : [],
    RejectedCategoryRequests: rejected,
    AreaCoverage: areaCoverage,
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
      CategoryDemandByRange: { today: [], last7Days: [], last30Days: [], last365Days: [] },
      RecentMatchedRequests: [],
    },
  };
}

async function mockDashboardProfile(page: Page, overrides: DashboardOverrides = {}) {
  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: makeProfile(overrides) }),
    });
  });
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

async function gotoDashboard(page: Page) {
  await page.goto("/provider/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

function serviceCoverageCard(page: Page) {
  return page
    .getByRole("heading", { name: "Service Coverage", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-[28px]')][1]");
}

test.describe("Provider dashboard: Service Coverage card", () => {
  test("renames card and shows category subsections with approved + pending", async ({
    page,
    diag,
  }) => {
    await injectProviderCookie(page);
    await mockKkBaseline(page);
    await mockDashboardProfile(page, {
      Services: [
        { Category: ZZ_APPROVED_CATEGORY, Status: "approved" },
        { Category: ZZ_APPROVED_CATEGORY_2, Status: "approved" },
        { Category: ZZ_PENDING_CATEGORY, Status: "pending" },
      ],
    });
    await gotoDashboard(page);

    const card = serviceCoverageCard(page);
    await expect(card).toBeVisible();

    // Renamed card title + new subtitle.
    await expect(card.getByText(SERVICE_COVERAGE_DESCRIPTION, { exact: true })).toBeVisible();

    // Active Approved Areas subsection still present.
    await expect(card.getByText("Active Approved Areas (2/5)", { exact: true })).toBeVisible();
    await expect(card.getByText(ZZ_AREA_1, { exact: true })).toBeVisible();
    await expect(card.getByText(ZZ_AREA_2, { exact: true })).toBeVisible();

    // Active Approved Service Categories — counter reflects only approved.
    await expect(
      card.getByText("Active Approved Service Categories (2/3)", { exact: true })
    ).toBeVisible();
    await expect(card.getByText(ZZ_APPROVED_CATEGORY, { exact: true })).toBeVisible();
    await expect(card.getByText(ZZ_APPROVED_CATEGORY_2, { exact: true })).toBeVisible();

    // Pending Service Category Requests — populated, no empty-state line.
    await expect(
      card.getByText("Pending Service Category Requests", { exact: true })
    ).toBeVisible();
    await expect(card.getByText(ZZ_PENDING_CATEGORY, { exact: true })).toBeVisible();
    await expect(card.getByText("Waiting for admin review", { exact: true })).toBeVisible();
    await expect(card.getByText("No pending category requests.", { exact: true })).toHaveCount(0);

    // Rejected subsection NOT rendered when no rejected rows exist.
    await expect(
      card.getByText("Rejected Service Category Requests", { exact: true })
    ).toHaveCount(0);

    // Empty area-review subsections stay hidden — no nag UI.
    await expect(card.getByText("Pending Area Requests", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Resolved Area Outcomes", { exact: true })).toHaveCount(0);

    diag.assertClean();
  });

  test("renders rejected category requests with reason when payload has rejections", async ({
    page,
    diag,
  }) => {
    await injectProviderCookie(page);
    await mockKkBaseline(page);
    await mockDashboardProfile(page, {
      Services: [
        { Category: ZZ_APPROVED_CATEGORY, Status: "approved" },
        { Category: ZZ_REJECTED_CATEGORY, Status: "rejected" },
      ],
      RejectedCategoryRequests: [
        {
          RequestedCategory: ZZ_REJECTED_CATEGORY,
          Reason: ZZ_REJECTION_REASON,
          ActionAt: ZZ_REJECTION_AT,
        },
      ],
    });
    await gotoDashboard(page);

    const card = serviceCoverageCard(page);
    await expect(card).toBeVisible();

    // Approved counter stays at 1/3 — rejected does not count toward active.
    await expect(
      card.getByText("Active Approved Service Categories (1/3)", { exact: true })
    ).toBeVisible();

    // Rejected subsection now rendered with the category, reason, and action
    // marker.
    const rejectedHeading = card.getByText("Rejected Service Category Requests", {
      exact: true,
    });
    await expect(rejectedHeading).toBeVisible();
    await expect(card.getByText(ZZ_REJECTED_CATEGORY, { exact: true })).toBeVisible();
    await expect(card.getByText(/Rejected by admin/)).toBeVisible();
    await expect(card.getByText(new RegExp(ZZ_REJECTION_REASON))).toBeVisible();

    // Top "Services" chip card differentiates the rejected status with the
    // " · Rejected" suffix instead of looking like an approved chip.
    const rejectedChip = page
      .locator("span")
      .filter({ hasText: new RegExp(`^${ZZ_REJECTED_CATEGORY} · Rejected$`) });
    await expect(rejectedChip.first()).toBeVisible();

    // Pending subsection should show the empty-state line — there are no
    // pending rows in this scenario.
    await expect(
      card.getByText("No pending category requests.", { exact: true })
    ).toBeVisible();

    diag.assertClean();
  });

  test("legacy area-review subsections still render when rows exist", async ({
    page,
    diag,
  }) => {
    const ZZ_PENDING_AREA = "ZZ QA Legacy Pending Area";
    const ZZ_RESOLVED_RAW = "ZZ QA Legacy Resolved Raw";
    const ZZ_RESOLVED_CANON = "ZZ QA Legacy Resolved Canon";

    await injectProviderCookie(page);
    await mockKkBaseline(page);
    await mockDashboardProfile(page, {
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: ZZ_AREA_1, Status: "active" }],
        PendingAreaRequests: [
          {
            RequestedArea: ZZ_PENDING_AREA,
            Status: "pending",
            LastSeenAt: "2026-04-12T10:00:00.000Z",
          },
        ],
        ResolvedOutcomes: [
          {
            RequestedArea: ZZ_RESOLVED_RAW,
            ResolvedCanonicalArea: ZZ_RESOLVED_CANON,
            CoverageActive: true,
            Status: "mapped",
            ResolvedAt: "2026-04-10T09:00:00.000Z",
          },
        ],
      },
    });
    await gotoDashboard(page);

    const card = serviceCoverageCard(page);
    await expect(card).toBeVisible();

    // Both legacy sections render when data is present (regression guard
    // for the conditional rendering — must not hide non-empty data).
    await expect(
      card.getByText("Pending Area Requests", { exact: true })
    ).toBeVisible();
    await expect(card.getByText(ZZ_PENDING_AREA, { exact: true })).toBeVisible();

    await expect(
      card.getByText("Resolved Area Outcomes", { exact: true })
    ).toBeVisible();
    await expect(
      card.getByText(`${ZZ_RESOLVED_RAW} -> ${ZZ_RESOLVED_CANON}`, { exact: true })
    ).toBeVisible();
    await expect(card.getByText(/Now active for matching/)).toBeVisible();

    diag.assertClean();
  });
});
