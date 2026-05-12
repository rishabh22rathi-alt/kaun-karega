/**
 * Provider dashboard — orphan leaked categories surface as pending,
 * not as silent "Inactive".
 *
 * Post-patch dashboard-profile derivation:
 *   - in active categories             → "approved"
 *   - in pending_category_requests     → "pending"
 *   - in rejected_category_requests    → "rejected"
 *   - canonical row exists, inactive   → "inactive"   (admin deactivated)
 *   - no canonical, no request row     → "pending"    (orphan leak)
 *
 * Lookup failure (no categories rows fetched) suppresses the orphan
 * synthesis so a transient DB blip can't mass-flip every chip — rows
 * fall back to "inactive" instead. The behaviour is asserted at the
 * source level since the runtime needs DB state we can't safely
 * fabricate in Playwright.
 *
 * Runtime tests drive the dashboard with hand-crafted Services arrays
 * that simulate the post-patch server payload, confirming the chip
 * strip + Pending block render correctly for each case.
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

const ORPHAN = "Saree Showroom";
const DEACTIVATED = "Old Service";

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

test.describe("Provider dashboard — orphan-leaked rows render as pending", () => {
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

  test("orphan-leaked category surfaces as 'Under Review' chip + in Pending block, not Active Approved", async ({
    page,
  }) => {
    // Simulates post-patch server payload: the leaked row carries
    // Status="pending" thanks to the orphan synthesis branch.
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          Services: [
            { Category: QA_CATEGORY, Status: "approved" },
            { Category: ORPHAN, Status: "pending" },
          ],
          RejectedCategoryRequests: [],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    // Chip strip: "Saree Showroom · Under Review".
    await expect(
      page.getByText(new RegExp(`${ORPHAN}.*Under Review`, "i"))
    ).toBeVisible({ timeout: 5_000 });

    // Pending Service Category Requests block lists it explicitly.
    await expect(
      page.getByText(/Pending Service Category Requests/i)
    ).toBeVisible();
    await expect(page.getByText(new RegExp(`^${ORPHAN}$`))).toBeVisible();

    // Active Approved Service Category block lists only the legitimate
    // canonical, never the orphan.
    const approvedBlock = page
      .locator("p", { hasText: /^Active Approved Service Category$/i })
      .locator("..");
    await expect(
      approvedBlock.getByText(new RegExp(`^${ORPHAN}$`))
    ).toHaveCount(0);

    // It must NOT also be tagged Inactive.
    await expect(
      page.getByText(new RegExp(`${ORPHAN}.*Inactive`, "i"))
    ).toHaveCount(0);
  });

  test("admin-deactivated canonical (row exists, active=false) still renders as Inactive, NOT pending", async ({
    page,
  }) => {
    // Simulates the deactivated-canonical case — server emits Status=inactive
    // because the row IS in categories (knownCategoryKeys.has) but with
    // active=false, so the orphan-synthesis branch does not fire.
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          Services: [
            { Category: QA_CATEGORY, Status: "approved" },
            { Category: DEACTIVATED, Status: "inactive" },
          ],
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByText(new RegExp(`${DEACTIVATED}.*Inactive`, "i"))
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(new RegExp(`${DEACTIVATED}.*Under Review`, "i"))
    ).toHaveCount(0);
    // Pending block should NOT show the deactivated row.
    await expect(
      page.getByText(/No pending category requests/i)
    ).toBeVisible();
  });

  test("approved category stays approved; rejected stays rejected", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profile({
          Services: [
            { Category: QA_CATEGORY, Status: "approved" },
            { Category: "Tarot Reader", Status: "rejected" },
          ],
          RejectedCategoryRequests: [
            {
              RequestedCategory: "Tarot Reader",
              Reason: "Not serviceable",
              ActionAt: "2026-05-12T10:00:00.000Z",
            },
          ],
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

    // Rejected request shown only in its own block, never the approved one.
    await expect(
      page.getByText(/Rejected Service Category Requests/i)
    ).toBeVisible();
    await expect(
      approvedBlock.getByText(/^Tarot Reader$/)
    ).toHaveCount(0);
  });
});

test.describe("dashboard-profile source: orphan synthesis", () => {
  const root = path.resolve(__dirname, "../..");

  test("Status derivation synthesizes 'pending' for orphans + guards on knownCategoryKeys.size > 0", () => {
    const file = fs.readFileSync(
      path.join(root, "app/api/provider/dashboard-profile/route.ts"),
      "utf8"
    );
    // The new known-set variable is built from the full categories list.
    expect(file).toContain("knownCategoryKeys");
    // The orphan-synthesis branch is present.
    expect(file).toMatch(
      /knownCategoriesUsable\s*&&\s*!knownCategoryKeys\.has\(key\)/
    );
    // The 'categories' fetch must read BOTH name + active, not just active.
    expect(file).toMatch(
      /\.from\("categories"\)[\s\S]{0,200}\.select\("name, active"\)/
    );
  });
});

test.describe("cleanup script — --backfill-pending mode declared", () => {
  const root = path.resolve(__dirname, "../..");

  test("script supports --backfill-pending and inserts into pending_category_requests", () => {
    const file = fs.readFileSync(
      path.join(root, "scripts/cleanup-leaked-provider-services.mjs"),
      "utf8"
    );
    expect(file).toContain("--backfill-pending");
    expect(file).toContain("BACKFILL");
    expect(file).toContain('.from("pending_category_requests")');
    // Idempotent: skip when a request row already exists.
    expect(file).toMatch(/skipped \+= 1/);
    // Insert payload uses crypto.randomUUID for the request_id.
    expect(file).toMatch(/PCR-\$\{randomUUID\(\)\}/);
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * Reproducing the leak:
 *   1. Use an old DB snapshot where provider P has a provider_services
 *      row for "Saree Showroom" but no row in `categories` and no row
 *      in `pending_category_requests` for the same (provider_id,
 *      requested_category).
 *   2. Open /provider/dashboard for P:
 *        - Service chip shows "Saree Showroom · Under Review".
 *        - "Pending Service Category Requests" block lists "Saree
 *          Showroom · Waiting for admin review".
 *        - "Active Approved Service Category" does NOT list it.
 *
 * Surfacing the backfill side-effect (optional):
 *   3. Run:
 *        node scripts/cleanup-leaked-provider-services.mjs
 *      The dry-run lists the row with `request_status=(no request row)`.
 *   4. Run:
 *        node scripts/cleanup-leaked-provider-services.mjs --backfill-pending
 *      A new pending_category_requests row is inserted; subsequent dry
 *      runs report `skipped` instead of new candidates.
 *   5. Admin opens /admin/dashboard → Category → Pending Admin Approval.
 *      The row appears; Approve promotes it (also inserts the
 *      provider_services row via the existing approveCategoryRequest
 *      patch); Reject closes it with optional reason.
 */
