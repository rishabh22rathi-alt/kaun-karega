/**
 * Admin mobile bottom nav — focused coverage at 390x844.
 *
 * Verifies:
 *   - Bar renders only after AdminLayoutClient's loading gate clears
 *     (bootstrapped admin session via addInitScript fast-path).
 *   - Five tabs: Dashboard, Providers, Kaam, Alerts, Menu.
 *   - Public bottom nav stays hidden on /admin/* (existing guard).
 *   - /admin/login renders no admin chrome.
 *   - Providers/Kaam tabs deep-link to ?tab=providers / ?tab=kaam and
 *     the corresponding accordion lands open.
 *   - Alerts routes to /admin/notifications.
 *   - Menu opens the bottom sheet with the expected secondary links.
 *   - Logout invokes /api/auth/logout and clears kk_admin_session.
 *   - Mobile AdminTopbar hides hamburger + Logout (bell wrapper also
 *     hidden via the same md:block gate).
 *   - Desktop viewport: bottom nav absent; AdminSidebar visible.
 *
 * Routes mocked so each test stays hermetic: /api/admin/notifications
 * (bar badge), /api/admin/unread-summary (per-tab dots), /api/auth/logout.
 * The broader admin dashboard surface is mocked via mockAdminDashboardApis
 * so the page renders without backend dependencies.
 */

import { bootstrapAdminSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { mockAdminDashboardApis } from "../_support/scenarios";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Next.js 16 mounts a dev-mode `<nextjs-portal>` element (the error
 * overlay / dev-tools indicator) on every page in development. It sits
 * at the very top of the stacking context and intercepts pointer
 * events on the bottom edge of the viewport — which happens to be
 * exactly where the admin bottom nav lives. The page renders fine and
 * there is no runtime error; the portal is simply always-on in dev.
 * Hide it for the test so click actionability checks don't fail.
 *
 * Injected via addInitScript so it lands before any document scripts;
 * the style tag is appended once `document.head` is available.
 */
async function hideNextDevOverlay(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addInitScript(() => {
    const css = "nextjs-portal { display: none !important; }";
    const inject = () => {
      if (!document.head) return;
      if (document.head.querySelector('style[data-test-hide-portal="1"]'))
        return;
      const style = document.createElement("style");
      style.setAttribute("data-test-hide-portal", "1");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.head) {
      inject();
    } else {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    }
  });
}

async function mockNavBackend(
  page: import("@playwright/test").Page,
  options: { unreadCount?: number } = {}
): Promise<void> {
  // Hide the always-on Next.js dev overlay first so every test that
  // calls mockNavBackend gets a portal-free DOM by default.
  await hideNextDevOverlay(page);

  const unreadCount = options.unreadCount ?? 0;
  await mockJson(page, "**/api/admin/notifications", {
    status: 200,
    body: { success: true, unreadCount, notifications: [] },
  });
  await mockJson(
    page,
    "**/api/admin/unread-summary",
    jsonOk({ unread: {} })
  );
  await mockJson(page, "**/api/admin-verify", {
    status: 200,
    body: {
      ok: true,
      admin: { name: "QA Admin", role: "admin", permissions: [] },
    },
  });
  // Endpoints touched by admin chrome that aren't covered by
  // mockAdminDashboardApis. Left unmocked they 404 through the dev
  // server; the failed responses trigger the Next.js dev error overlay
  // (<nextjs-portal>) which then intercepts pointer events on the
  // bottom nav, and on logout the still-in-flight requests get
  // aborted by the redirect — both surface as test flakes:
  //   - /api/admin/provider-stats: ProvidersTab's useCachedAdminEndpoint
  //     fires this when the section is open (defaultOpen=true on
  //     ?tab=providers). Without a mock, the unhandled error overlay
  //     covers the bar.
  //   - /api/admin/notification-preferences: NotificationPreferencesCard
  //     fetches this on mount on /admin/notifications.
  //   - /api/announcements/active: PlatformAnnouncementBanner fetches
  //     on every admin page; gets aborted by the logout-redirect race.
  await mockJson(
    page,
    "**/api/admin/provider-stats",
    jsonOk({ data: { total: 0, verified: 0, underReview: 0 } })
  );
  await mockJson(
    page,
    "**/api/admin/notification-preferences",
    jsonOk({ preferences: {} })
  );
  await mockJson(
    page,
    "**/api/announcements/active",
    jsonOk({ announcement: null })
  );
}

test.describe("Admin mobile bottom nav", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("renders 5 tabs on /admin/dashboard after session is restored", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");

    const nav = page.getByTestId("admin-bottom-nav");
    await expect(nav).toBeVisible();

    await expect(page.getByTestId("admin-bottom-nav-tab-dashboard")).toBeVisible();
    await expect(page.getByTestId("admin-bottom-nav-tab-providers")).toBeVisible();
    await expect(page.getByTestId("admin-bottom-nav-tab-kaam")).toBeVisible();
    await expect(page.getByTestId("admin-bottom-nav-tab-alerts")).toBeVisible();
    await expect(page.getByTestId("admin-bottom-nav-tab-menu")).toBeVisible();

    diag.assertClean();
  });

  test("public bottom nav does not render on /admin/*", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");

    // Public bar has aria-label="Primary"; admin bar has aria-label
    // "Admin primary". Confirm the admin bar is present AND the public
    // bar is not, using a precise selector instead of "no nav at all".
    await expect(
      page.locator('nav[aria-label="Admin primary"]')
    ).toBeVisible();
    await expect(
      page.locator('nav[aria-label="Primary"]')
    ).toHaveCount(0);

    diag.assertClean();
  });

  test("admin bottom nav does not render on /admin/login", async ({
    page,
    diag,
  }) => {
    // No session bootstrap — /admin/login is unauthenticated by design.
    await mockNavBackend(page);

    await gotoPath(page, "/admin/login");

    await expect(page.getByTestId("admin-bottom-nav")).toHaveCount(0);

    diag.assertClean();
  });

  test("Dashboard tab routes to /admin/dashboard", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    // Start at the Providers deep-link so the Dashboard tab click is a
    // real navigation. Earlier this test started at /admin/notifications,
    // but that page mounts NotificationPreferencesCard which fetches
    // /api/admin/notification-preferences — an endpoint we don't mock
    // here. The unmocked response surfaced the Next.js dev error
    // overlay (<nextjs-portal>) which intercepted pointer events on
    // the next click. Starting at /admin/dashboard?tab=providers stays
    // on the dashboard route (all its fetches are covered by
    // mockAdminDashboardApis) while still being a real "elsewhere" the
    // tab navigates away from.
    await gotoPath(page, "/admin/dashboard?tab=providers");
    await page.getByTestId("admin-bottom-nav-tab-dashboard").click();

    await expect(page).toHaveURL(/\/admin\/dashboard(?!\?)/);

    diag.assertClean();
  });

  test("Providers tab routes to ?tab=providers and ProvidersTab opens", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("admin-bottom-nav-tab-providers").click();

    await expect(page).toHaveURL(/\/admin\/dashboard\?tab=providers/);

    // ProvidersTab uses aria-controls="providers-tab-body" and exposes
    // an aria-expanded state on its toggle button. The defaultOpen prop
    // should leave the body visible after navigation.
    const providersBody = page.locator("#providers-tab-body");
    await expect(providersBody).toBeVisible();

    diag.assertClean();
  });

  test("Kaam tab routes to ?tab=kaam and KaamTab opens", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("admin-bottom-nav-tab-kaam").click();

    await expect(page).toHaveURL(/\/admin\/dashboard\?tab=kaam/);

    const kaamBody = page.locator("#kaam-tab-body");
    await expect(kaamBody).toBeVisible();

    diag.assertClean();
  });

  test("Alerts tab routes to /admin/alerts and badge reflects unread", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page, { unreadCount: 3 });
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");

    // Badge should appear once the first /api/admin/notifications poll
    // resolves. Wait for it on the nav element itself.
    const badge = page.getByTestId("admin-bottom-nav-alerts-badge");
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveText("3");

    await page.getByTestId("admin-bottom-nav-tab-alerts").click();
    await expect(page).toHaveURL(/\/admin\/alerts/);

    diag.assertClean();
  });

  test("Menu opens the admin bottom sheet and shows expected links", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");

    await page.getByTestId("admin-bottom-nav-tab-menu").click();
    await expect(page.getByTestId("admin-menu-sheet")).toBeVisible();

    await expect(page.getByTestId("admin-menu-announcements")).toBeVisible();
    await expect(page.getByTestId("admin-menu-notification-analytics")).toBeVisible();
    await expect(page.getByTestId("admin-menu-notification-settings")).toBeVisible();
    await expect(page.getByTestId("admin-menu-reports")).toBeVisible();
    await expect(page.getByTestId("admin-menu-chats")).toBeVisible();
    await expect(page.getByTestId("admin-menu-user-view")).toBeVisible();
    await expect(page.getByTestId("admin-menu-logout")).toBeVisible();

    diag.assertClean();
  });

  test("Logout from menu calls /api/auth/logout and clears kk_admin_session", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    // The bootstrap helper installs an addInitScript that re-sets
    // localStorage.kk_admin_session on EVERY page load. handleLogout
    // correctly removes the key before redirecting, but by the time
    // /login finishes loading the bootstrap script has run again and
    // the key is back. To verify the removal actually happened, install
    // a spy that records the removal moment into sessionStorage (which
    // persists across same-origin navigation). Reading sessionStorage
    // post-redirect then shows whether handleLogout fired removeItem.
    await page.addInitScript(() => {
      const win = window as unknown as { __kkRemoveSpyInstalled?: boolean };
      if (win.__kkRemoveSpyInstalled) return;
      win.__kkRemoveSpyInstalled = true;
      const storage = window.localStorage;
      const originalRemoveItem = storage.removeItem.bind(storage);
      storage.removeItem = function (key: string): void {
        if (key === "kk_admin_session") {
          try {
            window.sessionStorage.setItem("__kk_admin_session_removed", "1");
          } catch {
            // ignore — sessionStorage may be unavailable in restricted
            // contexts, but every Playwright browser supports it.
          }
        }
        return originalRemoveItem(key);
      };
    });

    let logoutCalled = false;
    await page.route("**/api/auth/logout", async (route) => {
      logoutCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoPath(page, "/admin/dashboard");

    // Sanity: bootstrap populated localStorage, and the spy hasn't
    // recorded a removal yet (handleLogout hasn't run).
    const adminSessionBefore = await page.evaluate(() =>
      window.localStorage.getItem("kk_admin_session")
    );
    expect(adminSessionBefore).not.toBeNull();
    const removedBefore = await page.evaluate(() =>
      window.sessionStorage.getItem("__kk_admin_session_removed")
    );
    expect(removedBefore).toBeNull();

    await page.getByTestId("admin-bottom-nav-tab-menu").click();
    await page.getByTestId("admin-menu-logout").click();

    // handleLogout sequence: localStorage.removeItem (spy captures it)
    // → fetch /api/auth/logout → redirectToLogin() → window.location
    // .href = "/login?next=...". Waiting for the URL transition is the
    // observable signal that the whole sequence completed.
    await page.waitForURL(/\/login(?:\?|$)/, { timeout: 5_000 });
    expect(logoutCalled).toBe(true);

    // The spy's sessionStorage flag survives the navigation, so we can
    // assert handleLogout actually removed kk_admin_session — even
    // though the bootstrap helper rehydrated localStorage on /login.
    const removedAfter = await page.evaluate(() =>
      window.sessionStorage.getItem("__kk_admin_session_removed")
    );
    expect(removedAfter).toBe("1");

    diag.assertClean();
  });

  test("mobile AdminTopbar hides hamburger + Logout button", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");

    // Hamburger aria-label "Toggle sidebar" used by the existing
    // AdminTopbar mobile path. Wrapped with `hidden md:inline-flex`,
    // so visually hidden on phone viewports.
    const hamburger = page.getByRole("button", { name: /toggle sidebar/i });
    if (await hamburger.count()) {
      await expect(hamburger.first()).toBeHidden();
    }

    // Topbar Logout button — wrapped `hidden md:inline-flex`. The Menu
    // sheet's logout button is the mobile entry point instead. A second
    // visible "Logout" button on mobile would be a regression.
    const topbarLogout = page
      .locator("header")
      .getByRole("button", { name: /^logout$/i });
    if (await topbarLogout.count()) {
      await expect(topbarLogout.first()).toBeHidden();
    }

    diag.assertClean();
  });
});

test.describe("Admin desktop layout regression", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop shows AdminSidebar and hides admin bottom nav", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockNavBackend(page);
    await mockAdminDashboardApis(page);

    await gotoPath(page, "/admin/dashboard");

    // AdminSidebar's <aside> is `hidden md:flex`; should be visible at
    // 1280px. There are multiple <aside> elements possible — scope to
    // the admin layout shell.
    await expect(page.locator("aside").first()).toBeVisible();

    // Admin bottom nav is `md:hidden` AND its useSyncExternalStore
    // viewport gate returns null at md+. Either way, the testid
    // shouldn't be in the DOM.
    await expect(page.getByTestId("admin-bottom-nav")).toHaveCount(0);

    diag.assertClean();
  });
});
