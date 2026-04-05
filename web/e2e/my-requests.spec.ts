/**
 * E2E AUDIT: My Requests Flow
 *
 * Scope: /dashboard/my-requests — list visibility, field rendering, auth guards,
 *        empty state, refresh stability, error handling.
 * All dummy data uses "ZZ QA" prefix.
 * Uses route interception — no real GAS calls made, no real data written.
 *
 * Run: npx playwright test e2e/my-requests.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ───────────────────────────────────────────────────────────────

const ZZ_TASK_ID = "TASK-ZZ-QA-002";
const ZZ_DISPLAY_ID = "ZZ-QA-002";
// getTaskDisplayLabel: digits from "ZZ-QA-002" → "002" → Number(2) → "Kaam No. 2"
const ZZ_DISPLAY_LABEL = "Kaam No. 2";
const ZZ_CATEGORY = "ZZ QA Plumber";
const ZZ_AREA = "ZZ QA Nagar";
const ZZ_STATUS = "pending";
const ZZ_CREATED_AT = "2026-04-05T10:00:00.000Z";
const ZZ_DETAILS = "ZZ QA Test task - my-requests audit. Please ignore.";

// ─── Mock data ───────────────────────────────────────────────────────────────

const MOCK_REQUEST = {
  TaskID: ZZ_TASK_ID,
  DisplayID: ZZ_DISPLAY_ID,
  Category: ZZ_CATEGORY,
  Area: ZZ_AREA,
  Details: ZZ_DETAILS,
  Status: ZZ_STATUS,
  CreatedAt: ZZ_CREATED_AT,
  MatchedProviders: [],
  MatchedProviderDetails: [],
  RespondedProvider: "",
  RespondedProviderName: "",
};

// Submit-flow mocks
const MOCK_CATEGORIES = [
  { name: "Plumber", active: "yes" },
  { name: "Electrician", active: "yes" },
];
const MOCK_AREAS_LIST = ["Sardarpura", "Shastri Nagar", "Ratanada"];

// ─── Auth ────────────────────────────────────────────────────────────────────

const ZZ_PHONE = "9999999902";

function makeSessionCookieValue(phone = ZZ_PHONE): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectUserCookie(page: Page, phone = ZZ_PHONE) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(phone),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

// ─── Route helpers ───────────────────────────────────────────────────────────

/**
 * Mock /api/my-requests to return a single ZZ QA task.
 * Also mock /api/kk (chat_get_threads) so the component doesn't throw.
 */
async function setupMyRequestsRoutes(
  page: Page,
  opts: {
    requests?: object[];
    myRequestsStatus?: number;
    myRequestsBody?: object;
    kkOk?: boolean;
  } = {}
) {
  const {
    requests = [MOCK_REQUEST],
    myRequestsStatus = 200,
    myRequestsBody,
    kkOk = true,
  } = opts;

  const responseBody =
    myRequestsBody ?? { ok: true, requests };

  await page.route("**/api/my-requests**", async (route: Route) => {
    await route.fulfill({
      status: myRequestsStatus,
      contentType: "application/json",
      body: JSON.stringify(
        myRequestsStatus === 401
          ? { ok: false, error: "Unauthorized" }
          : responseBody
      ),
    });
  });

  await page.route("**/api/kk**", async (route: Route) => {
    if (kkOk) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, threads: [] }),
      });
    } else {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "ZZ QA simulated chat error" }),
      });
    }
  });
}

/** Submit-flow mocks (home page → success page) */
async function setupSubmitFlowRoutes(page: Page) {
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
      ? MOCK_AREAS_LIST.filter((a) => a.toLowerCase().includes(q.toLowerCase()))
      : MOCK_AREAS_LIST;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, areas: filtered }),
    });
  });

  await page.route("**/api/submit-request**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, taskId: ZZ_TASK_ID, displayId: ZZ_DISPLAY_ID }),
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

async function gotoMyRequests(page: Page) {
  await page.goto("/dashboard/my-requests");
  await page.waitForLoadState("networkidle");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("My Requests — Full Audit", () => {
  // ── TC-01: After submit, task appears in My Requests ─────────────────────
  test("TC-01: Submitted task appears in My Requests", async ({ page }) => {
    await injectUserCookie(page);
    await setupSubmitFlowRoutes(page);
    await setupMyRequestsRoutes(page);

    // Step 1: Submit via home page form
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Fill category
    const catInput = page.locator('input[placeholder*="Plumber"]');
    await expect(catInput).toBeVisible({ timeout: 10_000 });
    await catInput.fill("Plumber");
    await catInput.press("Escape");
    await catInput.press("Tab");
    await page.waitForTimeout(150);

    // Select time chip (first available)
    const timeChip = page.locator("button").filter({ hasText: /^Today$|^Tomorrow$|^This Week$/ }).first();
    await expect(timeChip).toBeVisible({ timeout: 8_000 });
    await timeChip.click();

    // Select area chip (Sardarpura)
    const areaChip = page.locator("button", { hasText: "Sardarpura" }).first();
    await expect(areaChip).toBeVisible({ timeout: 8_000 });
    await areaChip.click();

    // Submit
    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).toBeVisible({ timeout: 8_000 });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Wait for success page
    await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });

    // Step 2: Navigate to My Requests
    await gotoMyRequests(page);

    // Step 3: Task must appear — raw TaskID is not rendered; component shows displayLabel
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
  });

  // ── TC-02: Category, area, status render correctly ────────────────────────
  test("TC-02: Task card renders category, area, and status correctly", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page);
    await gotoMyRequests(page);

    // Category
    await expect(page.getByText(ZZ_CATEGORY)).toBeVisible({ timeout: 10_000 });
    // Area
    await expect(page.getByText(ZZ_AREA)).toBeVisible({ timeout: 5_000 });
    // Status badge (normalizeRequest puts it inside a span)
    await expect(page.getByText(ZZ_STATUS)).toBeVisible({ timeout: 5_000 });
    // Display label
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-03: Task remains visible after page refresh ────────────────────────
  test("TC-03: Task remains visible after page refresh", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page);
    await gotoMyRequests(page);

    // Confirm it's there before refresh — raw TaskID not rendered; assert by displayLabel
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // Reload (mocks persist across reload in Playwright)
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Must still be there
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
  });

  // ── TC-04: No duplicate rows ──────────────────────────────────────────────
  test("TC-04: No duplicate rows for a single task", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, { requests: [MOCK_REQUEST] });
    await gotoMyRequests(page);

    // Raw TaskID not rendered; assert by displayLabel
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // Count task cards — exactly one card should render for a single task
    // Card key: taskId-createdAt-area; scope by area text which IS rendered
    const cards = page.locator("div.rounded-xl").filter({ hasText: ZZ_AREA });
    await expect(cards).toHaveCount(1, { timeout: 5_000 });
  });

  // ── TC-05: Display label renders as "Kaam No. N" ─────────────────────────
  test("TC-05: Display label renders as Kaam No. from displayId", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page);
    await gotoMyRequests(page);

    // The label "Kaam No. 2" must appear (not raw "ZZ-QA-002")
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
    // Raw displayId must NOT appear as visible text label in the Kaam row
    const rawIdText = page.locator("p", { hasText: /^ZZ-QA-002$/ });
    await expect(rawIdText).toHaveCount(0);
  });

  // ── TC-06: Direct navigation to /dashboard/my-requests works ─────────────
  test("TC-06: Direct URL navigation to My Requests renders task list", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page);

    // Navigate directly — no prior page visit
    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    // Use role=heading to avoid matching sidebar nav link (strict mode)
    await expect(page.getByRole("heading", { name: "My Requests" })).toBeVisible({ timeout: 10_000 });
    // Raw TaskID not rendered; assert by displayLabel
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
  });

  // ── TC-07: Unauthenticated user (no cookie) redirected to /login ──────────
  test("TC-07: No session cookie — DashboardLayout redirects to /login", async ({ page }) => {
    // No injectUserCookie — no session
    // No API mock needed because DashboardLayout redirects before fetch

    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    // DashboardLayout reads document.cookie, finds no session → router.replace("/login")
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  // ── TC-08: Session cookie present but API returns 401 → /login ────────────
  test("TC-08: /api/my-requests 401 redirects to /login", async ({ page }) => {
    await injectUserCookie(page);
    // Return 401 from /api/my-requests but let /api/kk succeed
    await setupMyRequestsRoutes(page, { myRequestsStatus: 401 });

    await gotoMyRequests(page);

    // MyRequestsList checks res.status === 401 → router.replace("/login")
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  // ── TC-09: Empty state — no requests ─────────────────────────────────────
  test("TC-09: Empty state renders 'No requests yet' when list is empty", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, { requests: [] });

    await gotoMyRequests(page);

    await expect(
      page.getByText("No requests yet. Create your first task from home.")
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── TC-10: Backend 500 shows error, stays on page ─────────────────────────
  test("TC-10: Backend 500 shows error message and keeps user on page", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, {
      myRequestsBody: { ok: false, error: "ZZ QA simulated server error" },
    });

    await gotoMyRequests(page);

    // Component: setError(data?.error || "Failed to load requests")
    await expect(page.getByText("ZZ QA simulated server error")).toBeVisible({ timeout: 10_000 });
    // Must stay on /dashboard/my-requests (not redirect)
    await expect(page).toHaveURL(/\/dashboard\/my-requests/);
  });
});
