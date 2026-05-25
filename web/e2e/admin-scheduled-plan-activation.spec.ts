/**
 * Localhost verification — Admin Dashboard "Scheduled Plan Activation".
 *
 * Mocks the two endpoints the tab calls:
 *   GET  /api/admin/provider-plans/activate-scheduled — recent rows
 *   POST /api/admin/provider-plans/activate-scheduled — run + summary
 *
 * No real database / Supabase / Razorpay / FCM is touched. Admin cookie
 * bootstrap mirrors the pattern used by admin-system-health-tab.spec.ts.
 *
 * Selectors use the existing data-testid attributes baked into
 * ScheduledPlansTab.tsx (scheduled-plans-*); no new test IDs are added.
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { appUrl } from "./_support/runtime";
import { test, expect } from "./_support/test";

const ENDPOINT_PATTERN = "**/api/admin/provider-plans/activate-scheduled";

// Accept the window.confirm() that the Run button triggers. Wired with
// page.once so a single test that opens the dialog twice would need to
// re-arm — we don't do that here, but the explicit `once` makes the
// expectation deterministic.
function autoAcceptOneConfirm(page: import("@playwright/test").Page): void {
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
}

async function openAccordion(
  page: import("@playwright/test").Page
): Promise<void> {
  const toggle = page.getByTestId("scheduled-plans-tab-toggle");
  await expect(toggle).toBeVisible();
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await toggle.click();
  }
}

test.describe("Admin: Scheduled Plan Activation tab (localhost)", () => {
  test("A. dashboard renders the section, button, and recent panel", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    // Empty recent list so the panel renders deterministically.
    await mockJson(page, ENDPOINT_PATTERN, ({ request }) => {
      if (request.method() === "GET") {
        return { status: 200, body: { ok: true, recent: [] } };
      }
      return {
        status: 200,
        body: {
          ok: true,
          scanned: 0,
          activated: 0,
          skipped: 0,
          failed: 0,
          failures: [],
        },
      };
    });

    await gotoPath(page, "/admin/dashboard");

    // Header text — visible whether the accordion is open or closed.
    await expect(
      page.getByText("Scheduled Plan Activation", { exact: true })
    ).toBeVisible();

    await openAccordion(page);

    await expect(
      page.getByTestId("scheduled-plans-run-button")
    ).toBeVisible();
    await expect(page.getByTestId("scheduled-plans-run-button")).toHaveText(
      /Run activation now/i
    );

    // "Recent activations" label + the empty-state message render once
    // the GET resolves with an empty list.
    await expect(
      page.getByText("Recent activations", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(/No activations yet/i)
    ).toBeVisible({ timeout: 5_000 });
  });

  test("B. empty run shows all-zero summary and friendly message", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, ({ request }) => {
      if (request.method() === "GET") {
        return { status: 200, body: { ok: true, recent: [] } };
      }
      return {
        status: 200,
        body: {
          ok: true,
          scanned: 0,
          activated: 0,
          skipped: 0,
          failed: 0,
          failures: [],
        },
      };
    });

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    autoAcceptOneConfirm(page);
    await page.getByTestId("scheduled-plans-run-button").click();

    // Result panel appears.
    await expect(
      page.getByTestId("scheduled-plans-run-result")
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByTestId("scheduled-plans-stat-scanned")
    ).toHaveText("0");
    await expect(
      page.getByTestId("scheduled-plans-stat-activated")
    ).toHaveText("0");
    await expect(
      page.getByTestId("scheduled-plans-stat-skipped")
    ).toHaveText("0");
    await expect(
      page.getByTestId("scheduled-plans-stat-failed")
    ).toHaveText("0");

    await expect(
      page.getByText(/No due scheduled plans were found in this run\./i)
    ).toBeVisible();

    // Run-error banner must NOT render on a successful empty run.
    await expect(
      page.getByTestId("scheduled-plans-run-error")
    ).toHaveCount(0);
  });

  test("C. recent activations empty state renders on accordion open", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, ({ request }) => {
      if (request.method() === "GET") {
        return { status: 200, body: { ok: true, recent: [] } };
      }
      // POST not exercised here; return a safe default.
      return {
        status: 200,
        body: {
          ok: true,
          scanned: 0,
          activated: 0,
          skipped: 0,
          failed: 0,
          failures: [],
        },
      };
    });

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    await expect(
      page.getByText(/No activations yet/i)
    ).toBeVisible({ timeout: 5_000 });
    // Recent table must NOT render when the list is empty.
    await expect(
      page.getByTestId("scheduled-plans-recent-table")
    ).toHaveCount(0);
  });

  test("D. failed activation summary shows count, provider id, and error code", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);
    await mockJson(page, ENDPOINT_PATTERN, ({ request }) => {
      if (request.method() === "GET") {
        return { status: 200, body: { ok: true, recent: [] } };
      }
      return {
        status: 200,
        body: {
          ok: true,
          scanned: 1,
          activated: 0,
          skipped: 0,
          failed: 1,
          failures: [
            {
              provider_id: "PR-TEST",
              outcome: "failed",
              error_code: "NO_SCHEDULED_AREAS",
              error_message: "No scheduled areas found",
            },
          ],
        },
      };
    });

    await gotoPath(page, "/admin/dashboard");
    await openAccordion(page);

    autoAcceptOneConfirm(page);
    await page.getByTestId("scheduled-plans-run-button").click();

    await expect(
      page.getByTestId("scheduled-plans-run-result")
    ).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByTestId("scheduled-plans-stat-scanned")
    ).toHaveText("1");
    await expect(
      page.getByTestId("scheduled-plans-stat-failed")
    ).toHaveText("1");

    const failureList = page.getByTestId("scheduled-plans-failures-list");
    await expect(failureList).toBeVisible();
    await expect(failureList).toContainText("PR-TEST");
    await expect(failureList).toContainText("NO_SCHEDULED_AREAS");
    await expect(failureList).toContainText("No scheduled areas found");
  });

  test("E. POST to admin route without admin session returns 401", async ({
    page,
  }) => {
    // No bootstrapAdminSession() — a fresh page.request call carries no
    // admin cookie. The route's requireAdminSession() must reject with
    // 401 UNAUTHORIZED. This validates the auth gate end-to-end against
    // the real Next.js handler (the only test in this file that hits
    // the live route; no mock is registered).
    const res = await page.request.post(
      appUrl("/api/admin/provider-plans/activate-scheduled"),
      { failOnStatusCode: false }
    );
    expect(res.status()).toBe(401);
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("UNAUTHORIZED");
  });
});
