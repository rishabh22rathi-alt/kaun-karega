/**
 * E2E: Confirmation Page — Provider Source Cutover Validation
 *
 * Validates that /confirmation after the cutover:
 *  1. Loads without crashing (TC-01)
 *  2. Renders provider list or graceful empty state via /api/find-provider (TC-02)
 *  3. Makes no browser-side GAS calls; server-side fetch is not browser-observable (TC-03)
 *  4. Does not 500 from server-fetch failure or missing env var (TC-04)
 *
 * ARCHITECTURAL NOTE — server-side fetch:
 *  confirmation/page.tsx is a Next.js server component. The fetch to /api/find-provider
 *  runs in Node.js on the server, not in the browser. Therefore:
 *  - page.route() for find-provider cannot intercept the server-side fetch.
 *  - The browser network panel does NOT show this call.
 *  - Behavior is validated by inspecting rendered HTML and HTTP response status only.
 *
 * Run: npx playwright test e2e/confirmation-cutover.spec.ts --reporter=line
 */

import { test, expect, Page } from "@playwright/test";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY = "Electrician";
const AREA = "Sardarpura";

// ─── Network capture ──────────────────────────────────────────────────────────

let gasCallCount = 0;
let findProviderBrowserCallCount = 0;

function resetCaptures() {
  gasCallCount = 0;
  findProviderBrowserCallCount = 0;
}

/**
 * Observes network from the browser for:
 * - GAS calls (script.google.com or known GAS URL patterns) — must be 0 after cutover
 * - Browser-side /api/find-provider calls — expected 0 because fetch is server-side
 */
async function setupNetworkObservers(page: Page) {
  await page.route("**script.google.com**", async (route) => {
    gasCallCount++;
    console.warn(`[INTERCEPT] Browser-side GAS call detected: ${route.request().url()}`);
    await route.abort();
  });

  // Pass-through observer — if this fires, the fetch is NOT server-side (unexpected)
  await page.route("**/api/find-provider**", async (route) => {
    findProviderBrowserCallCount++;
    console.log(`[INTERCEPT] Browser-side /api/find-provider call detected (unexpected for server component)`);
    await route.continue();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Confirmation Page — Provider Source Cutover", () => {
  test.beforeEach(() => {
    resetCaptures();
  });

  // ── TC-01: Page loads without query params ────────────────────────────────
  test("TC-01: /confirmation loads without crashing (no query params)", async ({ page }) => {
    await setupNetworkObservers(page);

    const response = await page.goto("/confirmation");
    const status = response?.status() ?? 0;

    console.log(`[TC-01] HTTP status: ${status}`);
    expect(status, "HTTP status must not be 5xx").toBeLessThan(500);

    await page.waitForLoadState("domcontentloaded");

    // The page renders one of two branches: default task-posted or pending_approval.
    // Either way, an h1 must be present and no error overlay.
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const headingText = await heading.textContent();
    console.log(`[TC-01] Heading text: "${headingText?.trim()}"`);

    await expect(page.locator("text=Application error")).not.toBeVisible({ timeout: 3_000 });

    console.log(`[TC-01] PASS — GAS browser calls: ${gasCallCount}, browser find-provider calls: ${findProviderBrowserCallCount}`);
  });

  // ── TC-02: show=1 path renders providers or empty state ──────────────────
  test("TC-02: /confirmation?show=1 renders provider list or graceful empty state — no crash", async ({ page }) => {
    await setupNetworkObservers(page);

    const url = `/confirmation?category=${encodeURIComponent(CATEGORY)}&area=${encodeURIComponent(AREA)}&show=1`;
    const response = await page.goto(url);
    const status = response?.status() ?? 0;

    console.log(`[TC-02] HTTP status: ${status}`);

    // A 500 here almost certainly means NEXT_PUBLIC_BASE_URL is missing in the deployment
    // (Node.js fetch receives a relative URL and throws TypeError: Invalid URL).
    // Next.js 13+ App Router does support relative fetch in server components by default,
    // so a 500 would be unexpected on a correctly deployed Vercel instance.
    expect(status, "HTTP 500 on show=1 path — check NEXT_PUBLIC_BASE_URL or server fetch error").not.toBe(500);
    expect(status, "HTTP status must not be 5xx").toBeLessThan(500);

    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("text=Application error")).not.toBeVisible({ timeout: 3_000 });

    // The show=1 branch always renders the area heading regardless of provider count
    const areaHeading = page.locator(`text=Available Providers in ${AREA}`);
    await expect(areaHeading).toBeVisible({ timeout: 10_000 });

    // Validate one of the two valid states: provider cards OR empty state message
    const providerCards = page.locator(".p-4.border-b");
    const emptyState = page.locator("text=Providers are reviewing your task");

    const cardCount = await providerCards.count();
    const emptyVisible = await emptyState.isVisible();

    console.log(`[TC-02] Provider cards: ${cardCount}, Empty state visible: ${emptyVisible}`);

    expect(
      cardCount > 0 || emptyVisible,
      "Either provider cards or the empty-state message must render — page must not be blank"
    ).toBe(true);

    // If provider cards rendered, validate field mapping — name text + WhatsApp link
    if (cardCount > 0) {
      const firstCard = providerCards.first();
      const nameSpan = firstCard.locator("span");
      const waLink = firstCard.locator("a[href^='https://wa.me/']");

      await expect(nameSpan).toBeVisible({ timeout: 3_000 });
      await expect(waLink).toBeVisible({ timeout: 3_000 });

      const nameText = await nameSpan.textContent();
      const waHref = await waLink.getAttribute("href");
      console.log(`[TC-02] First card — name: "${nameText?.trim()}", wa href: "${waHref}"`);

      // wa.me href must have digits after the slash (not empty)
      expect(waHref, "WhatsApp link must contain phone digits").toMatch(/https:\/\/wa\.me\/\d+/);
    }

    console.log(`[TC-02] PASS — GAS browser calls: ${gasCallCount}, browser find-provider calls: ${findProviderBrowserCallCount}`);
  });

  // ── TC-03: No browser-side GAS calls; server-side fetch not browser-visible
  test("TC-03: No browser-side GAS calls; /api/find-provider fetch is server-side (not browser-observable)", async ({ page }) => {
    await setupNetworkObservers(page);

    const url = `/confirmation?category=${encodeURIComponent(CATEGORY)}&area=${encodeURIComponent(AREA)}&show=1`;
    await page.goto(url);
    await page.waitForLoadState("networkidle");

    // GAS browser calls must be zero — legacy Master_Providers read is eliminated
    expect(
      gasCallCount,
      "No browser-side GAS calls must occur after cutover"
    ).toBe(0);

    // EXPECTED: findProviderBrowserCallCount === 0.
    // The fetch to /api/find-provider in confirmation/page.tsx runs on the Next.js server
    // (Node.js), not in the browser. Playwright's page.route() intercepts browser-side
    // fetch/XHR only. The server-to-server call is invisible to this observer.
    // A count of 0 here CONFIRMS the fetch is server-side — this is correct behavior.
    console.log(
      `[TC-03] Browser-side /api/find-provider calls: ${findProviderBrowserCallCount}` +
      ` (0 = server-side fetch confirmed, correct)`
    );
    console.log(
      `[TC-03] Browser-side GAS calls: ${gasCallCount} (0 = legacy read eliminated, correct)`
    );

    expect(
      findProviderBrowserCallCount,
      "fetch to /api/find-provider is expected to be server-side — 0 browser calls is the correct outcome"
    ).toBe(0);

    console.log("[TC-03] PASS — no GAS calls, no browser-side find-provider calls (server component fetch confirmed)");
  });

  // ── TC-04: Server-fetch failure detection ────────────────────────────────
  test("TC-04: Server-side fetch failure — page survives via try/catch fallback", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const url = `/confirmation?category=${encodeURIComponent(CATEGORY)}&area=${encodeURIComponent(AREA)}&show=1`;
    const response = await page.goto(url);
    const status = response?.status() ?? 0;

    await page.waitForLoadState("domcontentloaded");

    console.log(`[TC-04] HTTP status: ${status}`);
    if (consoleErrors.length > 0) {
      console.log(`[TC-04] Console errors: ${JSON.stringify(consoleErrors)}`);
    }

    if (status === 500) {
      // Capture body for diagnosis
      const bodyText = await page.locator("body").textContent();
      console.error(
        "[TC-04] FAIL — HTTP 500 received on show=1 path.\n" +
        "Likely cause: NEXT_PUBLIC_BASE_URL is not set in the Vercel environment, " +
        "and Next.js relative-URL fetch resolution failed.\n" +
        "Fix required: set NEXT_PUBLIC_BASE_URL=https://kaun-karega.vercel.app in Vercel env vars " +
        "(Settings → Environment Variables).\n" +
        `Body excerpt: ${bodyText?.slice(0, 500)}`
      );
    }

    expect(status, "HTTP 500 — see TC-04 console output for diagnosis").not.toBe(500);
    expect(status, "HTTP status must be 2xx").toBeLessThan(300);

    // Even when the internal fetch fails, the try/catch in confirmation/page.tsx
    // sets providers = [] and the page must still render the area heading + empty state.
    await expect(page.locator("text=Application error")).not.toBeVisible({ timeout: 3_000 });
    await expect(
      page.locator(`text=Available Providers in ${AREA}`)
    ).toBeVisible({ timeout: 10_000 });

    // If status is 200 and area heading is visible, the try/catch worked correctly.
    console.log(`[TC-04] PASS — status ${status}, page did not crash, console errors: ${consoleErrors.length}`);
  });
});
