/**
 * Phase A — /admin/alerts renders admin_notifications and mark-read works.
 *
 * Hermetic: GET /api/admin/notifications is mocked to return ONE alert
 * shaped exactly like what notifyAdmins() produces (built via the pure
 * core), so this verifies the end-to-end display path the helper feeds.
 */

import { bootstrapAdminSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";
import { buildAdminNotification } from "../../lib/notifications/adminNotifyCore";

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

// One alert exactly as notifyAdmins would persist it (built via core).
const built = buildAdminNotification("provider_paid_plan_subscribed", {
  payment_order_id: "order_abc",
  provider_id: "PR-3131",
  provider_name: "QA Provider",
  plan_code: "all_jodhpur",
  amount_paise: 11918,
})!;

const ALERT = {
  id: "n-1",
  type: built.type,
  title: built.title,
  message: built.message,
  severity: built.severity,
  source: built.source,
  relatedId: built.relatedId,
  actionUrl: built.actionUrl,
  readAt: null as string | null,
  createdAt: "2026-06-01T12:00:00.000Z",
};

async function mockAdminChrome(
  page: import("@playwright/test").Page,
  notifications: Array<Record<string, unknown>>,
  onMarkRead?: (body: string | null) => void
): Promise<void> {
  await hideNextDevOverlay(page);
  await mockJson(page, "**/api/admin/notifications", {
    status: 200,
    body: {
      success: true,
      unreadCount: notifications.filter((n) => !n.readAt).length,
      notifications,
    },
  });
  await mockJson(page, "**/api/admin/notifications/mark-read", ({ request }) => {
    onMarkRead?.(request.postData());
    return jsonOk({ success: true });
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
  await mockJson(
    page,
    "**/api/provider/dashboard-profile",
    jsonOk({ provider: null })
  );
}

test.describe("Admin alerts feed (Phase A)", () => {
  test.use({ viewport: DESKTOP });

  test("renders a notifyAdmins-shaped alert", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page, [ALERT]);

    await gotoPath(page, "/admin/alerts");

    await expect(page.getByTestId("admin-alerts-root")).toBeVisible();
    const item = page.getByTestId("admin-alerts-item-n-1");
    await expect(item).toBeVisible();
    await expect(item).toContainText("New plan subscribed");
    await expect(item).toContainText("Full Jodhpur plan");
    await expect(item).toContainText("Rs. 119.18");

    diag.assertClean();
  });

  test("empty state when there are no alerts", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await mockAdminChrome(page, []);

    await gotoPath(page, "/admin/alerts");
    await expect(page.getByTestId("admin-alerts-empty")).toBeVisible();

    diag.assertClean();
  });

  test("mark-all-read POSTs { all: true }", async ({ page, diag }) => {
    let body: string | null = null;
    await bootstrapAdminSession(page);
    await mockAdminChrome(page, [ALERT], (b) => {
      body = b;
    });

    await gotoPath(page, "/admin/alerts");
    await expect(page.getByTestId("admin-alerts-item-n-1")).toBeVisible();

    await page.getByTestId("admin-alerts-mark-all-read").click();

    await expect.poll(() => body).not.toBeNull();
    const parsed = JSON.parse(body ?? "{}") as { all?: boolean };
    expect(parsed.all).toBe(true);

    diag.assertClean();
  });
});
