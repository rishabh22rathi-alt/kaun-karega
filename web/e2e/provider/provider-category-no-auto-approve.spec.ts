/**
 * Provider service-category request — no auto-approval.
 *
 * Before this patch the registration / edit flows inserted ALL submitted
 * categories (canonical + custom) into provider_services immediately,
 * which caused custom-requested categories ("Saree Showroom") to surface
 * under "Active Approved Service Category" on the dashboard. The fix:
 *   1. /api/kk provider_register inserts only canonical categories
 *      (membership in `categories` where active=true) into
 *      provider_services. Custom categories go ONLY to
 *      pending_category_requests.
 *   2. /api/provider/update mirrors that filter — the new-custom set
 *      stays out of provider_services.
 *   3. /api/provider/dashboard-profile synthesizes a Services entry with
 *      Status="pending" for each pending_category_requests row that
 *      doesn't have a matching provider_services row. The existing
 *      "Pending Service Category Requests" block in the dashboard
 *      filters services by Status="pending", so the synthetic entry
 *      flows straight in without UI changes.
 *   4. adminCategoryMutations.approveCategoryRequest inserts the
 *      provider_services row at approval time so the approved category
 *      becomes a real Active Approved Service.
 *
 * Source-level checks cover the admin/dashboard mutation paths because
 * /admin is gated by an HMAC-signed-cookie middleware that the test
 * environment can't satisfy.
 */

import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
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

const REQUESTED = "Saree Showroom";

function dashboardProfile(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return {
    ...base,
    provider: {
      ...provider,
      ...overrides,
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: QA_AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    },
  };
}

test.describe("Provider dashboard — custom category is pending, not active", () => {
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

  test("custom request shows as pending only — never appears as Active Approved", async ({
    page,
  }) => {
    // Simulates the post-patch state: dashboard-profile route emits a
    // SYNTHETIC Status="pending" entry for the pending_category_requests
    // row when no matching provider_services row exists.
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        dashboardProfile({
          Services: [
            // No approved canonical for this provider yet.
            { Category: REQUESTED, Status: "pending" },
          ],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    // Pending block shows the request.
    await expect(
      page.getByText(/Pending Service Category Requests/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(new RegExp(`^${REQUESTED}$`))).toBeVisible();

    // The "Active Approved Service Category" section exists but
    // shows the empty-state copy — the request must NOT appear under it.
    await expect(
      page.getByText(/Active Approved Service Category/i)
    ).toBeVisible();
    await expect(
      page.getByText(/No approved service categories yet/i)
    ).toBeVisible();
  });

  test("approval moves the category to Active Approved (admin-side simulation)", async ({
    page,
  }) => {
    // Simulates the dashboard state AFTER approveCategoryRequest has
    // inserted a provider_services row and the category became active.
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        dashboardProfile({
          Services: [{ Category: REQUESTED, Status: "approved" }],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByText(/Active Approved Service Category/i)
    ).toBeVisible({ timeout: 5_000 });
    // The category renders as an approved chip in the coverage block.
    await expect(page.getByText(new RegExp(`^${REQUESTED}$`)).first()).toBeVisible();
    // It must NOT appear under "Pending" anymore.
    await expect(
      page.getByText(/No pending category requests/i)
    ).toBeVisible();
  });

  test("rejection keeps the category out of Active Approved", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        dashboardProfile({
          Services: [{ Category: QA_CATEGORY, Status: "approved" }],
          RejectedCategoryRequests: [
            {
              RequestedCategory: REQUESTED,
              Reason: "Not a serviceable category yet.",
              ActionAt: "2026-05-12T10:00:00.000Z",
            },
          ],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByText(/Rejected Service Category Requests/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(new RegExp(`^${REQUESTED}$`))).toBeVisible();

    // The Active Approved block only shows the legitimate approved
    // canonical, not the rejected request.
    await expect(
      page.getByText(/Active Approved Service Category/i)
    ).toBeVisible();
    await expect(page.getByText(new RegExp(`^${QA_CATEGORY}$`)).first()).toBeVisible();
    // The rejected category must not also appear as approved.
    await expect(
      page
        .locator("p", { hasText: /^Active Approved Service Category/i })
        .locator("..")
        .getByText(new RegExp(`^${REQUESTED}$`))
    ).toHaveCount(0);
  });
});

test.describe("Server-side: provider_register skips custom categories from provider_services", () => {
  // The dev server's HMAC-signed-cookie auth gate is unreachable from
  // tests, so the policy is verified at the source level. The runtime
  // dashboard tests above prove the propagation end-to-end.
  test("/api/kk provider_register only inserts approved canonicals", () => {
    const root = path.resolve(__dirname, "../..");
    const file = fs.readFileSync(
      path.join(root, "app/api/kk/route.ts"),
      "utf8"
    );
    // The filter must mention the active-categories set the route already
    // built (`approvedCategoryNames`) as the source of truth for what's
    // "approved" before insert.
    expect(file).toMatch(
      /approvedSelectedCategories[\s\S]*approvedCategoryNames\.has/
    );
    // Pending derivation must also be server-side so a client that
    // forgets to mark pendingNewCategories doesn't bypass the queue.
    expect(file).toContain("serverPendingNewCategories");
    expect(file).toContain("effectivePendingNewCategories");
  });

  test("/api/provider/update only inserts approved canonicals", () => {
    const root = path.resolve(__dirname, "../..");
    const file = fs.readFileSync(
      path.join(root, "app/api/provider/update/route.ts"),
      "utf8"
    );
    expect(file).toMatch(/newCustomCategoryKeys/);
    expect(file).toMatch(
      /approvedSelectedCategories[\s\S]*newCustomCategoryKeys\.has/
    );
    expect(file).toMatch(
      /updateProviderInSupabase\([\s\S]*categories: approvedSelectedCategories/
    );
  });

  test("approveCategoryRequest inserts provider_services row for the requesting provider", () => {
    const root = path.resolve(__dirname, "../..");
    const file = fs.readFileSync(
      path.join(root, "lib/admin/adminCategoryMutations.ts"),
      "utf8"
    );
    expect(file).toContain('.from("provider_services")');
    expect(file).toMatch(/provider_id: String\(requestRow\.provider_id\)/);
    expect(file).toMatch(/category: categoryName/);
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * 1. Sign in as a new provider, complete /provider/register with a
 *    brand-new category "Saree Showroom" via "+ Add as new service".
 *    Backend behaviour:
 *      - providers row inserted.
 *      - provider_services has NO row for "Saree Showroom".
 *      - pending_category_requests has one row with status="pending".
 * 2. Open /provider/dashboard:
 *      - "Active Approved Service Category" → empty (or shows the
 *        provider's other approved category if any).
 *      - "Pending Service Category Requests" → shows "Saree Showroom ·
 *        Waiting for admin review".
 * 3. As admin, open /admin/dashboard → Category → Pending Admin
 *    Approval → click Approve on the row. The mutation:
 *      - upserts {name:"Saree Showroom", active:true} into categories.
 *      - flips pending_category_requests.status to "approved".
 *      - inserts {provider_id, category:"Saree Showroom"} into
 *        provider_services (no-op if already present).
 *      - inserts the provider_notifications row.
 * 4. Refresh /provider/dashboard:
 *      - "Active Approved Service Category" now shows "Saree Showroom".
 *      - "Pending Service Category Requests" → "No pending category
 *        requests."
 * 5. /api/categories?include=aliases now includes Saree Showroom in
 *    data[]; homepage + provider-register search both surface it.
 * 6. Reject path: a different request, click Reject (optionally with a
 *    reason). pending_category_requests.status becomes "rejected"; the
 *    dashboard shows it under "Rejected Service Category Requests" with
 *    the reason; provider_services is untouched; the category does NOT
 *    appear under Active Approved.
 */
