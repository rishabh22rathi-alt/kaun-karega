/**
 * Coachmark one-time-display gate.
 *
 * Both the homepage FirstVisitCoachmark and ProviderDashboardCoachmark
 * persist a "seen" flag in localStorage:
 *   - homepage:           kk_home_coachmark_seen_v1
 *   - provider dashboard: kk_provider_dashboard_coachmark_seen_v1
 *
 * This spec validates the gate on the HOMEPAGE end-to-end (no auth, no
 * backend mocks needed). Coverage for the provider dashboard is captured
 * as manual notes at the bottom of this file — the dashboard flow needs
 * a provider session + heavy /api/kk mocking and the gate logic is the
 * same try/catch + storage-key pattern in both components.
 */

import { mockCommonCatalogRoutes } from "./_support/routes";
import { gotoPath } from "./_support/home";
import { test, expect } from "./_support/test";

const HOME_KEY = "kk_home_coachmark_seen_v1";
const PROVIDER_KEY = "kk_provider_dashboard_coachmark_seen_v1";

// Same dialog `aria-label` the component sets — see FirstVisitCoachmark.tsx.
const HOME_DIALOG_LABEL = "Homepage request guide";

test.describe("Homepage coachmark — one-time display", () => {
  test.beforeEach(async ({ page }) => {
    // Keep the homepage deterministic. Storage state intentionally starts
    // empty for each test so the "first visit" path is exercised by
    // default; tests that simulate a returning visitor seed the key.
    await mockCommonCatalogRoutes(page);
  });

  test("first visit shows the coachmark", async ({ page }) => {
    await gotoPath(page, "/");
    const dialog = page.getByRole("dialog", { name: HOME_DIALOG_LABEL });
    // The component delays mount by ~700ms, so allow a generous timeout.
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test("dismiss + reload: coachmark does not show again", async ({ page }) => {
    await gotoPath(page, "/");
    const dialog = page.getByRole("dialog", { name: HOME_DIALOG_LABEL });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Skip writes the seen-flag and hides the dialog.
    await dialog.getByRole("button", { name: /^Skip$/ }).click();
    await expect(dialog).toBeHidden();

    // localStorage flag must be set.
    const stored = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      HOME_KEY
    );
    expect(stored).toBe("true");

    // Reload — gate must keep the coachmark hidden.
    await page.reload();
    await page.waitForTimeout(1_200); // past the 700ms mount delay
    await expect(
      page.getByRole("dialog", { name: HOME_DIALOG_LABEL })
    ).toHaveCount(0);
  });

  test("complete via Finish: coachmark does not show again", async ({
    page,
  }) => {
    await gotoPath(page, "/");
    const dialog = page.getByRole("dialog", { name: HOME_DIALOG_LABEL });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Step through to the last step, then click Finish. The "Got it"
    // button advances; on the last step its label flips to "Finish".
    // 4 steps → click 3× "Got it" + 1× "Finish".
    for (let i = 0; i < 3; i++) {
      await dialog.getByRole("button", { name: /^Got it$/ }).click();
    }
    await dialog.getByRole("button", { name: /^Finish$/ }).click();
    await expect(dialog).toBeHidden();

    const stored = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      HOME_KEY
    );
    expect(stored).toBe("true");

    await page.reload();
    await page.waitForTimeout(1_200);
    await expect(
      page.getByRole("dialog", { name: HOME_DIALOG_LABEL })
    ).toHaveCount(0);
  });

  test("clearing localStorage re-shows the coachmark", async ({ page }) => {
    await gotoPath(page, "/");
    const dialog = page.getByRole("dialog", { name: HOME_DIALOG_LABEL });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole("button", { name: /^Skip$/ }).click();
    await expect(dialog).toBeHidden();

    // Clear the key (simulating a fresh browser / explicit reset).
    await page.evaluate((k) => window.localStorage.removeItem(k), HOME_KEY);

    await page.reload();
    await expect(
      page.getByRole("dialog", { name: HOME_DIALOG_LABEL })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("returning visitor: pre-seeded flag suppresses coachmark on first load", async ({
    page,
  }) => {
    // Seed the seen-flag BEFORE the component mounts. addInitScript runs
    // before any page script, so the component's mount-time
    // `getItem(STORAGE_KEY) === "true"` short-circuits and never sets
    // isVisible to true.
    await page.addInitScript((k) => {
      window.localStorage.setItem(k, "true");
    }, HOME_KEY);

    await gotoPath(page, "/");
    await page.waitForTimeout(1_200);
    await expect(
      page.getByRole("dialog", { name: HOME_DIALOG_LABEL })
    ).toHaveCount(0);
  });
});

/**
 * MANUAL TEST NOTES — Provider Dashboard Coachmark
 * ------------------------------------------------
 * Same one-time-display contract as the homepage. Key:
 *   localStorage["${PROVIDER_KEY}"] === "true"  ⇒ suppressed.
 *
 * Manual repro:
 *   1. Sign in as a provider and open /provider/dashboard. Wait ~1s; the
 *      orange-ringed coachmark should appear over the profile section.
 *   2. Click Skip (or step through Next → Next → Finish). The dialog
 *      closes.
 *   3. In DevTools → Application → Local Storage, confirm a key
 *      "kk_provider_dashboard_coachmark_seen_v1" = "true".
 *   4. Reload the page. The coachmark must NOT appear again.
 *   5. Delete the key (or run
 *        localStorage.removeItem("kk_provider_dashboard_coachmark_seen_v1")
 *      in the console) and reload. The coachmark must appear once more.
 *
 * Edge cases the implementation already handles:
 *   - localStorage throws (private mode, disabled, quota): guide still
 *     shows for the session; dismiss still hides it; the flag write is
 *     swallowed by try/catch so nothing throws into the React tree.
 *   - SSR: every storage call sits inside useEffect / useCallback bodies
 *     that only run on the client.
 */
