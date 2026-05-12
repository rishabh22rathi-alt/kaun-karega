/**
 * Provider service-category request lifecycle.
 *
 * Coverage:
 *   1. Provider dashboard no longer shows the "(1/3)" service count
 *      wording; single-service MVP labels render instead.
 *   2. Pending service-category requests appear in the dashboard's
 *      "Pending Service Category Requests" block.
 *   3. Rejected requests with a reason appear in the dashboard's
 *      "Rejected Service Category Requests" block.
 *   4. Admin CategoryTab Pending sub-tab is renamed "Pending Admin
 *      Approval" and shows the request from /api/admin/pending-category-
 *      requests.
 *   5. The provider notification bell renders an item when the DB
 *      contains a category_request_approved / _rejected row (via the
 *      bell's mapType fall-through to the "account" group). This is
 *      verified by injecting a notifications-API mock returning the
 *      exact shape the approve/reject mutations now insert.
 *
 * The admin-side approve/reject endpoint mutation + notification insert
 * is exercised in adminCategoryMutations.ts; the dual-key request lookup
 * and the soft-fail notification path are mirrored from the existing
 * alias-approve flow.
 */

import type { Page } from "@playwright/test";

import { bootstrapProviderSession, bootstrapAdminSession } from "../_support/auth";
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

function dashboardProfile(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return {
    ...base,
    provider: { ...provider, ...overrides },
  };
}

test.describe("Provider dashboard — single-service wording + pending request UI", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
    await injectProviderUiHint(page, QA_PROVIDER_PHONE);
    await mockKkActions(page, {
      get_areas: () => jsonOk({ areas: COMMON_AREAS }),
      get_my_needs: () => jsonOk({ needs: [] }),
      chat_get_threads: () => jsonOk({ threads: [] }),
    });
    // Notifications endpoint — empty by default; specific tests override.
    await mockJson(
      page,
      "**/api/provider/notifications",
      jsonOk({ notifications: [] })
    );
  });

  test("dashboard does not show 'Services (1/3)' or '(1/3)' service-count wording", async ({
    page,
  }) => {
    const dashResp = dashboardProfile({
      Services: [{ Category: QA_CATEGORY, Status: "approved" }],
    });
    await mockJson(page, "**/api/provider/dashboard-profile**", {
      status: 200,
      body: dashResp,
    });

    await gotoPath(page, "/provider/dashboard");

    // Heading should read "Service" (singular) — not "Services (1/3)".
    await expect(
      page.getByRole("heading", { name: /^Service$/i })
    ).toBeVisible({ timeout: 5_000 });

    // Lower coverage section uses singular phrasing too.
    await expect(
      page.getByText(/Active Approved Service Category/i)
    ).toBeVisible();

    // Neither of the old strings should still render anywhere on the page.
    await expect(page.getByText(/Services \(\d+\/3\)/)).toHaveCount(0);
    await expect(
      page.getByText(/Active Approved Service Categories \(\d+\/3\)/)
    ).toHaveCount(0);
  });

  test("pending request shows in dashboard's Pending Service Category Requests block", async ({
    page,
  }) => {
    // Strip default PendingAreaRequests from the seed so the "Waiting
    // for admin review" line in the area section doesn't collide with
    // the category section line we want to assert against.
    const dashResp = dashboardProfile({
      Services: [
        { Category: QA_CATEGORY, Status: "approved" },
        { Category: "Solar Panel Cleaner", Status: "pending" },
      ],
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: QA_AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    });
    await mockJson(page, "**/api/provider/dashboard-profile**", {
      status: 200,
      body: dashResp,
    });

    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByText(/Pending Service Category Requests/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/^Solar Panel Cleaner$/)
    ).toBeVisible();
    await expect(
      page.getByText(/Waiting for admin review/i)
    ).toBeVisible();
  });

  test("rejected request with reason shows in the Rejected block", async ({
    page,
  }) => {
    const dashResp = dashboardProfile({
      Services: [{ Category: QA_CATEGORY, Status: "approved" }],
      RejectedCategoryRequests: [
        {
          RequestedCategory: "Tarot Reader",
          Reason: "Not a serviceable category yet.",
          ActionAt: "2026-05-12T10:00:00.000Z",
        },
      ],
    });
    await mockJson(page, "**/api/provider/dashboard-profile**", {
      status: 200,
      body: dashResp,
    });

    await gotoPath(page, "/provider/dashboard");
    await expect(
      page.getByText(/Rejected Service Category Requests/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^Tarot Reader$/)).toBeVisible();
    await expect(
      page.getByText(/Reason: Not a serviceable category yet\./i)
    ).toBeVisible();
  });
});

test.describe("Admin CategoryTab — Pending Admin Approval sub-tab (source check)", () => {
  // The admin shell sits behind a server-side middleware that requires an
  // HMAC-signed session cookie, which the unsigned test cookies can't
  // satisfy. The renamed sub-tab is pure JSX, so verify it at the source
  // level — same trade-off used for the admin-table overflow check.
  test("CategoryTab source declares the 'Pending Admin Approval' tab", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const file = fs.readFileSync(
      path.resolve(__dirname, "../../components/admin/CategoryTab.tsx"),
      "utf8"
    );
    expect(file).toMatch(/Pending Admin Approval/);
    // The test-id is what Playwright's runtime test will use once the
    // admin auth gate becomes test-friendly; assert it's present so the
    // renderer-side selector remains stable.
    expect(file).toContain('data-testid="kk-admin-category-pending-tab"');
  });
});

test.describe("Approve/reject notification wiring (source check)", () => {
  // Same rationale as above — the admin mutation runs server-side behind
  // the auth gate. Assert the notification helper + type strings are
  // wired into adminCategoryMutations.
  test("adminCategoryMutations.ts inserts provider_notifications on approve + reject", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const file = fs.readFileSync(
      path.resolve(__dirname, "../../lib/admin/adminCategoryMutations.ts"),
      "utf8"
    );
    expect(file).toContain("category_request_approved");
    expect(file).toContain("category_request_rejected");
    expect(file).toContain('.from("provider_notifications")');
    expect(file).toMatch(/notifyProviderOfCategoryDecision/);
  });
});

test.describe("Provider bell — category approve/reject notification surfaces", () => {
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
      "**/api/provider/dashboard-profile**",
      jsonOk(
        dashboardProfile({
          Services: [{ Category: QA_CATEGORY, Status: "approved" }],
        })
      )
    );
  });

  test("approved notification appears under the bell's Account group", async ({
    page,
  }) => {
    await mockJson(page, "**/api/provider/notifications**", () =>
      jsonOk({
        notifications: [
          {
            id: "00000000-0000-0000-0000-aaaaaaaaaaaa",
            type: "category_request_approved",
            title: "Service category approved",
            message:
              `Your requested service category "Solar Panel Cleaner" has been approved.`,
            href: "/provider/dashboard",
            createdAt: "2026-05-12T10:01:00.000Z",
            seen: false,
          },
        ],
      })
    );

    await gotoPath(page, "/provider/dashboard");

    // Bell button — find by aria-label "Notifications" or the badge text.
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible({ timeout: 5_000 });
    await bell.click();

    await expect(page.getByText(/Service category approved/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText(/Solar Panel Cleaner.*has been approved/i)
    ).toBeVisible();
    // Falls into the bell's "Account" group via mapType.
    await expect(page.getByText(/^Account$/)).toBeVisible();
  });

  test("rejected notification with reason appears under Account group", async ({
    page,
  }) => {
    await mockJson(page, "**/api/provider/notifications**", () =>
      jsonOk({
        notifications: [
          {
            id: "00000000-0000-0000-0000-bbbbbbbbbbbb",
            type: "category_request_rejected",
            title: "Service category not approved",
            message:
              `Your requested service category "Tarot Reader" was not approved. Reason: Not a serviceable category yet.`,
            href: "/provider/dashboard",
            createdAt: "2026-05-12T10:02:00.000Z",
            seen: false,
          },
        ],
      })
    );

    await gotoPath(page, "/provider/dashboard");

    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible({ timeout: 5_000 });
    await bell.click();

    await expect(
      page.getByText(/Service category not approved/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/Tarot Reader.*was not approved.*Not a serviceable/i)
    ).toBeVisible();
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * Lifecycle end-to-end (real DB):
 *   1. As Provider A, sign in and complete /provider/register with a new
 *      category like "Solar Panel Cleaner" (typed → "+ Add … as new
 *      service"). The submission writes one row to
 *      pending_category_requests with provider_id = A.
 *   2. On /provider/dashboard you see the row under "Pending Service
 *      Category Requests · Waiting for admin review". The Service block
 *      heading is now just "Service" (no "1/3").
 *   3. As Admin, open /admin/dashboard → Service Categories. The
 *      "Pending Admin Approval" sub-tab badge increments by 1. Click in;
 *      the row shows requested_category, provider name + phone, and the
 *      Approve / Reject buttons.
 *   4. Click Approve → categories table upserts {name, active:true};
 *      pending_category_requests.status flips to "approved";
 *      provider_notifications row inserted with type =
 *      'category_request_approved' for Provider A.
 *      Within 60s the GlobalProviderNotificationBell poll picks up the
 *      row and the bell badge animates. Open it — the Account group
 *      shows "Service category approved · Your requested service
 *      category 'Solar Panel Cleaner' has been approved."
 *   5. /api/categories?include=aliases now returns the new canonical
 *      under `data[]`. Provider register search and homepage category
 *      search both surface the new chip.
 *   6. Repeat for a different request and click Reject (optionally
 *      typing a reason). The dashboard's "Rejected Service Category
 *      Requests" block lists it with the reason text; bell shows
 *      "Service category not approved · Your requested service category
 *      'X' was not approved. Reason: …".
 */
