/**
 * Kaun Karega — unknown category → admin visibility flow.
 *
 * End-to-end check that a brand-new (unrecognised) service typed by a user
 * lands in the admin dashboard. Hits the real backend; uses unique RUN_ID
 * suffixes so repeated runs don't collide. No production code is touched.
 *
 * Pre-reqs:
 *   - Dev server running at PLAYWRIGHT_BASE_URL (default http://127.0.0.1:3000)
 *   - QA_USER_PHONE (auth cookie) accepted by the auth flow
 *   - QA_ADMIN_PHONE recognised as an active admin by /api/kk
 *     (otherwise the admin UI assertion will time out)
 */

import { expect, test } from "@playwright/test";

import { bootstrapAdminSession, bootstrapUserSession } from "./_support/auth";
import { gotoPath } from "./_support/home";

test.describe.configure({ mode: "serial" });

const RUN_ID = String(Date.now()).slice(-7);
const UNIQUE_CATEGORY = `ZZ Drone Repair Test ${RUN_ID}`;

test.describe("Admin: unknown category visibility flow", () => {
  test("unknown category request appears in admin", async ({ browser }) => {
    let kaamNo = "";

    // ── A. USER FLOW: submit unknown category via homepage ─────────────────
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    try {
      await bootstrapUserSession(userPage);
      await gotoPath(userPage, "/");

      // Type the unknown category. The dropdown will be empty (no fuzzy
      // match), so the search-input Enter handler commits the raw input
      // and the progressive form opens.
      const categoryInput = userPage.locator('input[type="text"]').first();
      await expect(categoryInput).toBeVisible();
      await categoryInput.click();
      await categoryInput.fill(UNIQUE_CATEGORY);
      await categoryInput.press("Enter");

      // Step 2: when do you need it
      const timeChip = userPage.getByRole("button", { name: /^Right now$/ }).first();
      await expect(timeChip).toBeVisible({ timeout: 10_000 });
      await timeChip.click();

      // Step 3: where do you need it (popular chip — always rendered)
      const areaChip = userPage.getByRole("button", { name: /^Sardarpura$/ }).first();
      await expect(areaChip).toBeVisible({ timeout: 10_000 });
      await areaChip.click();

      // Step 4: submit
      const submitBtn = userPage.getByRole("button", { name: /find providers/i });
      await expect(submitBtn).toBeVisible();
      await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
      await submitBtn.click();

      // Success page — under_review variant for unknown categories renders
      // "Kaam No. {ref}" (after the prior consistency fix).
      await userPage.waitForURL(/\/success/, { timeout: 20_000 });
      const kaamLabel = userPage.getByText(/Kaam No\.\s*\S+/).first();
      await expect(kaamLabel).toBeVisible({ timeout: 15_000 });

      const kaamText = (await kaamLabel.textContent()) ?? "";
      const match = kaamText.match(/Kaam No\.\s*(\S+)/);
      kaamNo = match ? match[1].trim() : "";
      console.log("TEST KAAM NO:", kaamNo);
      expect(kaamNo.length).toBeGreaterThan(0);
    } finally {
      await userContext.close();
    }

    // ── B. ADMIN FLOW: open dashboard, look for the request ────────────────
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    try {
      await bootstrapAdminSession(adminPage);
      await gotoPath(adminPage, "/admin/dashboard");

      // The "Pending Category Requests" accordion is open by default
      // (openSections.pendingCategoryRequests = true), so the row should
      // render once the dashboard's /api/kk fetch resolves.
      const pcrSectionHeader = adminPage
        .getByText(/Pending Category Requests/i)
        .first();
      await expect(pcrSectionHeader).toBeVisible({ timeout: 20_000 });

      // Settle: dashboard fires multiple async fetches; let the dedicated
      // /api/admin/pending-category-requests round-trip complete + render.
      await adminPage.waitForTimeout(1000);

      // Target the cell by data-testid so we don't depend on whitespace
      // splitting / tab-row text concatenation behaviour Playwright applies
      // when matching with getByText against table rows.
      const pcrCellLocator = adminPage
        .getByTestId("pending-category")
        .filter({ hasText: UNIQUE_CATEGORY })
        .first();
      const taskKaamLocator = kaamNo
        ? adminPage.getByText(kaamNo).first()
        : null;

      const pcrVisible = await pcrCellLocator
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);

      const taskVisible = taskKaamLocator
        ? await taskKaamLocator
            .waitFor({ state: "visible", timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
        : false;

      console.log("ADMIN VISIBILITY:", {
        pcrCategoryVisible: pcrVisible,
        taskKaamVisible: taskVisible,
      });

      expect(
        pcrVisible || taskVisible,
        `Expected admin dashboard to show either pending category "${UNIQUE_CATEGORY}" or task ${kaamNo}.`
      ).toBe(true);
    } finally {
      await adminContext.close();
    }
  });
});
