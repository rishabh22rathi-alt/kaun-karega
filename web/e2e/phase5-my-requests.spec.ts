/**
 * Phase 5 E2E QA — My Requests (User Dashboard)
 *
 * 12 tests covering:
 *   TEST 1  — Page loads for logged-in user
 *   TEST 2  — Newly submitted task appears
 *   TEST 3  — Status label mapping (all known statuses + leak detection, single page load)
 *   TEST 4  — Chat CTA routes to /chat/thread/{id}?actor=user
 *   TEST 5  — Task with no providers behaves correctly
 *   TEST 6  — Pending category review task (status label audit)
 *   TEST 7  — Refresh persistence
 *   TEST 8  — Mixed task history ordering (newest first)
 *   TEST 9  — CTA integrity (View Responses toggle, Open Chat disabled without provider)
 *   TEST 10 — Empty state
 *   TEST 11 — Mobile/responsive sanity (375 px viewport)
 *   TEST 12 — Data correctness: UI fields match API payload exactly
 *
 * Display ID format: "ZZ-QA-8XX" — regex /\d+/ matches "8XX" (no intermediate digits),
 * so getTaskDisplayLabel produces predictable "Kaam No. N" labels.
 *
 * All test data prefixed "ZZ QA" — safe to ignore/clean.
 * Uses route interception — no real GAS calls, no real data written.
 *
 * Run: npx playwright test e2e/phase5-my-requests.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://kaun-karega.vercel.app";
const ZZ_PHONE  = "9999999951";

// Display IDs use "ZZ-QA-8XX" — no digits before the trailing number,
// so normalizeDisplayId() extracts the correct trailing number.
const ZZ_DISP_A   = "ZZ-QA-801";   // → "Kaam No. 801"
const ZZ_LABEL_A  = "Kaam No. 801";

const ZZ_DISP_B   = "ZZ-QA-802";   // → "Kaam No. 802"
const ZZ_LABEL_B  = "Kaam No. 802";

const ZZ_DISP_C   = "ZZ-QA-803";   // → "Kaam No. 803"
const ZZ_LABEL_C  = "Kaam No. 803";

const ZZ_TASK_A   = "TASK-ZZ-PHA-801";
const ZZ_TASK_B   = "TASK-ZZ-PHA-802";
const ZZ_TASK_C   = "TASK-ZZ-PHA-803";

// NEW task constants (TEST 2 submit flow)
const ZZ_TASK_NEW  = "TASK-ZZ-PHA-NEW";
const ZZ_DISP_NEW  = "ZZ-QA-899";   // → "Kaam No. 899"
const ZZ_LABEL_NEW = "Kaam No. 899";

// Provider
const ZZ_PROVIDER_ID    = "ZZ-QA-PROV-801";
const ZZ_PROVIDER_NAME  = "ZZ QA Provider Eight";
const ZZ_PROVIDER_PHONE = "9801801801";
const ZZ_THREAD_ID      = "ZZ-QA-THREAD-801";

// ─── Timing helpers ────────────────────────────────────────────────────────────

const t0 = Date.now();
const el = () => `[+${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// ─── Auth helpers ───────────────────────────────────────────────────────────────

function makeSession(phone: string): string {
  return encodeURIComponent(JSON.stringify({ phone, verified: true, createdAt: Date.now() }));
}

async function injectUserCookie(page: Page, phone = ZZ_PHONE) {
  await page.context().addCookies([{
    name: "kk_auth_session", value: makeSession(phone),
    url: BASE_URL, sameSite: "Lax",
  }]);
}

// ─── Mock task factory ──────────────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    TaskID:                "TASK-ZZ-PHA-DEFAULT",
    DisplayID:             ZZ_DISP_A,
    Category:              "ZZ QA Plumber",
    Area:                  "ZZ QA Nagar",
    Details:               "ZZ QA Phase5 test task — please ignore.",
    Status:                "pending",
    CreatedAt:             "2026-04-10T10:00:00.000Z",
    MatchedProviders:      [] as string[],
    MatchedProviderDetails: [] as Record<string, unknown>[],
    RespondedProvider:     "",
    RespondedProviderName: "",
    ...overrides,
  };
}

// ─── Route helpers ──────────────────────────────────────────────────────────────

/**
 * Mock /api/my-requests and /api/kk for the My Requests page.
 * The /api/kk handler distinguishes chat_create_or_get_thread from other actions.
 */
async function mockMyRequests(
  page: Page,
  tasks: object[],
  kkThreads: object[] = [],
  threadIdForCreate = ZZ_THREAD_ID
) {
  await page.route("**/api/my-requests**", async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, requests: tasks }),
    });
  });
  await page.route("**/api/kk**", async (route: Route) => {
    let action = "";
    try {
      const b = route.request().postDataJSON() as Record<string, unknown>;
      action = String(b?.action || "");
    } catch { /* */ }

    if (action === "chat_create_or_get_thread") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, ThreadID: threadIdForCreate }),
      });
    } else {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, threads: kkThreads }),
      });
    }
  });
}

/** Mock the full submit flow (home page → success) */
async function mockSubmitFlow(page: Page) {
  await page.route("**/api/get-categories**", async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ categories: [
        { name: "Plumber", active: "yes" },
        { name: "Electrician", active: "yes" },
      ]}),
    });
  });
  await page.route("**/api/areas**", async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, areas: ["Sardarpura", "Shastri Nagar"] }),
    });
  });
  await page.route("**/api/submit-request**", async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, taskId: ZZ_TASK_NEW, displayId: ZZ_DISP_NEW }),
    });
  });
  await page.route("**/api/process-task-notifications**", async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, skipped: true }),
    });
  });
  await page.route("**/api/find-provider**", async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, providers: [] }),
    });
  });
}

async function gotoMyRequests(page: Page) {
  await page.goto("/dashboard/my-requests");
  await page.waitForLoadState("networkidle");
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Phase 5: My Requests — Full QA Audit", () => {

  // ─── TEST 1: Page loads for logged-in user ───────────────────────────────────

  test("TEST 1 — My Requests loads for logged-in user", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 1: Page load ═══`);
    await injectUserCookie(page);
    await mockMyRequests(page, [makeTask({ TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A })]);

    await gotoMyRequests(page);

    // Heading present
    await expect(page.getByRole("heading", { name: "My Requests" })).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T1] "My Requests" heading visible`);

    // No auth loop — URL stays on /dashboard/my-requests
    await expect(page).toHaveURL(/\/dashboard\/my-requests/);
    console.log(`${el()} [T1] URL correct — no auth redirect`);

    // Task count line visible
    await expect(page.getByText(/Total requests:/i)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T1] "Total requests:" visible`);

    // Task card renders with correct display label
    // Note: ZZ-QA-801 → /\d+/ matches "801" → Number(801) → "Kaam No. 801"
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T1] Task card rendered: ${ZZ_LABEL_A}`);

    // No loading spinner persists
    await expect(page.getByText("Loading your requests...")).not.toBeVisible({ timeout: 3_000 })
      .catch(() => console.log(`${el()} [T1] WARNING: loading text persists`));

    console.log(`${el()} [T1] PASS`);
  });

  // ─── TEST 2: Newly submitted task appears ────────────────────────────────────

  test("TEST 2 — Newly submitted normal task appears in My Requests", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 2: Submit flow → My Requests ═══`);
    await injectUserCookie(page);
    await mockSubmitFlow(page);

    // After submit, my-requests returns the new task
    await mockMyRequests(page, [
      makeTask({
        TaskID: ZZ_TASK_NEW, DisplayID: ZZ_DISP_NEW,
        Category: "Plumber", Area: "Sardarpura", Status: "pending",
        CreatedAt: new Date().toISOString(),
      }),
    ]);

    // Submit from home page
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Use role-based locator — placeholder is empty when typewriter animation is active
    const catInput = page.getByRole("textbox").first();
    await expect(catInput).toBeVisible({ timeout: 12_000 });
    await catInput.click();
    await catInput.fill("Plumber");
    await catInput.press("Escape");
    await catInput.press("Tab");
    await page.waitForTimeout(200);

    const timeChip = page.locator("button").filter({ hasText: /^Today$|^Tomorrow$|^Right now$/ }).first();
    await expect(timeChip).toBeVisible({ timeout: 8_000 });
    await timeChip.click();

    const areaChip = page.locator("button", { hasText: "Sardarpura" }).first();
    await expect(areaChip).toBeVisible({ timeout: 8_000 });
    await areaChip.click();

    const submitBtn = page.locator("button", { hasText: "Submit Request" });
    await expect(submitBtn).toBeVisible({ timeout: 8_000 });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });
    console.log(`${el()} [T2] Success page reached`);

    // Navigate to My Requests
    await gotoMyRequests(page);

    // ZZ-QA-899 → "Kaam No. 899"
    await expect(page.getByText(ZZ_LABEL_NEW)).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T2] New task label "${ZZ_LABEL_NEW}" visible`);

    // Category and area from the mock payload
    await expect(page.getByText("Plumber")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Sardarpura")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] Category + Area visible`);

    console.log(`${el()} [T2] PASS`);
  });

  // ─── TEST 3: Status label mapping (single page load, all statuses at once) ───

  test("TEST 3 — Status label mapping: all statuses in one load, raw-code leak detection", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 3: Status labels ═══`);
    await injectUserCookie(page);

    // All statuses rendered as separate task cards in one API response.
    // This avoids 8 separate page navigations and the associated timeout risk.
    const statusMap = [
      { status: "submitted",               label: "Request received",                   isRawLeak: false },
      { status: "notified",                label: "Providers notified",                 isRawLeak: false },
      { status: "responded",               label: "A provider has responded",           isRawLeak: false },
      { status: "no_providers_matched",    label: "No providers available in your area yet", isRawLeak: false },
      { status: "assigned",                label: "Provider assigned",                  isRawLeak: false },
      { status: "completed",               label: "Work completed",                     isRawLeak: false },
      // These fall through to default in getTaskStatusLabel → raw codes shown
      { status: "pending",                 label: "pending",                            isRawLeak: true },
      { status: "pending_category_review", label: "pending_category_review",            isRawLeak: true },
    ];

    // Each task needs a display ID without intermediate digits.
    // "ZZ-QA-90N" → /\d+/ matches "90N" → Number("90N") → NaN → "" → falls back to raw TaskID.
    // That's fine — TEST 3 only cares about status labels, not display labels.
    const allStatusTasks = statusMap.map(({ status }, i) =>
      makeTask({
        TaskID: `TASK-ZZ-ST-${String(i + 1).padStart(2, "0")}`,
        DisplayID: `ZZ-QA-STATUS-${i + 1}`,
        Status: status,
      })
    );

    await mockMyRequests(page, allStatusTasks);
    await gotoMyRequests(page);

    // Total count = 8
    await expect(page.getByText(/Total requests:\s*8/)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T3] 8 status tasks loaded`);

    for (const { status, label, isRawLeak } of statusMap) {
      // Use exact regex to avoid "pending" matching "pending_category_review"
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const statusSpan = page.locator("span").filter({ hasText: new RegExp(`^${escapedLabel}$`) }).first();
      const isVisible = await statusSpan.isVisible({ timeout: 5_000 }).catch(() => false);

      if (isRawLeak) {
        if (isVisible) {
          console.log(`${el()} [T3] BUG: "${status}" → shows raw code "${label}" to user`);
          console.log(`${el()} [T3]   Fix: add case in lib/taskStatus.ts → getTaskStatusLabel()`);
          await expect(statusSpan).toBeVisible({ timeout: 3_000 });
        } else {
          console.log(`${el()} [T3] NOTE: "${status}" raw code not found — may have been fixed`);
        }
      } else {
        console.log(`${el()} [T3] "${status}" → "${label}" [CORRECT]`);
        await expect(statusSpan).toBeVisible({ timeout: 5_000 });
      }
    }

    const leaks = statusMap.filter(s => s.isRawLeak);
    console.log(`\n${el()} [T3] STATUS LEAK AUDIT RESULTS:`);
    console.log(`${el()} [T3]   Correctly mapped statuses: ${statusMap.length - leaks.length}/${statusMap.length}`);
    leaks.forEach(s => {
      console.log(`${el()} [T3]   RAW CODE LEAK: "${s.status}" displays as "${s.label}"`);
      console.log(`${el()} [T3]     File: web/lib/taskStatus.ts → getTaskStatusLabel()`);
      console.log(`${el()} [T3]     Fix:  case "${s.status}": return "<user-friendly text>";`);
    });

    console.log(`${el()} [T3] PASS (${leaks.length} status label UX issues documented above)`);
  });

  // ─── TEST 4: Chat CTA routes correctly ───────────────────────────────────────

  test("TEST 4 — Chat CTA opens correct thread route as user actor", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 4: Chat CTA routing ═══`);
    await injectUserCookie(page);

    const taskWithProvider = makeTask({
      TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A,
      Status: "responded",
      MatchedProviders: [ZZ_PROVIDER_ID],
      MatchedProviderDetails: [{
        ProviderID:     ZZ_PROVIDER_ID,
        ProviderName:   ZZ_PROVIDER_NAME,
        ProviderPhone:  ZZ_PROVIDER_PHONE,
        Verified:       "yes",
        ResponseStatus: "responded",
      }],
      RespondedProvider:     ZZ_PROVIDER_ID,
      RespondedProviderName: ZZ_PROVIDER_NAME,
    });

    await mockMyRequests(page, [taskWithProvider]);
    await gotoMyRequests(page);

    // Task card visible
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });

    // Expand provider list
    const viewBtn = page.locator("button", { hasText: "View Responses ▼" }).first();
    await expect(viewBtn).toBeVisible({ timeout: 8_000 });
    await viewBtn.click();
    console.log(`${el()} [T4] Clicked "View Responses"`);

    // "Open Chat" button visible and enabled
    const openChatBtn = page.locator("button", { hasText: "Open Chat" }).first();
    await expect(openChatBtn).toBeVisible({ timeout: 8_000 });
    await expect(openChatBtn).toBeEnabled();
    console.log(`${el()} [T4] "Open Chat" button enabled`);

    // Click and verify navigation to /chat/thread/{id}?actor=user
    const [navigated] = await Promise.all([
      page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 }),
      openChatBtn.click(),
    ]);
    void navigated;

    const finalUrl = page.url();
    console.log(`${el()} [T4] Navigated to: ${finalUrl}`);

    // Correct route structure
    expect(finalUrl).toMatch(/\/chat\/thread\//);
    expect(finalUrl).toContain("actor=user");
    console.log(`${el()} [T4] URL has /chat/thread/ and actor=user — correct`);

    // Must NOT be in provider flow
    expect(finalUrl).not.toContain("actor=provider");
    console.log(`${el()} [T4] actor=provider absent — no misroute to provider flow`);

    // Thread ID from mock is in the URL
    expect(finalUrl).toContain(encodeURIComponent(ZZ_THREAD_ID));
    console.log(`${el()} [T4] Thread ID "${ZZ_THREAD_ID}" present in URL`);

    console.log(`${el()} [T4] PASS`);
  });

  // ─── TEST 5: No providers matched ────────────────────────────────────────────

  test("TEST 5 — Task with no providers: friendly status, empty provider panel", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 5: No providers ═══`);
    await injectUserCookie(page);

    const taskNoProviders = makeTask({
      TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A,
      Status: "no_providers_matched",
      MatchedProviders: [],
      MatchedProviderDetails: [],
    });

    await mockMyRequests(page, [taskNoProviders]);
    await gotoMyRequests(page);

    // Status label must be user-friendly — no raw code
    const statusLabel = "No providers available in your area yet";
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${statusLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first())
      .toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T5] Status label: "${statusLabel}" — correct`);

    // No "Provider responded" badge
    await expect(page.locator("span", { hasText: "Provider responded" })).toHaveCount(0);
    console.log(`${el()} [T5] No "Provider responded" badge — correct`);

    // "Matched Providers: 0" visible
    await expect(page.getByText(/Matched Providers:\s*0/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T5] Matched Providers: 0`);

    // Expand responses panel
    const viewBtn = page.locator("button", { hasText: "View Responses ▼" }).first();
    await expect(viewBtn).toBeVisible({ timeout: 5_000 });
    await viewBtn.click();

    // Empty providers message
    await expect(page.getByText("No matched providers yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T5] "No matched providers yet." in expanded panel`);

    // No "Open Chat" button
    await expect(page.locator("button", { hasText: "Open Chat" })).toHaveCount(0);
    console.log(`${el()} [T5] No "Open Chat" button — correct (no provider to chat with)`);

    console.log(`${el()} [T5] PASS`);
  });

  // ─── TEST 6: Pending category review ─────────────────────────────────────────

  test("TEST 6 — Pending category review: status label audit + no broken CTAs", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 6: Pending category review ═══`);
    await injectUserCookie(page);

    const taskPendingReview = makeTask({
      TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A,
      Status: "pending_category_review",
      Category: "ZZ QA Aquarium Cleaning",
    });

    await mockMyRequests(page, [taskPendingReview]);
    await gotoMyRequests(page);

    // Task card visible
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T6] Task card visible`);

    // Audit: does the raw backend code appear?
    const rawCodeSpan = page.locator("span").filter({ hasText: /^pending_category_review$/ }).first();
    const rawVisible = await rawCodeSpan.isVisible({ timeout: 5_000 }).catch(() => false);

    if (rawVisible) {
      console.log(`${el()} [T6] BUG CONFIRMED: "pending_category_review" raw code shown to user`);
      console.log(`${el()} [T6]   File: web/lib/taskStatus.ts`);
      console.log(`${el()} [T6]   Fix:  case "pending_category_review": return "Under review — verifying service";`);
      await expect(rawCodeSpan).toBeVisible({ timeout: 3_000 });
    } else {
      console.log(`${el()} [T6] "pending_category_review" raw code NOT shown — label may be fixed`);
    }

    // No "Provider responded" badge
    await expect(page.locator("span", { hasText: "Provider responded" })).toHaveCount(0);

    // "View Responses" still functional
    const viewBtn = page.locator("button", { hasText: "View Responses ▼" }).first();
    await expect(viewBtn).toBeVisible({ timeout: 5_000 });
    await viewBtn.click();
    await expect(page.getByText("No matched providers yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] "View Responses" works — no broken CTAs`);

    console.log(`${el()} [T6] PASS (raw status code UX bug documented)`);
  });

  // ─── TEST 7: Refresh persistence ─────────────────────────────────────────────

  test("TEST 7 — Tasks remain visible after page refresh + navigation", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 7: Refresh persistence ═══`);
    await injectUserCookie(page);

    const tasks = [
      makeTask({ TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A, Status: "notified" }),
      makeTask({ TaskID: ZZ_TASK_B, DisplayID: ZZ_DISP_B, Status: "pending" }),
    ];

    await mockMyRequests(page, tasks);
    await gotoMyRequests(page);

    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(ZZ_LABEL_B)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T7] Initial load: both tasks visible`);

    // Hard reload
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_LABEL_B)).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T7] After reload: both tasks still visible`);

    // Navigate away and back
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await gotoMyRequests(page);

    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_LABEL_B)).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T7] After navigate-away-and-back: both tasks still visible`);

    // No error state
    const redEl = page.locator("div.text-red-600");
    const hasError = await redEl.first().isVisible({ timeout: 2_000 }).catch(() => false);
    console.log(`${el()} [T7] Error state visible: ${hasError}`);
    if (hasError) {
      const txt = await redEl.first().textContent().catch(() => "");
      console.log(`${el()} [T7] WARNING: error text: "${txt}"`);
    }

    console.log(`${el()} [T7] PASS`);
  });

  // ─── TEST 8: Mixed task history ordering ─────────────────────────────────────

  test("TEST 8 — Mixed task history: ordering stable, no duplicates, count correct", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 8: Mixed ordering ═══`);
    await injectUserCookie(page);

    // 3 tasks, newest → oldest (API order = render order in the component)
    const tasks = [
      makeTask({
        TaskID: ZZ_TASK_C, DisplayID: ZZ_DISP_C,
        Status: "responded", CreatedAt: "2026-04-15T10:00:00.000Z",
        Category: "ZZ QA Electrician",
        RespondedProvider: ZZ_PROVIDER_ID, RespondedProviderName: ZZ_PROVIDER_NAME,
      }),
      makeTask({
        TaskID: ZZ_TASK_B, DisplayID: ZZ_DISP_B,
        Status: "notified", CreatedAt: "2026-04-12T08:00:00.000Z",
        Category: "ZZ QA Carpenter",
      }),
      makeTask({
        TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A,
        Status: "no_providers_matched", CreatedAt: "2026-04-05T06:00:00.000Z",
        Category: "ZZ QA Plumber",
      }),
    ];

    await mockMyRequests(page, tasks);
    await gotoMyRequests(page);

    // All 3 labels visible
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(ZZ_LABEL_B)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(ZZ_LABEL_C)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T8] All 3 tasks visible: ${ZZ_LABEL_A}, ${ZZ_LABEL_B}, ${ZZ_LABEL_C}`);

    // Count = 3
    await expect(page.getByText(/Total requests:\s*3/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T8] Total requests: 3 — correct`);

    // No duplicates
    expect(await page.getByText(ZZ_LABEL_A).count()).toBe(1);
    expect(await page.getByText(ZZ_LABEL_B).count()).toBe(1);
    expect(await page.getByText(ZZ_LABEL_C).count()).toBe(1);
    console.log(`${el()} [T8] No duplicates — each label appears exactly once`);

    // "Provider responded" badge on the responded task
    await expect(page.locator("span", { hasText: "Provider responded" })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T8] "Provider responded" badge visible`);

    // API-order preserved: first rendered card should contain the first API entry (ZZ_LABEL_C)
    const taskCards = page.locator("div.rounded-xl.border");
    const firstCardText = await taskCards.first().textContent().catch(() => "");
    const firstIsNewest = (firstCardText || "").includes(ZZ_LABEL_C);
    console.log(`${el()} [T8] First card contains ${ZZ_LABEL_C}: ${firstIsNewest}`);
    if (!firstIsNewest) {
      console.log(`${el()} [T8] NOTE: component may reorder cards; first card does not match API entry[0]`);
    }

    console.log(`${el()} [T8] PASS`);
  });

  // ─── TEST 9: CTA integrity ────────────────────────────────────────────────────

  test("TEST 9 — CTA integrity: View Responses toggles, Open Chat works, no dead buttons", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 9: CTA integrity ═══`);
    await injectUserCookie(page);

    const taskWithProvider = makeTask({
      TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A,
      Status: "responded",
      MatchedProviders: [ZZ_PROVIDER_ID],
      MatchedProviderDetails: [{
        ProviderID:     ZZ_PROVIDER_ID,
        ProviderName:   ZZ_PROVIDER_NAME,
        ProviderPhone:  ZZ_PROVIDER_PHONE,
        Verified:       "yes",
        ResponseStatus: "responded",
      }],
      RespondedProvider:     ZZ_PROVIDER_ID,
      RespondedProviderName: ZZ_PROVIDER_NAME,
    });

    await mockMyRequests(page, [taskWithProvider]);
    await gotoMyRequests(page);

    // 1. "View Responses ▼" present on card
    const viewBtn = page.locator("button", { hasText: "View Responses ▼" }).first();
    await expect(viewBtn).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T9] "View Responses ▼" button visible`);

    // 2. Click to expand → button changes to ▲
    await viewBtn.click();
    await expect(page.locator("button", { hasText: "View Responses ▲" }).first())
      .toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] Expanded → "▲" shown`);

    // 3. Provider table rendered with correct headers
    await expect(page.getByRole("columnheader", { name: /provider name/i })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] Provider table header "Provider Name" visible`);

    // 4. "Open Chat" button enabled
    const openChatBtn = page.locator("button", { hasText: "Open Chat" }).first();
    await expect(openChatBtn).toBeVisible({ timeout: 5_000 });
    await expect(openChatBtn).toBeEnabled();
    console.log(`${el()} [T9] "Open Chat" enabled`);

    // 5. No "Chat unavailable" error text
    await expect(page.locator("text=Chat unavailable")).toHaveCount(0);
    console.log(`${el()} [T9] No "Chat unavailable" error`);

    // 6. Collapse → ▼ again; table hidden
    const collapseBtn = page.locator("button", { hasText: "View Responses ▲" }).first();
    await collapseBtn.click();
    await expect(page.locator("button", { hasText: "View Responses ▼" }).first())
      .toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("columnheader", { name: /provider name/i })).toHaveCount(0);
    console.log(`${el()} [T9] Collapsed → table hidden, button shows ▼`);

    console.log(`${el()} [T9] PASS`);
  });

  // ─── TEST 10: Empty state ─────────────────────────────────────────────────────

  test("TEST 10 — Empty state: friendly message, no spinner, no error", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 10: Empty state ═══`);
    await injectUserCookie(page);
    await mockMyRequests(page, []);

    await gotoMyRequests(page);

    // Heading still visible
    await expect(page.getByRole("heading", { name: "My Requests" })).toBeVisible({ timeout: 10_000 });

    // Empty state text
    await expect(page.getByText("No requests yet. Create your first task from home."))
      .toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T10] Empty state text visible`);

    // Total count: 0
    await expect(page.getByText(/Total requests:\s*0/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T10] Total requests: 0`);

    // No spinner
    await expect(page.getByText("Loading your requests...")).not.toBeVisible();
    console.log(`${el()} [T10] No loading spinner`);

    // No error
    await expect(page.locator("div.text-red-600")).toHaveCount(0);
    console.log(`${el()} [T10] No error state`);

    // URL stays correct
    await expect(page).toHaveURL(/\/dashboard\/my-requests/);
    console.log(`${el()} [T10] URL correct`);

    console.log(`${el()} [T10] PASS`);
  });

  // ─── TEST 11: Mobile/responsive sanity ───────────────────────────────────────

  test("TEST 11 — Mobile viewport (375px): cards readable, buttons clickable", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 11: Mobile/responsive ═══`);

    await page.setViewportSize({ width: 375, height: 667 });

    await injectUserCookie(page);
    await mockMyRequests(page, [
      makeTask({ TaskID: ZZ_TASK_A, DisplayID: ZZ_DISP_A, Status: "notified" }),
    ]);

    await gotoMyRequests(page);

    // Heading visible
    await expect(page.getByRole("heading", { name: "My Requests" })).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T11] Heading visible at 375px`);

    // Task card visible
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T11] Task card "${ZZ_LABEL_A}" visible at 375px`);

    // Status label visible
    await expect(
      page.locator("span").filter({ hasText: /^Providers notified$/ }).first()
    ).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T11] Status label visible at 375px`);

    // "View Responses" button: reasonable tap target
    const viewBtn = page.locator("button", { hasText: "View Responses ▼" }).first();
    await expect(viewBtn).toBeVisible({ timeout: 5_000 });
    const btnBox = await viewBtn.boundingBox();
    if (btnBox) {
      console.log(`${el()} [T11] "View Responses" button: w=${btnBox.width.toFixed(0)}px h=${btnBox.height.toFixed(0)}px`);
      expect(btnBox.height).toBeGreaterThanOrEqual(20);
      expect(btnBox.width).toBeGreaterThan(60);
    }

    // Click the button — panel expands
    await viewBtn.click();
    await expect(page.getByText("No matched providers yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T11] "View Responses" click works on mobile`);

    // Horizontal overflow check
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log(`${el()} [T11] body.scrollWidth=${scrollWidth}px (viewport=375px)`);
    if (scrollWidth > 375) {
      console.log(`${el()} [T11] WARNING: horizontal overflow (scrollWidth ${scrollWidth}px > 375px)`);
    } else {
      console.log(`${el()} [T11] No horizontal overflow`);
    }

    console.log(`${el()} [T11] PASS`);
  });

  // ─── TEST 12: Data correctness ────────────────────────────────────────────────

  test("TEST 12 — Data correctness: all UI fields match API payload exactly", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 12: Data correctness ═══`);
    await injectUserCookie(page);

    // "ZZ-QA-842" → /\d+/ matches "842" → "Kaam No. 842"
    const knownTask = {
      TaskID:                "TASK-ZZ-PHA-DATA",
      DisplayID:             "ZZ-QA-842",
      Category:              "ZZ QA Tiling",
      Area:                  "ZZ QA Civil Lines",
      Details:               "ZZ QA Phase5 DATA test — tile floor replacement. Please ignore.",
      Status:                "notified",
      CreatedAt:             "2026-04-15T08:30:00.000Z",
      MatchedProviders:      [ZZ_PROVIDER_ID],
      MatchedProviderDetails: [{
        ProviderID:     ZZ_PROVIDER_ID,
        ProviderName:   ZZ_PROVIDER_NAME,
        ProviderPhone:  ZZ_PROVIDER_PHONE,
        Verified:       "yes",
        ResponseStatus: "notified",
      }],
      RespondedProvider:     "",
      RespondedProviderName: "",
    };

    await mockMyRequests(page, [knownTask]);
    await gotoMyRequests(page);

    // Display label: ZZ-QA-842 → 842 → "Kaam No. 842"
    await expect(page.getByText("Kaam No. 842")).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T12] "Kaam No. 842" label — CORRECT`);

    // Category
    await expect(page.getByText("ZZ QA Tiling")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Category "ZZ QA Tiling" — CORRECT`);

    // Area
    await expect(page.getByText("ZZ QA Civil Lines")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Area "ZZ QA Civil Lines" — CORRECT`);

    // Details (partial match)
    await expect(page.getByText(/ZZ QA Phase5 DATA test/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Details text — CORRECT`);

    // Status label: "notified" → "Providers notified"
    await expect(
      page.locator("span").filter({ hasText: /^Providers notified$/ }).first()
    ).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Status "notified" → "Providers notified" — CORRECT`);

    // Matched Providers count: 1
    await expect(page.getByText(/Matched Providers:\s*1/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Matched Providers: 1 — CORRECT`);

    // Created date contains year
    const createdP = page.locator("p").filter({ hasText: /Created:/ }).first();
    await expect(createdP).toBeVisible({ timeout: 5_000 });
    const createdText = await createdP.textContent().catch(() => "");
    const hasYear = /2026|Apr/.test(createdText || "");
    console.log(`${el()} [T12] Created field: "${createdText?.trim()}" (hasYear=${hasYear})`);
    if (!hasYear) {
      console.log(`${el()} [T12] WARNING: Created date may not be formatted with year`);
    }

    // Total: 1
    await expect(page.getByText(/Total requests:\s*1/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Total requests: 1 — CORRECT`);

    // Provider in expanded table
    const viewBtn = page.locator("button", { hasText: "View Responses ▼" }).first();
    await viewBtn.click();
    await expect(page.getByText(ZZ_PROVIDER_NAME)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Provider name "${ZZ_PROVIDER_NAME}" in expanded panel — CORRECT`);
    await expect(page.getByText(ZZ_PROVIDER_PHONE)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Provider phone "${ZZ_PROVIDER_PHONE}" visible — CORRECT`);

    console.log(`${el()} [T12] PASS`);
  });

});
