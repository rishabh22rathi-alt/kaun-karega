/**
 * E2E AUDIT: Provider Matching + Notification Trigger Flow
 *
 * Scope: /success page — notification trigger, find-provider modal,
 *        unknown-category path, error handling, refresh behavior.
 * All dummy data uses "ZZ QA" prefix.
 * Uses route interception — no real GAS calls made, no real data written.
 *
 * Key architectural facts discovered from reading the source:
 *  - SuccessClient fires POST /api/process-task-notifications after a 3 s timer
 *    (window.setTimeout) on mount, guarded by triggerStartedRef so it fires
 *    at most once per mount.
 *  - triggerStartedRef resets on every component mount (page reload re-triggers).
 *  - notificationStatus ("queued"/"processing"/"done"/"error") is tracked in
 *    React state but is NEVER rendered to the DOM — users see no status text.
 *  - Unknown-category path redirects to /success WITHOUT taskId, so the
 *    notification useEffect skips entirely (guard: if (!taskId) return).
 *  - "Show Service Provider Numbers" button calls POST /api/find-provider
 *    independently of the notification trigger.
 *
 * Run: npx playwright test e2e/provider-matching.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ───────────────────────────────────────────────────────────────

const ZZ_TASK_ID = "TASK-ZZ-QA-003";
const ZZ_DISPLAY_ID = "ZZ-QA-003";
// digits → 003 → Number(3) → "Kaam No. 3"
const ZZ_DISPLAY_LABEL = "Kaam No. 3";
const ZZ_SERVICE = "Plumber";
const ZZ_AREA = "Sardarpura";
const ZZ_USER_PHONE = "9999999903";

// Provider used in find-provider mock
const MOCK_PROVIDER_A = {
  ProviderName: "ZZ QA Provider Alpha",
  ProviderPhone: "9888800001",
  Verified: "yes",
  OtpVerified: "yes",
  OtpVerifiedAt: "",   // blank → legacy, treated as valid by isOtpStillValid
  PendingApproval: "no",
};

// Submit flow mocks (TC-01)
const MOCK_CATEGORIES = [
  { name: "Plumber", active: "yes" },
  { name: "Electrician", active: "yes" },
];

// ─── Auth ────────────────────────────────────────────────────────────────────

function makeSessionCookieValue(phone = ZZ_USER_PHONE): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectUserCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(),
      url: "https://kaun-karega.vercel.app",
      sameSite: "Lax",
    },
  ]);
}

// ─── URL builder ─────────────────────────────────────────────────────────────

function buildSuccessUrl(opts: {
  service?: string;
  area?: string;
  taskId?: string;
  displayId?: string;
  userPhone?: string;
}): string {
  const p = new URLSearchParams();
  if (opts.service) p.set("service", opts.service);
  if (opts.area) p.set("area", opts.area);
  if (opts.taskId) p.set("taskId", opts.taskId);
  if (opts.displayId) p.set("displayId", opts.displayId);
  if (opts.userPhone) p.set("userPhone", opts.userPhone);
  return `/success?${p.toString()}`;
}

// ─── Route helpers ────────────────────────────────────────────────────────────

let notifCallCount = 0;
let notifCapturedBody: Record<string, unknown> | null = null;
let findProviderCallCount = 0;

function resetCaptures() {
  notifCallCount = 0;
  notifCapturedBody = null;
  findProviderCallCount = 0;
}

/**
 * Base mocks for the success page.
 * Override in individual tests via page.route() AFTER this call (Playwright LIFO).
 */
async function setupSuccessPageRoutes(
  page: Page,
  opts: {
    notifResponse?: object;
    notifStatus?: number;
    findProviderResponse?: object;
    findProviderStatus?: number;
  } = {}
) {
  const {
    notifResponse = { ok: true, taskId: ZZ_TASK_ID, skipped: false, matchedProviders: 1, attemptedSends: 1, failedSends: 0 },
    notifStatus = 200,
    findProviderResponse = { ok: true, count: 1, providers: [MOCK_PROVIDER_A] },
    findProviderStatus = 200,
  } = opts;

  await page.route("**/api/process-task-notifications**", async (route: Route) => {
    notifCallCount++;
    try {
      notifCapturedBody = route.request().postDataJSON() as Record<string, unknown>;
    } catch {
      notifCapturedBody = null;
    }
    await route.fulfill({
      status: notifStatus,
      contentType: "application/json",
      body: JSON.stringify(notifResponse),
    });
  });

  await page.route("**/api/find-provider**", async (route: Route) => {
    findProviderCallCount++;
    await route.fulfill({
      status: findProviderStatus,
      contentType: "application/json",
      body: JSON.stringify(findProviderResponse),
    });
  });
}

/** Submit-flow mocks for TC-01 (home page → submit → success) */
async function setupSubmitFlowRoutes(page: Page) {
  await page.route("**/api/get-categories**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ categories: MOCK_CATEGORIES }),
    });
  });

  await page.route("**/api/areas**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, areas: ["Sardarpura", "Shastri Nagar"] }),
    });
  });

  await page.route("**/api/submit-request**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }),
    });
  });

  await page.route("**/api/submit-approval-request**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Provider Matching + Notification Trigger — Full Audit", () => {
  test.beforeEach(() => {
    resetCaptures();
  });

  // ── TC-01: Submit → success page → taskId and display label propagate ────────
  // The notification trigger is verified separately in TC-02 (hard navigation).
  // TC-01 verifies the full submit path ends on the correct success URL with
  // taskId propagated, and the display label is shown correctly.
  test("TC-01: Submit via normal flow → success page shows correct task label and taskId in URL", async ({ page }) => {
    await injectUserCookie(page);
    await setupSubmitFlowRoutes(page);
    await setupSuccessPageRoutes(page);

    // Submit via home page
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const catInput = page.locator('input[placeholder*="Plumber"]');
    await expect(catInput).toBeVisible({ timeout: 10_000 });
    await catInput.fill("Plumber");
    await catInput.press("Escape");
    await catInput.press("Tab");
    await page.waitForTimeout(150);

    const timeChip = page.locator("button").filter({ hasText: /^Today$|^Tomorrow$|^This Week$/ }).first();
    await expect(timeChip).toBeVisible({ timeout: 8_000 });
    await timeChip.click();

    const areaChip = page.locator("button", { hasText: "Sardarpura" }).first();
    await expect(areaChip).toBeVisible({ timeout: 8_000 });
    await areaChip.click();

    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).toBeEnabled({ timeout: 8_000 });
    await submitBtn.click();

    // Success redirect must contain taskId and displayId from the mock response
    await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });
    await expect(page).toHaveURL(/taskId=TASK-ZZ-QA-003/);
    await expect(page).toHaveURL(/displayId=ZZ-QA-003/);

    // Success page must show the resolved display label
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // Service and area must appear in the success copy
    await expect(page.getByText(/Service: Plumber/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Area: Sardarpura/)).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-02: Notification payload carries correct taskId from URL ────────────
  test("TC-02: Notification POST body contains the exact taskId from URL params", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page);

    const successUrl = buildSuccessUrl({
      service: ZZ_SERVICE,
      area: ZZ_AREA,
      taskId: ZZ_TASK_ID,
      displayId: ZZ_DISPLAY_ID,
    });
    // Start watching BEFORE navigation so networkidle doesn't consume the event
    const notifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(successUrl);
    await notifWaiter;
    await page.waitForTimeout(300); // let async route handler increment counter

    expect(notifCallCount).toBe(1);
    expect(notifCapturedBody).not.toBeNull();
    expect(notifCapturedBody?.taskId).toBe(ZZ_TASK_ID);
  });

  // ── TC-03: Providers exist → modal shows provider name and phone ───────────
  test("TC-03: Providers matched → modal table shows provider name and phone", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page, {
      findProviderResponse: { ok: true, count: 1, providers: [MOCK_PROVIDER_A] },
    });

    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await page.waitForLoadState("networkidle");

    // Open the provider modal
    await page.click("button:has-text('Show Service Provider Numbers')");

    // Modal must show provider details
    await expect(page.getByText("ZZ QA Provider Alpha")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("9888800001")).toBeVisible({ timeout: 5_000 });
    // Verified badge: scope to tbody to avoid matching the <th> column header
    await expect(page.locator("tbody").getByText("Phone Verified")).toBeVisible({ timeout: 5_000 });

    // Exactly one find-provider call
    expect(findProviderCallCount).toBe(1);
  });

  // ── TC-04: Zero providers → modal shows graceful empty state ──────────────
  test("TC-04: No providers returned → modal shows 'No providers found' message", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page, {
      findProviderResponse: { ok: true, count: 0, providers: [] },
    });

    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await page.waitForLoadState("networkidle");

    await page.click("button:has-text('Show Service Provider Numbers')");
    await expect(
      page.getByText("No providers found for this service and area.")
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── TC-05: Notification returns 0 matched — no false status shown in UI ────
  test("TC-05: Zero matchedProviders in notification response — no 'notified' status visible in UI", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page, {
      notifResponse: { ok: true, taskId: ZZ_TASK_ID, skipped: false, matchedProviders: 0, attemptedSends: 0 },
      findProviderResponse: { ok: true, count: 0, providers: [] },
    });

    // Watch before navigation so we don't miss the notification request
    const notifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await notifWaiter;
    await page.waitForTimeout(500); // allow state update to flush

    // notificationStatus changes to "done" but is never rendered
    // No text like "notified", "done", "0 providers matched" must appear
    await expect(page.getByText(/notified|providers matched|0 match/i)).toHaveCount(0);

    // Static copy is still correct
    await expect(
      page.getByText("We are now informing nearby service providers.")
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-06: Unknown category → no taskId in URL → notification NOT called ───
  test("TC-06: Unknown-category success URL (no taskId) → /api/process-task-notifications not called", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page);

    // Approval path: success URL has service + area but NO taskId
    await page.goto(buildSuccessUrl({ service: "ZZ QA UnknownXYZ", area: ZZ_AREA }));
    await page.waitForLoadState("networkidle");

    // Wait long enough for the 3 s timer to have fired if it were going to
    await page.waitForTimeout(5_000);

    // Must NOT have called the notification endpoint at all
    expect(notifCallCount).toBe(0);

    // Page renders successfully (no crash)
    await expect(page.getByText("Task Submitted Successfully")).toBeVisible();
  });

  // ── TC-07: Notification API returns {ok:false} — page stays intact ─────────
  test("TC-07: Notification API failure → notificationStatus=error, page stays functional", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page, {
      notifStatus: 500,
      notifResponse: { ok: false, error: "ZZ QA simulated notification error" },
    });

    const notifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await notifWaiter;
    await page.waitForTimeout(500);

    // Page must still be on /success (not redirected)
    await expect(page).toHaveURL(/\/success/);

    // Notification error is SILENT — not rendered anywhere
    await expect(page.getByText("ZZ QA simulated notification error")).toHaveCount(0);

    // Core page content unaffected
    await expect(page.getByText("Task Submitted Successfully")).toBeVisible();
    await expect(page.locator("button", { hasText: "Show Service Provider Numbers" })).toBeVisible();
  });

  // ── TC-08: find-provider 502 → modal shows error message ──────────────────
  test("TC-08: /api/find-provider returns 502 → modal shows 'Unable to fetch providers' error", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page, {
      findProviderStatus: 502,
      findProviderResponse: { ok: false, error: "upstream failure" },
    });

    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await page.waitForLoadState("networkidle");

    await page.click("button:has-text('Show Service Provider Numbers')");

    // SuccessClient catch → setError("Unable to fetch providers right now. Please try again.")
    await expect(
      page.getByText("Unable to fetch providers right now. Please try again.")
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── TC-09: Page refresh → notification re-triggered (no frontend dedup) ────
  test("TC-09: Page reload re-triggers /api/process-task-notifications (triggerStartedRef resets on remount)", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page);

    const url = buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID });

    // Watch before navigation to avoid missing the request
    const firstNotifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(url);
    await firstNotifWaiter;
    await page.waitForTimeout(300); // let async route handler increment counter
    expect(notifCallCount).toBe(1);

    // Reload — triggerStartedRef resets to false on remount
    // Set up watcher BEFORE reload so we catch the re-triggered notification
    const secondNotifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.reload();
    await secondNotifWaiter;
    await page.waitForTimeout(300);
    expect(notifCallCount).toBe(2);
  });

  // ── TC-10: notificationStatus is never rendered (no skipped/done shown) ─────
  test("TC-10: notificationStatus state is never rendered in the DOM", async ({ page }) => {
    await injectUserCookie(page);
    await setupSuccessPageRoutes(page, {
      notifResponse: { ok: true, taskId: ZZ_TASK_ID, skipped: true, message: "Already processed" },
    });

    const notifWaiter = page.waitForRequest("**/api/process-task-notifications**", { timeout: 15_000 });
    await page.goto(buildSuccessUrl({ service: ZZ_SERVICE, area: ZZ_AREA, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }));
    await notifWaiter;
    await page.waitForTimeout(500);

    // None of these status strings must appear in the rendered page
    const statusTexts = ["queued", "processing", "done", "error", "skipped", "Already processed"];
    for (const txt of statusTexts) {
      await expect(page.getByText(txt, { exact: true })).toHaveCount(0);
    }

    // Display label must still be shown (it comes from URL params, not notification response)
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 5_000 });
  });
});
