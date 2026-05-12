/**
 * Legacy provider_services leak — dashboard status derivation must
 * never re-promote a leaked row to "approved".
 *
 * Patch under test:
 *   - dashboard-profile route initialises every provider_services-derived
 *     Status to "inactive". Only categories in `categories.active=true`
 *     are promoted to "approved"; pending/rejected lookups override to
 *     "pending"/"rejected" respectively.
 *   - Lookup failures no longer fall through to "approved".
 *
 * Mock strategy: drive `/api/provider/dashboard-profile` with hand-crafted
 * Services arrays so the downstream UI's grouping (active vs. pending vs.
 * rejected vs. inactive) can be asserted at the chip level. The server-
 * side derivation that produces these Status values is covered by a
 * source-level check (the `inactive` default + the absence of the old
 * `serviceStatusLookupsFailed` fall-through).
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

const LEAKED = "Saree Showroom";

function profile(
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

test.describe("Legacy provider_services leak — dashboard renders correct status", () => {
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

  test("leaked legacy row (Status=inactive) renders under chips with '· Inactive' badge, not under Active Approved", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          // Simulates the post-patch payload: server emitted Status=inactive
          // because the leaked category is missing from active categories
          // AND has no pending_category_requests entry.
          Services: [
            { Category: QA_CATEGORY, Status: "approved" },
            { Category: LEAKED, Status: "inactive" },
          ],
          RejectedCategoryRequests: [],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    // The chip row shows "Saree Showroom · Inactive".
    await expect(
      page.getByText(new RegExp(`${LEAKED}.*Inactive`, "i"))
    ).toBeVisible({ timeout: 5_000 });

    // Active Approved Service Category lists only the legitimate canonical.
    const approvedBlock = page
      .locator("p", { hasText: /^Active Approved Service Category$/i })
      .locator("..");
    await expect(
      approvedBlock.getByText(new RegExp(`^${QA_CATEGORY}$`))
    ).toBeVisible();
    await expect(
      approvedBlock.getByText(new RegExp(`^${LEAKED}$`))
    ).toHaveCount(0);
  });

  test("approved category continues to render under Active Approved", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          Services: [{ Category: QA_CATEGORY, Status: "approved" }],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const approvedBlock = page
      .locator("p", { hasText: /^Active Approved Service Category$/i })
      .locator("..");
    await expect(
      approvedBlock.getByText(new RegExp(`^${QA_CATEGORY}$`))
    ).toBeVisible({ timeout: 5_000 });
  });

  test("pending category renders under Pending block, never under Active Approved", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          Services: [{ Category: LEAKED, Status: "pending" }],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByText(/Pending Service Category Requests/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(new RegExp(`^${LEAKED}$`))).toBeVisible();

    const approvedBlock = page
      .locator("p", { hasText: /^Active Approved Service Category$/i })
      .locator("..");
    await expect(
      approvedBlock.getByText(new RegExp(`^${LEAKED}$`))
    ).toHaveCount(0);
  });

  test("rejected category renders rejected/inactive, never approved", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          // The dashboard chip surface for Status=rejected reads
          // "X · Rejected". The Rejected section uses
          // RejectedCategoryRequests separately.
          Services: [
            { Category: QA_CATEGORY, Status: "approved" },
            { Category: LEAKED, Status: "rejected" },
          ],
          RejectedCategoryRequests: [
            {
              RequestedCategory: LEAKED,
              Reason: "Not a serviceable category yet.",
              ActionAt: "2026-05-12T10:00:00.000Z",
            },
          ],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    // Rejected services area should list the request with its reason.
    await expect(
      page.getByText(/Rejected Service Category Requests/i)
    ).toBeVisible({ timeout: 5_000 });

    // The chip strip should render "X · Rejected". The Rejected Service
    // Category Requests block also surfaces the same name nearby, so we
    // assert at-least-one-match rather than a strict single hit.
    await expect(
      page.getByText(new RegExp(`${LEAKED}.*Rejected`, "i")).first()
    ).toBeVisible();

    // Active Approved block must NOT contain the rejected category.
    const approvedBlock = page
      .locator("p", { hasText: /^Active Approved Service Category$/i })
      .locator("..");
    await expect(
      approvedBlock.getByText(new RegExp(`^${LEAKED}$`))
    ).toHaveCount(0);
  });
});

test.describe("dashboard-profile source: default Status is 'inactive', no auto-approve fall-through", () => {
  // /api/provider/dashboard-profile sits behind a session-cookie gate; the
  // status-derivation logic is small and stable, so a source-level check
  // is sufficient to prove the fall-through default is no longer
  // "approved".
  const root = path.resolve(__dirname, "../..");

  test("Services derivation defaults Status to 'inactive'", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/provider/dashboard-profile/route.ts"),
      "utf8"
    );
    // The Services builder must declare its Status default as "inactive"
    // (not "approved"). Match a quoted "inactive" literal that sits
    // alongside the variable declaration.
    expect(file).toMatch(
      /let Status: "approved" \| "pending" \| "rejected" \| "inactive" =\s*"inactive"/
    );
    // The old serviceStatusLookupsFailed gate is gone — promotion to
    // "approved" now ONLY happens via activeCategoryKeys membership.
    expect(file).not.toMatch(/if \(!serviceStatusLookupsFailed\)/);
  });
});

/**
 * MANUAL CLEANUP NOTES
 * --------------------
 * 1. Inspect leak candidates without modifying data:
 *      node scripts/cleanup-leaked-provider-services.mjs
 *    Prints a list of provider_services rows whose category is not in
 *    `categories.active=true`, annotated with the matching
 *    pending_category_requests status (if any).
 *
 * 2. Emit JSON for CI/replay:
 *      node scripts/cleanup-leaked-provider-services.mjs --json
 *
 * 3. Delete the leaked rows:
 *      node scripts/cleanup-leaked-provider-services.mjs --apply
 *    Deletes provider_services rows one-by-one with per-row failure
 *    logging. Re-runs are idempotent — second run reports zero candidates.
 *
 * 4. After cleanup, refresh /provider/dashboard for each affected
 *    provider. Leaked categories disappear entirely from the chip strip
 *    (no more "· Inactive" badge). Real approved categories continue to
 *    render under "Active Approved Service Category". Pending and
 *    rejected requests continue to surface in their respective blocks.
 *
 * 5. Even before running the cleanup script, the dashboard render fix
 *    alone is enough to fix the reported bug — leaked rows render
 *    "· Inactive" instead of as approved. The cleanup is a separate
 *    optional step that physically removes the rows from the table.
 */
