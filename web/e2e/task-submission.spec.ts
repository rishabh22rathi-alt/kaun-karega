/**
 * E2E AUDIT: User Task Submission Flow
 *
 * Scope: Home page form (/), submit-request API, success page.
 * All dummy data uses "ZZ QA" prefix.
 * Uses route interception — no real GAS calls made, no real data written.
 *
 * Run: npx playwright test e2e/task-submission.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ───────────────────────────────────────────────────────────────

const ZZ_DETAILS = "ZZ QA Test task - please ignore. Automated audit.";
const ZZ_TASK_ID = "TASK-ZZ-QA-001";
const ZZ_DISPLAY_ID = "ZZ-QA-001";
// getTaskDisplayLabel extracts digits from displayId → "Kaam No. 1"
// "ZZ-QA-001" → digits "001" → Number(1) → "Kaam No. 1"
const ZZ_DISPLAY_LABEL = "Kaam No. 1";

const MOCK_CATEGORIES = [
  { name: "Electrician", active: "yes" },
  { name: "Plumber", active: "yes" },
  { name: "Carpenter", active: "yes" },
  { name: "Home Tutor", active: "yes" },
  { name: "AC Repair", active: "yes" },
  { name: "Cleaning", active: "yes" },
];

const MOCK_AREAS = ["Sardarpura", "Shastri Nagar", "Ratanada", "Basni", "Paota"];

// ─── Auth ────────────────────────────────────────────────────────────────────

function makeSessionCookieValue(phone = "9999999999"): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectUserCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

// ─── Route interception ──────────────────────────────────────────────────────

let capturedSubmitBody: Record<string, unknown> | null = null;
let capturedApprovalBody: Record<string, unknown> | null = null;
let submitCallCount = 0;
let approvalCallCount = 0;

function resetCaptures() {
  capturedSubmitBody = null;
  capturedApprovalBody = null;
  submitCallCount = 0;
  approvalCallCount = 0;
}

/**
 * Set up all base API mocks. Override individual routes in tests that need
 * different responses by calling page.route() AFTER this (Playwright LIFO).
 */
async function setupRoutes(page: Page) {
  await page.route("**/api/get-categories**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ categories: MOCK_CATEGORIES }),
    });
  });

  await page.route("**/api/areas**", async (route: Route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    const filtered = q
      ? MOCK_AREAS.filter((a) => a.toLowerCase().includes(q.toLowerCase()))
      : MOCK_AREAS;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, areas: filtered }),
    });
  });

  await page.route("**/api/submit-request**", async (route: Route) => {
    submitCallCount++;
    capturedSubmitBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }),
    });
  });

  await page.route("**/api/submit-approval-request**", async (route: Route) => {
    approvalCallCount++;
    capturedApprovalBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, result: {} }),
    });
  });

  await page.route("**/api/process-task-notifications**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, skipped: true }),
    });
  });

  await page.route("**/api/find-provider**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, providers: [] }),
    });
  });
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

async function gotoHome(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

/**
 * Type a category into the text input and blur.
 * The form accepts any typed value (canSubmit = category.trim() !== "").
 * We do NOT try to click the autocomplete dropdown to avoid matching
 * disabled carousel navigation buttons that share the bg-sky-50 class.
 */
async function fillCategory(page: Page, category: string) {
  const input = page.locator('input[placeholder*="Plumber"]');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.fill(category);
  // Press Escape to dismiss the dropdown, then Tab to blur
  await input.press("Escape");
  await input.press("Tab");
  await page.waitForTimeout(150); // React state update
}

async function selectTime(page: Page, timeLabel: string) {
  // Time chips are rendered by WhenNeedIt component — find the exact chip text
  const chip = page.locator("button", { hasText: new RegExp(`^${timeLabel}$`) }).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await chip.click();
}

async function selectAreaChip(page: Page, chipText: string) {
  // Area chips (Sardarpura, Shastri Nagar) are rendered by AreaSelection
  const chip = page.locator("button", { hasText: chipText }).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await chip.click();
}

async function fillDetails(page: Page, text: string) {
  const ta = page.locator('textarea[placeholder*="Describe"]');
  await expect(ta).toBeVisible({ timeout: 5_000 });
  await ta.fill(text);
}

async function clickSubmit(page: Page) {
  const btn = page.locator("button", { hasText: "Submit Request" });
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await expect(btn).toBeEnabled();
  await btn.click();
}

async function expectSuccessPage(page: Page) {
  await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });
  await expect(page.locator("text=Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("User Task Submission — Full Audit", () => {
  test.beforeEach(async ({ page }) => {
    resetCaptures();
    await injectUserCookie(page);
    await setupRoutes(page);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-01: Happy path — full valid submission
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-01: Valid task submission succeeds end to end", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await fillDetails(page, ZZ_DETAILS);
    await clickSubmit(page);

    await expectSuccessPage(page);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-02: Verify correct request payload — phone not in body, fields correct
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-02: Submit payload has correct fields and no phone in body", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await fillDetails(page, ZZ_DETAILS);
    await clickSubmit(page);

    await expectSuccessPage(page);

    expect(capturedSubmitBody).not.toBeNull();
    const body = capturedSubmitBody!;

    // category must be present and non-empty
    expect(typeof body.category).toBe("string");
    expect((body.category as string).trim()).not.toBe("");

    // area must include Sardarpura (normalised to title case)
    expect(typeof body.area).toBe("string");
    expect((body.area as string).toLowerCase()).toContain("sardarpura");

    // time/urgency field must be present
    const hasTime = typeof body.time === "string" || typeof body.urgency === "string";
    expect(hasTime).toBe(true);

    // phone MUST NOT be in the body (server extracts it from cookie)
    expect(body.phone).toBeUndefined();

    // details should be included
    expect(typeof body.details).toBe("string");
    expect(body.details).toContain("ZZ QA");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-03: Success page renders task display label from response
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-03: Success page renders display label (Kaam No.) from API response", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await clickSubmit(page);

    await expectSuccessPage(page);

    // The success page URL must carry taskId and displayId
    const url = page.url();
    expect(url).toContain(`taskId=${ZZ_TASK_ID}`);
    expect(url).toContain(`displayId=${encodeURIComponent(ZZ_DISPLAY_ID)}`);

    // getTaskDisplayLabel converts displayId digits → "Kaam No. 1"
    await expect(page.locator(`text=${ZZ_DISPLAY_LABEL}`)).toBeVisible({ timeout: 8_000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-04: Success redirect URL contains all expected query params
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-04: Success redirect URL contains service, area, taskId, displayId", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, "Plumber");
    await selectTime(page, "Today");
    await selectAreaChip(page, "Shastri Nagar");
    await clickSubmit(page);

    await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe("/success");
    // service param contains the submitted category
    expect(url.searchParams.get("service")).not.toBeNull();
    // area param is set
    expect(url.searchParams.get("area")).not.toBeNull();
    // taskId and displayId from the mocked API response
    expect(url.searchParams.get("taskId")).toBe(ZZ_TASK_ID);
    expect(url.searchParams.get("displayId")).toBe(ZZ_DISPLAY_ID);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-05: Submit button is disabled while request is in flight
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-05: Submit button disabled during in-flight submission", async ({ page }) => {
    // Override submit-request with a slow response (added AFTER setupRoutes = LIFO priority)
    let resolveSlowRequest!: () => void;
    const slowRequestInflight = new Promise<void>((r) => { resolveSlowRequest = r; });

    await page.route("**/api/submit-request**", async (route: Route) => {
      await new Promise<void>((res) => setTimeout(res, 2_000));
      resolveSlowRequest();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }),
      });
    });

    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await clickSubmit(page);

    // Immediately after click the button should show "Submitting..." and be disabled
    const btn = page.locator("button", { hasText: /Submitting your request/ });
    await expect(btn).toBeVisible({ timeout: 3_000 });
    await expect(btn).toBeDisabled();

    // Wait for success
    await expectSuccessPage(page);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-06: Direct navigation to /success URL (bookmark / refresh scenario)
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-06: Success page at direct URL shows task submitted confirmation", async ({ page }) => {
    const successUrl = `/success?service=Electrician&area=Sardarpura&taskId=${ZZ_TASK_ID}&displayId=${ZZ_DISPLAY_ID}`;
    await page.goto(successUrl);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });
    // Display label rendered from the URL params
    await expect(page.locator(`text=${ZZ_DISPLAY_LABEL}`)).toBeVisible({ timeout: 5_000 });
    // Navigation links present
    await expect(page.locator("text=Post another request")).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-07: Form step-gating — submit button absent without category
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-07: Submit button hidden when category is not filled", async ({ page }) => {
    await gotoHome(page);
    // Don't fill category — subsequent steps should not render (hasCategory = false)
    const step2 = page.locator("text=Step 2 · When do you need it?");
    await expect(step2).not.toBeVisible({ timeout: 3_000 });

    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-08: Form step-gating — submit button absent without area
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-08: Submit button hidden until area is selected", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    // Step 3 (area) is visible but Step 4 (submit) is hidden until area selected
    await expect(page.locator("text=Step 3 · Where do you need it?")).toBeVisible({ timeout: 8_000 });
    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).not.toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-09: Past date for "Schedule later" is rejected client-side
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-09: Past service date is rejected with an error message", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Schedule later");

    // Date input should appear after selecting "Schedule later"
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible({ timeout: 6_000 });

    // Set yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
    const dd = String(yesterday.getDate()).padStart(2, "0");
    await dateInput.fill(`${yyyy}-${mm}-${dd}`);
    await page.waitForTimeout(300);

    // Error about past date should appear
    const pastDateErr = page.locator("text=/past|future|today/i").first();
    await expect(pastDateErr).toBeVisible({ timeout: 5_000 });

    // Submit button (if rendered) should be disabled due to serviceDateError
    const submitVisible = await page.locator("button", { hasText: "Submit Request" }).isVisible();
    if (submitVisible) {
      await expect(page.locator("button", { hasText: "Submit Request" })).toBeDisabled();
    }

    // No submission request should have been made
    expect(submitCallCount).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-10: Unauthenticated user redirected to /login on submit
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-10: Unauthenticated user is redirected to /login with draft saved", async ({ page }) => {
    // Remove the cookie set in beforeEach
    await page.context().clearCookies();

    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await fillDetails(page, ZZ_DETAILS);

    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.locator("text=Verify your phone")).toBeVisible({ timeout: 5_000 });

    // No real submission should have been made
    expect(submitCallCount).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-11: Unknown category triggers approval request, not main submit
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-11: Unknown category routes to /api/submit-approval-request", async ({ page }) => {
    await gotoHome(page);

    // Type a category with zero similarity to any mock category
    const input = page.locator('input[placeholder*="Plumber"]');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.click();
    // Something completely unlike Electrician/Plumber/etc.
    await input.fill("ZZ QA Xylophone Repairman ZZZZZ");
    await input.press("Escape");
    await input.press("Tab");
    await page.waitForTimeout(200);

    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await fillDetails(page, ZZ_DETAILS);

    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Should reach success page
    await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });

    // Approval route was called, NOT the main submit
    expect(approvalCallCount).toBe(1);
    expect(submitCallCount).toBe(0);

    // rawCategoryInput in the approval payload should be the typed value
    expect(capturedApprovalBody).not.toBeNull();
    expect(String(capturedApprovalBody!.rawCategoryInput)).toContain("ZZ QA");

    // Success page should show task submitted (no taskId = no Kaam No. badge)
    await expect(page.locator("text=Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-12: API failure shows error in UI, no redirect to /success
  // ─────────────────────────────────────────────────────────────────────────
  test("TC-12: API failure shows error and keeps user on home page", async ({ page }) => {
    // Override submit-request to return failure (LIFO = runs before base mock)
    await page.route("**/api/submit-request**", async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Apps Script returned failure." }),
      });
    });

    await gotoHome(page);
    await fillCategory(page, "Electrician");
    await selectTime(page, "Right now");
    await selectAreaChip(page, "Sardarpura");
    await fillDetails(page, ZZ_DETAILS);
    await clickSubmit(page);

    // Must NOT navigate to /success
    // Give it time to receive the error response and render it
    await page.waitForTimeout(2_000);
    expect(page.url()).not.toMatch(/\/success/);

    // Error text should appear
    const errText = page.locator("text=/Apps Script returned failure|Non-200 response|Something went wrong|ok=false/i");
    await expect(errText.first()).toBeVisible({ timeout: 8_000 });

    // Submit button should be re-enabled after error
    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).toBeVisible({ timeout: 3_000 });
    await expect(submitBtn).toBeEnabled();
  });
});
