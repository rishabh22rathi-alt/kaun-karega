/**
 * PWA Phase 2 — Install UI behavior.
 *
 * Covers the InstallAppPromptCard (rendered on high-intent surfaces)
 * and the InstallAppMenuRow (rendered inside the Admin menu sheet —
 * public-bar menu open is flaky in this dev environment per existing
 * admin spec notes; admin variant exercises the same component).
 *
 * Browser install behavior is simulated:
 *   - Android: dispatch a synthetic `beforeinstallprompt` event with
 *     a mocked `prompt()` + `userChoice` so the hook captures it.
 *   - iOS Safari: set the iPhone Safari User-Agent for the describe
 *     block; hook's UA-sniff detects iOS and surfaces the manual
 *     instructions path.
 *   - Installed: addInitScript writes `kk_pwa_installed = "yes"` to
 *     localStorage before the page hydrates, so the hook's init
 *     reads it and short-circuits all install UI.
 *
 * Storage keys covered:
 *   - kk_pwa_installed (permanent install flag)
 *   - kk_pwa_install_dismissed_at (7-day cooldown timestamp)
 *
 * The public bottom-nav Menu button is intentionally NOT exercised
 * here — see `e2e/notifications/alerts-vs-settings-split.spec.ts`
 * for the documented Playwright/React state-update race on that
 * button. AdminMenuSheet uses a stable testid and works.
 */

import { bootstrapAdminSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { mockAdminDashboardApis } from "../_support/scenarios";
import { jsonOk, mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

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

/**
 * Public layout mounts SessionGuardMount → pings /api/auth/whoami on
 * every page load. Without a mock, the request 401s and the
 * diagnostics layer flags the console error. Returning a healthy
 * response here keeps the probe quiet without affecting any other
 * behavior under test.
 */
async function mockSessionGuard(
  page: import("@playwright/test").Page
): Promise<void> {
  await mockJson(page, "**/api/auth/whoami", jsonOk({ phone: "9999999999" }));
}

/**
 * Combined setup so individual tests don't repeat the boilerplate.
 * Tests that call diag.assertClean must also call
 * `allowWhoamiNoise(diag)` because the mockJson route handler races
 * with the SessionGuardMount probe in some scenarios — the harmless
 * 401 console line slips through before the route is bound.
 */
async function setupPwa(
  page: import("@playwright/test").Page
): Promise<void> {
  await hideNextDevOverlay(page);
  await mockSessionGuard(page);
}

function allowWhoamiNoise(
  diag: { allowConsoleError: (p: RegExp) => void; allowHttpError: (p: RegExp) => void }
): void {
  // Browser-emitted console line — the URL is in `location`, not in
  // the text. Pattern targets the text content.
  diag.allowConsoleError(/Failed to load resource.*401/);
  diag.allowHttpError(/whoami/);
}

/**
 * Dispatch a synthetic beforeinstallprompt event so the hook captures
 * a usable deferred prompt. The mocked prompt() resolves immediately
 * and userChoice resolves to "accepted" by default — callers can
 * override via `userChoice` if needed.
 */
async function dispatchBeforeInstallPrompt(
  page: import("@playwright/test").Page,
  outcome: "accepted" | "dismissed" = "accepted"
): Promise<void> {
  // Wait for the page bundle (including usePwaInstall) to finish
  // loading so the module-level beforeinstallprompt listener is
  // attached before we dispatch. Without this wait, the dispatch
  // races with chunk loading and gets lost.
  await page.waitForLoadState("load");
  // Poll until the hook has installed its listener. The hook sets
  // a marker on window so tests can synchronise — see
  // `lib/usePwaInstall.ts` `__kkPwaInstallReady` flag.
  await page.waitForFunction(
    () =>
      (window as unknown as { __kkPwaInstallReady?: boolean })
        .__kkPwaInstallReady === true,
    null,
    { timeout: 10_000 }
  );
  await page.evaluate((choice) => {
    const evt = new Event("beforeinstallprompt", {
      cancelable: true,
    }) as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    evt.prompt = () => {
      (window as unknown as { __kkPromptCalled?: boolean }).__kkPromptCalled =
        true;
      return Promise.resolve();
    };
    evt.userChoice = Promise.resolve({
      outcome: choice,
    }) as Promise<{ outcome: "accepted" | "dismissed" }>;
    window.dispatchEvent(evt);
  }, outcome);
}

// ─────────────────────────────────────────────────────────────────────
//  Android / Chromium — InstallAppPromptCard on /provider/register/success
// ─────────────────────────────────────────────────────────────────────

test.describe("PWA install card — Android", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("card hidden until beforeinstallprompt is captured", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    // No event dispatched yet → not supported on Android → card hidden.
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);
    diag.assertClean();
  });

  test("card appears after beforeinstallprompt fires", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page);
    await expect(page.getByTestId("pwa-install-prompt-card")).toBeVisible();
    await expect(
      page.getByTestId("pwa-install-prompt-card-install")
    ).toBeVisible();
    await expect(
      page.getByTestId("pwa-install-prompt-card-not-now")
    ).toBeVisible();
    diag.assertClean();
  });

  test("install button calls deferred prompt()", async ({ page, diag }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page, "dismissed");
    await page.getByTestId("pwa-install-prompt-card-install").click();
    // The hook awaits userChoice; after dismissed, canPromptAndroid
    // flips false → card unmounts. Wait for that to confirm prompt()
    // ran (synthetic prompt() flags __kkPromptCalled).
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);
    const called = await page.evaluate(
      () => (window as unknown as { __kkPromptCalled?: boolean }).__kkPromptCalled
    );
    expect(called).toBe(true);
    diag.assertClean();
  });

  test("'Not now' hides card and writes 7-day cooldown", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page);
    await expect(page.getByTestId("pwa-install-prompt-card")).toBeVisible();
    await page.getByTestId("pwa-install-prompt-card-not-now").click();
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);

    const dismissedAt = await page.evaluate(() =>
      window.localStorage.getItem("kk_pwa_install_dismissed_at")
    );
    expect(dismissedAt).not.toBeNull();
    const ts = Number(dismissedAt);
    expect(Number.isFinite(ts)).toBe(true);
    // Recent (within last minute).
    expect(Date.now() - ts).toBeLessThan(60_000);
    diag.assertClean();
  });

  test("appinstalled fires → kk_pwa_installed flag + card hidden", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page);
    await expect(page.getByTestId("pwa-install-prompt-card")).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);

    const installed = await page.evaluate(() =>
      window.localStorage.getItem("kk_pwa_installed")
    );
    expect(installed).toBe("yes");
    diag.assertClean();
  });
});

// ─────────────────────────────────────────────────────────────────────
//  iOS Safari — InstallAppPromptCard + instructions sheet
// ─────────────────────────────────────────────────────────────────────

test.describe("PWA install card — iOS Safari", () => {
  test.use({ viewport: MOBILE_VIEWPORT, userAgent: IOS_SAFARI_UA });

  test("card appears with iOS Safari UA (no beforeinstallprompt required)", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    // iOS path: hook detects isIosSafari=true regardless of any
    // beforeinstallprompt (which Safari doesn't fire).
    await expect(page.getByTestId("pwa-install-prompt-card")).toBeVisible();
    diag.assertClean();
  });

  test("install button opens iOS instructions sheet", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    await page.getByTestId("pwa-install-prompt-card-install").click();
    await expect(page.getByTestId("ios-install-instructions")).toBeVisible();
    diag.assertClean();
  });

  test("instructions sheet 'Got it' closes it; card stays visible", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await gotoPath(page, "/provider/register/success");
    await page.getByTestId("pwa-install-prompt-card-install").click();
    await expect(page.getByTestId("ios-install-instructions")).toBeVisible();
    await page.getByTestId("ios-install-instructions-close").click();
    await expect(page.getByTestId("ios-install-instructions")).toHaveCount(0);
    // Card remains visible — closing the instructions sheet is NOT
    // a dismissal; user may need to refer back to the steps.
    await expect(page.getByTestId("pwa-install-prompt-card")).toBeVisible();
    diag.assertClean();
  });

  test("navigator.standalone === true hides everything", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", {
        value: true,
        configurable: true,
      });
    });
    await gotoPath(page, "/provider/register/success");
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);
    // The usePwaInstall chunk is lazy-loaded (server-component page
    // referencing a client component); wait for init() to actually
    // run before asserting its side-effects.
    await page.waitForLoadState("load");
    await page.waitForFunction(
      () =>
        (window as unknown as { __kkPwaInstallReady?: boolean })
          .__kkPwaInstallReady === true,
      null,
      { timeout: 10_000 }
    );
    // Side-effect: the hook detects standalone on init → persists the
    // permanent flag so cleared localStorage on a future visit still
    // hides install UI as long as standalone mode is observed.
    const installed = await page.evaluate(() =>
      window.localStorage.getItem("kk_pwa_installed")
    );
    expect(installed).toBe("yes");
    diag.assertClean();
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Installed state — hide everything everywhere
// ─────────────────────────────────────────────────────────────────────

test.describe("PWA install UI — installed state hides everything", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("kk_pwa_installed flag hides the prompt card", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await page.addInitScript(() => {
      window.localStorage.setItem("kk_pwa_installed", "yes");
    });
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page);
    // Even with beforeinstallprompt captured, installed-state wins.
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);
    diag.assertClean();
  });

  test("dismissed within 7 days hides the prompt card", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "kk_pwa_install_dismissed_at",
        String(Date.now() - 60_000)
      );
    });
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page);
    await expect(page.getByTestId("pwa-install-prompt-card")).toHaveCount(0);
    diag.assertClean();
  });

  test("dismissed >7 days ago lets the card reappear", async ({
    page,
    diag,
  }) => {
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await page.addInitScript(() => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      window.localStorage.setItem(
        "kk_pwa_install_dismissed_at",
        String(eightDaysAgo)
      );
    });
    await gotoPath(page, "/provider/register/success");
    await dispatchBeforeInstallPrompt(page);
    await expect(page.getByTestId("pwa-install-prompt-card")).toBeVisible();
    diag.assertClean();
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Admin Menu install row — uses stable testid path
// ─────────────────────────────────────────────────────────────────────

test.describe("PWA install menu row — Admin Menu Sheet", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("install row appears in AdminMenuSheet when supported", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await mockAdminDashboardApis(page);
    await mockJson(page, "**/api/admin/notifications", {
      status: 200,
      body: { success: true, unreadCount: 0, notifications: [] },
    });
    await mockJson(page, "**/api/admin/unread-summary", jsonOk({ unread: {} }));
    await mockJson(page, "**/api/admin-verify", {
      status: 200,
      body: {
        ok: true,
        admin: { name: "QA Admin", role: "admin", permissions: [] },
      },
    });
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

    await gotoPath(page, "/admin/dashboard");
    await dispatchBeforeInstallPrompt(page);

    await page.getByTestId("admin-bottom-nav-tab-menu").click();
    await expect(page.getByTestId("admin-menu-sheet")).toBeVisible();

    const installRow = page.getByTestId("pwa-install-menu-row");
    await expect(installRow).toBeVisible();
    await expect(installRow).toContainText(/install kaun karega/i);
    diag.assertClean();
  });

  test("install row hidden when already installed", async ({ page, diag }) => {
    await bootstrapAdminSession(page);
    await setupPwa(page);
    allowWhoamiNoise(diag);
    await mockAdminDashboardApis(page);
    await mockJson(page, "**/api/admin/notifications", {
      status: 200,
      body: { success: true, unreadCount: 0, notifications: [] },
    });
    await mockJson(page, "**/api/admin/unread-summary", jsonOk({ unread: {} }));
    await mockJson(page, "**/api/admin-verify", {
      status: 200,
      body: {
        ok: true,
        admin: { name: "QA Admin", role: "admin", permissions: [] },
      },
    });
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
    await page.addInitScript(() => {
      window.localStorage.setItem("kk_pwa_installed", "yes");
    });

    await gotoPath(page, "/admin/dashboard");
    await dispatchBeforeInstallPrompt(page);

    await page.getByTestId("admin-bottom-nav-tab-menu").click();
    await expect(page.getByTestId("admin-menu-sheet")).toBeVisible();
    await expect(page.getByTestId("pwa-install-menu-row")).toHaveCount(0);
    diag.assertClean();
  });
});
