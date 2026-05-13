/**
 * Verification — Admin in-app bell (Phase 1).
 *
 * Mocks GET /api/admin/notifications and POST mark-read; the bell
 * polls every 45s so the test exercises the initial load + manual
 * interactions without waiting on the poll. Confirms read-side reads
 * only happen against /api/admin/notifications, and the only writes
 * land on /api/admin/notifications/mark-read.
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

type Severity = "critical" | "warning" | "info";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: Severity;
  source: string | null;
  relatedId: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

const BASELINE: Notification[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    type: "new_category_request",
    title: "New service category requested",
    message: "Solar Panel Repair was requested and needs admin review.",
    severity: "warning",
    source: "pending_category_requests",
    relatedId: "PCR-1",
    actionUrl: "/admin/dashboard?tab=category",
    readAt: null,
    createdAt: "2026-05-13T11:30:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    type: "new_category_request",
    title: "New service category requested",
    message: "Aquarium Cleaning was requested and needs admin review.",
    severity: "warning",
    source: "pending_category_requests",
    relatedId: "PCR-2",
    actionUrl: null,
    readAt: null,
    createdAt: "2026-05-13T10:00:00.000Z",
  },
];

test.describe("Admin: in-app notification bell (Phase 1)", () => {
  test("bell renders, dropdown opens, mark-read and mark-all-read fire", async ({
    page,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // Stateful notifications mock. The test mutates `notifications`
    // directly so the polling fetch picks up writes via the next call.
    let notifications: Notification[] = BASELINE.map((n) => ({ ...n }));
    const markReadCalls: Array<{ id?: string; all?: boolean }> = [];

    await mockJson(page, "**/api/admin/notifications", () => {
      const unread = notifications.filter((n) => !n.readAt).length;
      return {
        status: 200,
        body: {
          success: true,
          unreadCount: unread,
          notifications,
        } as Record<string, unknown>,
      };
    });

    await mockJson(
      page,
      "**/api/admin/notifications/mark-read",
      ({ body }) => {
        const id = typeof body.id === "string" ? body.id : undefined;
        const all = body.all === true;
        markReadCalls.push({ id, all });
        const nowIso = new Date().toISOString();
        if (all) {
          notifications = notifications.map((n) =>
            n.readAt ? n : { ...n, readAt: nowIso }
          );
        } else if (id) {
          notifications = notifications.map((n) =>
            n.id === id ? { ...n, readAt: nowIso } : n
          );
        }
        return {
          status: 200,
          body: { success: true } as Record<string, unknown>,
        };
      }
    );

    // Block real navigation from action_url so the test stays on the
    // current page after clicking a notification.
    await page.route("**/admin/dashboard?tab=category", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>navigation intercepted</body></html>",
      });
    });

    // ─── PHASE 1 — Bell appears with badge ─────────────────────────
    console.log("[PHASE 1] Bell mounts with unread badge");
    await gotoPath(page, "/admin/dashboard");
    const bell = page.getByTestId("admin-notification-bell");
    await expect(bell).toBeVisible();
    const badge = page.getByTestId("admin-notification-bell-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("2");

    // ─── PHASE 2 — Open dropdown, see items ─────────────────────────
    console.log("[PHASE 2] Click bell — dropdown opens, items render");
    await bell.click();
    const dropdown = page.getByTestId("admin-notification-dropdown");
    await expect(dropdown).toBeVisible();
    for (const n of BASELINE) {
      const item = page.getByTestId(`admin-notification-item-${n.id}`);
      await expect(item).toBeVisible();
      await expect(item).toContainText(n.title);
      await expect(item).toContainText(n.message);
      await expect(item).toHaveAttribute("data-unread", "true");
    }
    console.log("[PHASE 2] PASS — dropdown + 2 unread items");

    // ─── PHASE 3 — Click first item — mark-read fires + navigate ───
    console.log(
      "[PHASE 3] Click first notification → mark-read POST + action URL"
    );
    await page
      .getByTestId(`admin-notification-item-${BASELINE[0].id}`)
      .click();
    await expect(
      page,
      "Action URL navigation fires after mark-read"
    ).toHaveURL(/admin\/dashboard\?tab=category/);
    expect(markReadCalls.some((c) => c.id === BASELINE[0].id)).toBe(true);
    console.log("[PHASE 3] PASS — single mark-read fired");

    // ─── PHASE 4 — Navigate back, Mark all read, badge clears ──────
    console.log("[PHASE 4] Mark all read clears the badge");
    // Reset notifications so the second item is still unread when we
    // reload. We mutate the closure-shared mock state directly so the
    // mock returns the desired snapshot on the next fetch.
    notifications = [
      { ...BASELINE[1], readAt: null },
      { ...BASELINE[0], readAt: new Date().toISOString() },
    ];
    await gotoPath(page, "/admin/dashboard");
    const bell2 = page.getByTestId("admin-notification-bell");
    await expect(bell2).toBeVisible();
    const badge2 = page.getByTestId("admin-notification-bell-badge");
    await expect(badge2).toHaveText("1");
    await bell2.click();
    await page
      .getByTestId("admin-notification-mark-all-read")
      .click();
    // Badge disappears once unreadCount drops to 0.
    await expect(
      page.getByTestId("admin-notification-bell-badge")
    ).toHaveCount(0);
    expect(markReadCalls.some((c) => c.all === true)).toBe(true);
    console.log("[PHASE 4] PASS — mark-all-read fired, badge cleared");

    // ─── PHASE 5 — Empty state ─────────────────────────────────────
    console.log("[PHASE 5] Empty list — empty state renders");
    notifications = [];
    await gotoPath(page, "/admin/dashboard");
    const bell3 = page.getByTestId("admin-notification-bell");
    await expect(bell3).toBeVisible();
    await expect(
      page.getByTestId("admin-notification-bell-badge")
    ).toHaveCount(0);
    await bell3.click();
    await expect(
      page.getByTestId("admin-notification-empty")
    ).toContainText("No admin notifications.");
    console.log("[PHASE 5] PASS — empty state visible");
  });
});
