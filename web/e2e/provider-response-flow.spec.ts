/**
 * E2E AUDIT: Provider Response Flow — End-to-End
 *
 * Scope: Provider dashboard → chat initiation → user my-requests → admin view.
 * All dummy data uses "ZZ QA" prefix.
 * Uses route interception — no real GAS calls made, no real data written.
 *
 * Key architectural facts discovered from reading the source:
 *  - Provider dashboard at /provider/dashboard fetches GET /api/provider/dashboard-profile.
 *  - Profile response includes Analytics.RecentMatchedRequests (capped at 6 in UI).
 *  - Each matched request card shows: display label, category, area, Responded/Accepted badges,
 *    and an "Open Chat" button.
 *  - "Open Chat" fires handleOpenChat → POST /api/kk action=chat_create_or_get_thread
 *    (ActorType: "provider", TaskID, loggedInProviderPhone).
 *  - If data.created === true → also POST /api/kk action=chat_send_message with
 *    PROVIDER_AUTO_START_MESSAGE ("Yes, mai karunga ye kaam") before navigating.
 *  - Navigation target: /chat/thread/{threadId} (no actor param for provider).
 *  - Provider polling: POST /api/kk action=chat_get_threads every 18 s. We don't test
 *    this directly — just verify initial fetch shape.
 *  - User my-requests: GET /api/my-requests returns requests with MatchedProviderDetails
 *    and RespondedProvider. "Provider responded" badge appears when respondedProvider truthy.
 *  - User "View Responses ▼" expands matched providers table with "Open Chat" per provider.
 *  - User chat thread: POST /api/kk action=chat_create_or_get_thread (ActorType: "user")
 *    → navigates to /chat/thread/{threadId}?actor=user.
 *  - Admin dashboard: requires kk_auth_session + kk_admin=1 cookies and
 *    localStorage kk_admin_session. Uses GET /api/admin/stats + POST /api/kk by action.
 *
 * Run: npx playwright test e2e/provider-response-flow.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ────────────────────────────────────────────────────────────────

const ZZ_TASK_ID = "TASK-ZZ-QA-005";
const ZZ_DISPLAY_ID = "ZZ-QA-005";
// getTaskDisplayLabel: "ZZ-QA-005" → digits "005" → Number(5) → "Kaam No. 5"
const ZZ_DISPLAY_LABEL = "Kaam No. 5";
const ZZ_CATEGORY = "Electrician";
const ZZ_AREA = "Sardarpura";
const ZZ_DETAILS = "ZZ QA provider flow test — please ignore. Automated audit.";
const ZZ_CREATED_AT = "2026-04-07T10:00:00.000Z";

const ZZ_PROVIDER_ID = "ZZ-PROV-QA-005";
const ZZ_PROVIDER_NAME = "ZZ QA Provider Five";
const ZZ_PROVIDER_PHONE = "9876543205";

const ZZ_USER_PHONE = "9999999905";

const ZZ_THREAD_ID = "ZZ-THREAD-QA-005";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function makeSessionCookieValue(phone: string): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectProviderCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(ZZ_PROVIDER_PHONE),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

async function injectUserCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(ZZ_USER_PHONE),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

async function injectAdminCookies(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue("9999999904"),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
    {
      name: "kk_admin",
      value: "1",
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem(
      "kk_admin_session",
      JSON.stringify({ isAdmin: true, name: "ZZ QA Admin", role: "admin", permissions: [] })
    );
  });
}

// ─── Mock data ────────────────────────────────────────────────────────────────

function makeMatchedRequest(overrides: Partial<{
  Responded: boolean;
  Accepted: boolean;
  ThreadID: string;
}> = {}) {
  return {
    TaskID: ZZ_TASK_ID,
    DisplayID: ZZ_DISPLAY_ID,
    Category: ZZ_CATEGORY,
    Area: ZZ_AREA,
    Details: ZZ_DETAILS,
    CreatedAt: ZZ_CREATED_AT,
    Responded: false,
    Accepted: false,
    ThreadID: "",
    ...overrides,
  };
}

function makeProviderProfile(overrides: {
  metricsOverrides?: Record<string, number>;
  matchedRequest?: ReturnType<typeof makeMatchedRequest> | null;
} = {}) {
  const { metricsOverrides = {}, matchedRequest = makeMatchedRequest() } = overrides;
  return {
    ok: true,
    provider: {
      ProviderID: ZZ_PROVIDER_ID,
      ProviderName: ZZ_PROVIDER_NAME,
      Phone: ZZ_PROVIDER_PHONE,
      Verified: "yes",
      OtpVerified: "yes",
      OtpVerifiedAt: "",
      PendingApproval: "no",
      Status: "Active",
      Services: [{ Category: ZZ_CATEGORY }],
      Areas: [{ Area: ZZ_AREA }],
      Analytics: {
        Summary: {
          ProviderID: ZZ_PROVIDER_ID,
          Categories: [ZZ_CATEGORY],
          Areas: [ZZ_AREA],
        },
        Metrics: {
          TotalRequestsInMyCategories: 10,
          TotalRequestsMatchedToMe: 5,
          TotalRequestsRespondedByMe: metricsOverrides.TotalRequestsRespondedByMe ?? 2,
          TotalRequestsAcceptedByMe: 1,
          TotalRequestsCompletedByMe: 0,
          ResponseRate: metricsOverrides.ResponseRate ?? 40,
          AcceptanceRate: 20,
        },
        AreaDemand: [{ AreaName: ZZ_AREA, RequestCount: 3 }],
        SelectedAreaDemand: [{ AreaName: ZZ_AREA, RequestCount: 3, IsSelectedByProvider: true }],
        CategoryDemandByRange: {
          today: [{ CategoryName: ZZ_CATEGORY, RequestCount: 3 }],
        },
        RecentMatchedRequests: matchedRequest ? [matchedRequest] : [],
      },
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: ZZ_AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    },
  };
}

function makeUserRequest(overrides: {
  respondedProvider?: string;
  respondedProviderName?: string;
  status?: string;
  matchedProviderDetails?: unknown[];
} = {}) {
  return {
    TaskID: ZZ_TASK_ID,
    DisplayID: ZZ_DISPLAY_ID,
    Category: ZZ_CATEGORY,
    Area: ZZ_AREA,
    Details: ZZ_DETAILS,
    Status: overrides.status ?? "responded",
    CreatedAt: ZZ_CREATED_AT,
    MatchedProviders: [ZZ_PROVIDER_ID],
    MatchedProviderDetails: overrides.matchedProviderDetails ?? [
      {
        ProviderID: ZZ_PROVIDER_ID,
        ProviderName: ZZ_PROVIDER_NAME,
        ProviderPhone: ZZ_PROVIDER_PHONE,
        Verified: "yes",
        OtpVerified: "yes",
        ResponseStatus: "responded",
      },
    ],
    RespondedProvider: overrides.respondedProvider ?? ZZ_PROVIDER_ID,
    RespondedProviderName: overrides.respondedProviderName ?? ZZ_PROVIDER_NAME,
  };
}

// ─── Route capture state ───────────────────────────────────────────────────────

type KkCallRecord = {
  action: string;
  body: Record<string, unknown>;
};

let kkCallRecords: KkCallRecord[] = [];

function resetCaptures() {
  kkCallRecords = [];
}

// ─── Route helpers ─────────────────────────────────────────────────────────────

/**
 * Set up provider dashboard routes.
 * Override individual routes in tests by calling page.route() AFTER this (LIFO).
 */
async function setupProviderDashboardRoutes(
  page: Page,
  opts: {
    profileResponse?: object;
    profileStatus?: number;
    kkActionOverrides?: Record<string, object>;
  } = {}
) {
  const {
    profileResponse = makeProviderProfile(),
    profileStatus = 200,
    kkActionOverrides = {},
  } = opts;

  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: profileStatus,
      contentType: "application/json",
      body: JSON.stringify(profileResponse),
    });
  });

  await page.route("**/api/kk**", async (route: Route) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed = route.request().postDataJSON();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!body.action) {
      const qAction = new URL(route.request().url()).searchParams.get("action") ?? "";
      if (qAction) body = { action: qAction };
    }

    const action = String(body.action || "");
    kkCallRecords.push({ action, body });

    if (kkActionOverrides[action]) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kkActionOverrides[action]),
      });
      return;
    }

    switch (action) {
      case "chat_get_threads":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, threads: [] }),
        });
        break;
      case "chat_create_or_get_thread":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            created: true,
            ThreadID: ZZ_THREAD_ID,
            thread: { ThreadID: ZZ_THREAD_ID },
          }),
        });
        break;
      case "chat_send_message":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        break;
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

/**
 * Set up user my-requests routes.
 */
async function setupMyRequestsRoutes(
  page: Page,
  opts: {
    requestsResponse?: object;
    threadsResponse?: object;
    createThreadResponse?: object;
    kkActionOverrides?: Record<string, object>;
  } = {}
) {
  const {
    requestsResponse = { ok: true, requests: [makeUserRequest()] },
    threadsResponse = { ok: true, threads: [] },
    createThreadResponse = {
      ok: true,
      ThreadID: ZZ_THREAD_ID,
      thread: { ThreadID: ZZ_THREAD_ID },
    },
    kkActionOverrides = {},
  } = opts;

  await page.route("**/api/my-requests**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(requestsResponse),
    });
  });

  await page.route("**/api/kk**", async (route: Route) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed = route.request().postDataJSON();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    const action = String(body.action || "");
    kkCallRecords.push({ action, body });

    if (kkActionOverrides[action]) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kkActionOverrides[action]),
      });
      return;
    }

    switch (action) {
      case "chat_get_threads":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(threadsResponse),
        });
        break;
      case "chat_create_or_get_thread":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createThreadResponse),
        });
        break;
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

/**
 * Set up admin dashboard routes.
 */
async function setupAdminDashboardRoutes(
  page: Page,
  opts: {
    adminRequests?: unknown[];
    kkActionOverrides?: Record<string, object>;
  } = {}
) {
  const {
    adminRequests = [
      {
        TaskID: ZZ_TASK_ID,
        DisplayID: ZZ_DISPLAY_ID,
        UserPhone: ZZ_USER_PHONE,
        Category: ZZ_CATEGORY,
        Area: ZZ_AREA,
        Details: ZZ_DETAILS,
        Status: "responded",
        // Priority: "URGENT" places this request in the urgentRequests bucket.
        // urgentRequests section starts open (openSections.urgentRequests: true),
        // so the task is immediately visible without toggling any accordion.
        Priority: "URGENT",
        CreatedAt: ZZ_CREATED_AT,
        AssignedProvider: ZZ_PROVIDER_ID,
        AssignedProviderName: ZZ_PROVIDER_NAME,
        WaitingMinutes: 0,
      },
    ],
    kkActionOverrides = {},
  } = opts;

  await page.route("**/api/admin/stats**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        stats: {
          totalProviders: 1,
          verifiedProviders: 1,
          pendingAdminApprovals: 0,
          pendingCategoryRequests: 0,
        },
        providers: [],
        categoryApplications: [],
        categories: [],
      }),
    });
  });

  await page.route("**/api/kk**", async (route: Route) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed = route.request().postDataJSON();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!body.action) {
      const qAction = new URL(route.request().url()).searchParams.get("action") ?? "";
      if (qAction) body = { action: qAction };
    }

    const action = String(body.action || "");
    kkCallRecords.push({ action, body });

    if (kkActionOverrides[action]) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kkActionOverrides[action]),
      });
      return;
    }

    switch (action) {
      case "get_admin_requests":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, requests: adminRequests }),
        });
        break;
      case "get_admin_area_mappings":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, mappings: [] }),
        });
        break;
      case "admin_get_unmapped_areas":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, reviews: [] }),
        });
        break;
      case "admin_notification_logs":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, logs: [] }),
        });
        break;
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Provider Response Flow — End-to-End Audit", () => {
  test.beforeEach(() => {
    resetCaptures();
  });

  // ── TC-01: Provider can see matched task in Recent Matched Requests ─────────
  test("TC-01: Provider sees matched task with category, area, and display label in dashboard", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page);

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    // Section heading visible
    await expect(page.getByText("Recent Matched Requests")).toBeVisible({ timeout: 10_000 });

    // Display label rendered from DisplayID
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 8_000 });

    // Category and area appear in the request card — scoped to the matched requests grid
    // to avoid matching the Services chip section which also contains "Electrician"
    const matchedGrid = page.locator("section").filter({ hasText: "Recent Matched Requests" });
    await expect(matchedGrid.getByText(`${ZZ_CATEGORY} in ${ZZ_AREA}`)).toBeVisible({ timeout: 5_000 });

    // "Open Chat" button present for the matched request
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 5_000 });

    // "No response yet" badge shown (request.Responded = false)
    await expect(page.getByText("No response yet")).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-02: Provider "Open Chat" → chat_create_or_get_thread payload correct ──
  test("TC-02: Provider 'Open Chat' → chat_create_or_get_thread POST body has correct fields", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page);

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    // Wait for matched request to render
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    // Intercept navigation after chat is opened
    const navPromise = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await navPromise;

    // Verify chat_create_or_get_thread was called
    const createCall = kkCallRecords.find((r) => r.action === "chat_create_or_get_thread");
    expect(createCall).toBeTruthy();
    expect(createCall?.body.ActorType).toBe("provider");
    expect(createCall?.body.TaskID).toBe(ZZ_TASK_ID);
    // Provider phone is the loggedInProviderPhone (normalised to 10 digits)
    expect(String(createCall?.body.loggedInProviderPhone || "")).toBe(ZZ_PROVIDER_PHONE);
  });

  // ── TC-03: Auto-start message sent when thread is newly created ────────────
  test("TC-03: When provider opens new chat (created=true), auto-start message is sent", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page, {
      kkActionOverrides: {
        chat_create_or_get_thread: {
          ok: true,
          created: true,
          ThreadID: ZZ_THREAD_ID,
          thread: { ThreadID: ZZ_THREAD_ID },
        },
        chat_send_message: { ok: true },
      },
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    const navPromise = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await navPromise;

    // chat_send_message must have been called with auto-start text
    const sendCall = kkCallRecords.find((r) => r.action === "chat_send_message");
    expect(sendCall).toBeTruthy();
    expect(sendCall?.body.ThreadID).toBe(ZZ_THREAD_ID);
    expect(String(sendCall?.body.MessageText || "")).toBe("Yes, mai karunga ye kaam");
    expect(sendCall?.body.ActorType).toBe("provider");
  });

  // ── TC-04: No auto-start message when thread already existed ────────────────
  test("TC-04: When thread already exists (created=false), auto-start message is NOT sent", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page, {
      kkActionOverrides: {
        chat_create_or_get_thread: {
          ok: true,
          created: false, // <-- existing thread
          ThreadID: ZZ_THREAD_ID,
          thread: { ThreadID: ZZ_THREAD_ID },
        },
        chat_send_message: { ok: true },
      },
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    const navPromise = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await navPromise;

    // chat_send_message must NOT have been called (no auto-start for existing thread)
    const sendCall = kkCallRecords.find((r) => r.action === "chat_send_message");
    expect(sendCall).toBeUndefined();
  });

  // ── TC-05: Provider stats card shows Responded By You count ─────────────────
  test("TC-05: Provider dashboard stats — 'Responded By You' card shows correct count", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page, {
      profileResponse: makeProviderProfile({
        metricsOverrides: { TotalRequestsRespondedByMe: 7, ResponseRate: 70 },
      }),
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    // Stats card title
    await expect(page.getByText("Responded By You")).toBeVisible({ timeout: 10_000 });

    // Count value "7" must appear as the large stat number.
    // Scope to the exact stat card div and the bold count element to avoid
    // matching "7" inside "70%" in the response-rate note.
    const statCard = page.locator("div").filter({ hasText: /^Responded By You/ }).first();
    await expect(statCard.locator("p.text-3xl").getByText("7", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-06: Provider "Open Chat" shows inline error on API failure ────────────
  test("TC-06: Provider 'Open Chat' shows inline error when chat_create_or_get_thread fails", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page, {
      kkActionOverrides: {
        chat_create_or_get_thread: {
          ok: false,
          error: "ZZ QA simulated chat create error",
        },
      },
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    await page.locator("button", { hasText: "Open Chat" }).first().click();

    // Error displayed inline in the matched request card (not a redirect)
    await expect(page.getByText("ZZ QA simulated chat create error")).toBeVisible({ timeout: 8_000 });

    // Page stays on provider dashboard
    await expect(page).toHaveURL(/\/provider\/dashboard/);
  });

  // ── TC-07: Provider "Open Chat" button shows "Opening..." while in-flight ───
  test("TC-07: Provider 'Open Chat' button shows 'Opening...' while request is in-flight", async ({ page }) => {
    await injectProviderCookie(page);

    let resolveSlowChat!: () => void;
    await setupProviderDashboardRoutes(page, {
      kkActionOverrides: {
        chat_create_or_get_thread: {
          ok: true,
          created: false,
          ThreadID: ZZ_THREAD_ID,
          thread: { ThreadID: ZZ_THREAD_ID },
        },
      },
    });

    // Override chat_create_or_get_thread with a slow handler (LIFO)
    await page.route("**/api/kk**", async (route: Route) => {
      let body: Record<string, unknown> = {};
      try {
        const parsed = route.request().postDataJSON();
        body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      const action = String(body.action || "");

      if (action === "chat_create_or_get_thread") {
        // Introduce 2 s delay to observe the in-flight state.
        // Route handlers run in Node.js context — use setTimeout, not window.setTimeout.
        await new Promise<void>((res) => {
          resolveSlowChat = res;
          setTimeout(res, 2_000);
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, created: false, ThreadID: ZZ_THREAD_ID, thread: { ThreadID: ZZ_THREAD_ID } }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, threads: [] }),
      });
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    await page.locator("button", { hasText: "Open Chat" }).first().click();

    // Immediately after click, button text changes to "Opening..."
    await expect(
      page.locator("button", { hasText: "Opening..." }).first()
    ).toBeVisible({ timeout: 3_000 });
  });

  // ── TC-08: Provider sees "Responded" badge after responding ─────────────────
  test("TC-08: Provider dashboard shows 'Responded' badge when Responded=true in matched request", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page, {
      profileResponse: makeProviderProfile({
        matchedRequest: makeMatchedRequest({ Responded: true, Accepted: false }),
      }),
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    // "Responded" green badge must appear instead of "No response yet".
    // Use exact:true to avoid matching "Responded By You" stat title or insight sentence.
    await expect(page.getByText("Responded", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("No response yet")).toHaveCount(0);
  });

  // ── TC-09: Provider no matched requests → empty state shown ─────────────────
  test("TC-09: Provider dashboard shows empty state when there are no matched requests", async ({ page }) => {
    await injectProviderCookie(page);
    await setupProviderDashboardRoutes(page, {
      profileResponse: makeProviderProfile({ matchedRequest: null }),
    });

    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("No matched requests yet.")).toBeVisible({ timeout: 10_000 });
  });

  // ── TC-10: User sees "Provider responded" badge in My Requests ──────────────
  test("TC-10: User my-requests shows 'Provider responded' badge when RespondedProvider is set", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, {
      requestsResponse: { ok: true, requests: [makeUserRequest({ respondedProvider: ZZ_PROVIDER_ID })] },
    });

    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    // Task card shows display label
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // "Provider responded" badge
    await expect(page.getByText("Provider responded")).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-11: User sees no "Provider responded" badge when no provider responded ─
  test("TC-11: User my-requests shows no 'Provider responded' badge when RespondedProvider is empty", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, {
      requestsResponse: {
        ok: true,
        requests: [
          makeUserRequest({
            respondedProvider: "",
            respondedProviderName: "",
            status: "notified",
            matchedProviderDetails: [
              {
                ProviderID: ZZ_PROVIDER_ID,
                ProviderName: ZZ_PROVIDER_NAME,
                ProviderPhone: ZZ_PROVIDER_PHONE,
                Verified: "yes",
                ResponseStatus: "notified",
              },
            ],
          }),
        ],
      },
    });

    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Provider responded")).toHaveCount(0);
  });

  // ── TC-12: User "View Responses" expands matched provider list ───────────────
  test("TC-12: User 'View Responses' expands matched providers table with provider name and 'Open Chat' button", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page);

    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    // Expand the responses panel
    const toggleBtn = page.locator("button", { hasText: /View Responses/ }).first();
    await expect(toggleBtn).toBeVisible({ timeout: 10_000 });
    await toggleBtn.click();

    // Provider name appears in the expanded table
    await expect(page.getByText(ZZ_PROVIDER_NAME)).toBeVisible({ timeout: 8_000 });

    // "Open Chat" button per provider row
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 5_000 });

    // "Phone Verified" badge since Verified=yes
    await expect(page.locator("tbody").getByText("Phone Verified")).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-13: User "Open Chat" from matched provider → navigates to thread ──────
  test("TC-13: User 'Open Chat' → chat_create_or_get_thread called (ActorType: user), navigates to thread", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, {
      createThreadResponse: {
        ok: true,
        ThreadID: ZZ_THREAD_ID,
        thread: { ThreadID: ZZ_THREAD_ID },
      },
    });

    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    // Expand responses first
    const toggleBtn = page.locator("button", { hasText: /View Responses/ }).first();
    await expect(toggleBtn).toBeVisible({ timeout: 10_000 });
    await toggleBtn.click();

    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 8_000 });

    const navPromise = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await navPromise;

    // Must navigate to thread URL with actor=user param
    await expect(page).toHaveURL(/\/chat\/thread\/.+\?actor=user/);

    // Verify correct request payload
    const createCall = kkCallRecords.find((r) => r.action === "chat_create_or_get_thread");
    expect(createCall).toBeTruthy();
    expect(createCall?.body.ActorType).toBe("user");
    expect(createCall?.body.TaskID).toBe(ZZ_TASK_ID);
    expect(createCall?.body.ProviderID).toBe(ZZ_PROVIDER_ID);
  });

  // ── TC-14: User unread count badge shows when thread has unread messages ─────
  test("TC-14: User sees unread message badge on task card when thread has UnreadUserCount > 0", async ({ page }) => {
    await injectUserCookie(page);
    await setupMyRequestsRoutes(page, {
      threadsResponse: {
        ok: true,
        threads: [
          {
            ThreadID: ZZ_THREAD_ID,
            TaskID: ZZ_TASK_ID,
            UserPhone: ZZ_USER_PHONE,
            ProviderID: ZZ_PROVIDER_ID,
            UnreadUserCount: 3,
            UnreadProviderCount: 0,
            LastMessageAt: "2026-04-08T08:00:00.000Z",
            CreatedAt: ZZ_CREATED_AT,
          },
        ],
      },
    });

    await page.goto("/dashboard/my-requests");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // Unread badge must show count "3"
    await expect(page.getByText("3 unread")).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-15: Admin sees task with "responded" status ────────────────────────────
  test("TC-15: Admin dashboard shows task with 'responded' status in the requests list", async ({ page }) => {
    await injectAdminCookies(page);
    await setupAdminDashboardRoutes(page, {
      adminRequests: [
        {
          TaskID: ZZ_TASK_ID,
          DisplayID: ZZ_DISPLAY_ID,
          UserPhone: ZZ_USER_PHONE,
          Category: ZZ_CATEGORY,
          Area: ZZ_AREA,
          Details: ZZ_DETAILS,
          Status: "responded",
          // Priority: "URGENT" → goes into urgentRequests bucket which starts open.
          Priority: "URGENT",
          CreatedAt: ZZ_CREATED_AT,
          AssignedProvider: ZZ_PROVIDER_ID,
          AssignedProviderName: ZZ_PROVIDER_NAME,
          WaitingMinutes: 0,
        },
      ],
    });

    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");

    // Admin dashboard loads without redirect
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    // Task display label appears in the requests table
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 15_000 });

    // Status "responded" is shown (getTaskStatusLabel passes it through unchanged).
    await expect(page.getByText("responded")).toBeVisible({ timeout: 5_000 });

    // Category and area visible in the urgentRequests table row.
    await expect(page.getByText(ZZ_CATEGORY).first()).toBeVisible({ timeout: 5_000 });
    // Note: AssignedProviderName is NOT rendered in the urgentRequests table columns
    // (Kaam / Category / Area / Status / Priority / Waiting / Deadline / Action).
    // It only appears inside the detail side-panel when a request row is selected.
    // So we verify engagement via the status column, which is the definitive signal.
  });

  // ── TC-16: Status consistency — provider "Responded" badge matches user side ──
  test("TC-16: Status consistency — provider sees 'Responded' badge when user side shows 'Provider responded'", async ({ page: providerPage, context }) => {
    // Provider side
    await injectProviderCookie(providerPage);
    await setupProviderDashboardRoutes(providerPage, {
      profileResponse: makeProviderProfile({
        matchedRequest: makeMatchedRequest({ Responded: true }),
      }),
    });
    await providerPage.goto("/provider/dashboard");
    await providerPage.waitForLoadState("networkidle");

    // Provider sees "Responded" green badge — exact:true avoids matching "Responded By You"
    await expect(providerPage.getByText("Responded", { exact: true })).toBeVisible({ timeout: 10_000 });

    // User side in a new page from same context
    const userPage = await context.newPage();

    await userPage.context().addCookies([
      {
        name: "kk_auth_session",
        value: makeSessionCookieValue(ZZ_USER_PHONE),
        url: "http://localhost:3000",
        sameSite: "Lax",
      },
    ]);
    await setupMyRequestsRoutes(userPage, {
      requestsResponse: { ok: true, requests: [makeUserRequest({ respondedProvider: ZZ_PROVIDER_ID })] },
    });
    await userPage.goto("/dashboard/my-requests");
    await userPage.waitForLoadState("networkidle");

    // User sees "Provider responded" badge for the same task
    await expect(userPage.getByText("Provider responded")).toBeVisible({ timeout: 10_000 });

    await userPage.close();
  });
});
