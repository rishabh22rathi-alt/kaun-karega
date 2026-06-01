/**
 * Phase B — Step 1: Admin Push Alerts panel shell.
 *
 * Two layers:
 *   - Pure gate unit tests (both branches, env-independent).
 *   - E2E: with the flag unset in this dev env, the panel must NOT render
 *     on /admin/alerts (and the page still loads). The flag-true render is
 *     covered by the unit test + the manual step in the report (the
 *     NEXT_PUBLIC_* value is inlined at build time, so it can't be toggled
 *     against an already-running dev server).
 */

import { bootstrapAdminSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";
import { shouldShowAdminPushShell } from "../../components/admin/AdminPushControls";

const DESKTOP = { width: 1280, height: 900 };

async function hideNextDevOverlay(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addInitScript(() => {
    const css = "nextjs-portal { display: none !important; }";
    const inject = () => {
      if (!document.head) return;
      if (document.head.querySelector('style[data-test-hide-portal="1"]')) return;
      const style = document.createElement("style");
      style.setAttribute("data-test-hide-portal", "1");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.head) inject();
    else document.addEventListener("DOMContentLoaded", inject, { once: true });
  });
}

async function mockAdminChrome(
  page: import("@playwright/test").Page
): Promise<void> {
  await hideNextDevOverlay(page);
  await mockJson(page, "**/api/admin/notifications", {
    status: 200,
    body: { success: true, unreadCount: 0, notifications: [] },
  });
  await mockJson(page, "**/api/admin/unread-summary", jsonOk({ unread: {} }));
  await mockJson(page, "**/api/admin-verify", {
    status: 200,
    body: { ok: true, admin: { name: "QA Admin", role: "admin", permissions: [] } },
  });
  await mockJson(page, "**/api/announcements/active", jsonOk({ announcement: null }));
  await mockJson(
    page,
    "**/api/admin/provider-stats",
    jsonOk({ data: { total: 0, verified: 0, underReview: 0 } })
  );
  await mockJson(page, "**/api/provider/dashboard-profile", jsonOk({ provider: null }));
}

test.describe("Admin Push Alerts shell — gate (pure)", () => {
  test("shows only when the flag is exactly 'true'", () => {
    expect(shouldShowAdminPushShell("true")).toBe(true);
    expect(shouldShowAdminPushShell("false")).toBe(false);
    expect(shouldShowAdminPushShell(undefined)).toBe(false);
    expect(shouldShowAdminPushShell("")).toBe(false);
    expect(shouldShowAdminPushShell("1")).toBe(false);
    expect(shouldShowAdminPushShell("TRUE")).toBe(false);
  });
});

test.describe("Admin Push Alerts shell — hidden by default", () => {
  test.use({ viewport: DESKTOP });

  test("does not render on /admin/alerts when flag is unset", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page);

    await gotoPath(page, "/admin/alerts");

    // The alerts page itself loads...
    await expect(page.getByTestId("admin-alerts-root")).toBeVisible();
    // ...but the gated push shell is absent (flag not "true" in dev).
    await expect(page.getByTestId("admin-push-controls")).toHaveCount(0);

    diag.assertClean();
  });
});
