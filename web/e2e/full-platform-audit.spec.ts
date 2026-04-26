/**
 * MASTER E2E AUDIT: Kaun Karega Full Platform Flow
 *
 * Purpose:
 *  - Single audit entrypoint covering the end-to-end platform flow across
 *    user, provider, and admin journeys.
 *  - Phase 1 is implemented and runnable.
 *  - Remaining phases stay scaffold-only for later work.
 *
 * Suggested run:
 *   npx playwright test e2e/full-platform-audit.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

const BASE_URL = "https://kaun-karega.vercel.app";
const ZZ_CATEGORY = "Electrician";
const ZZ_AREA = "Sardarpura";
const ZZ_DETAILS = "ZZ QA full platform audit phase 1 task. Please ignore.";
const ZZ_TASK_ID = "TASK-ZZ-QA-AUDIT-001";
const ZZ_DISPLAY_ID = "ZZ-QA-AUDIT-001";
const ZZ_DISPLAY_LABEL = "Kaam No. 1";
const ZZ_STATUS_LABEL = "Pending";
const ZZ_PROVIDER_PHONE = "9876543299";
const ZZ_PROVIDER_ID = "ZZ-PROV-QA-AUDIT-001";
const ZZ_PROVIDER_NAME = "ZZ QA Audit Provider";
const ZZ_THREAD_ID = "ZZ-THREAD-QA-AUDIT-001";
const FIRST_PROVIDER_MESSAGE = "ZZ QA audit provider first message";
const SECOND_PROVIDER_MESSAGE = "ZZ QA audit provider second message";
const ZZ_ADMIN_PHONE = "9999999904";

type AuditContext = {
  taskId: string;
  displayId: string;
  threadId: string;
  userPhone: string;
  providerPhone: string;
  providerId: string;
};

function createAuditContext(): AuditContext {
  return {
    taskId: "",
    displayId: "",
    threadId: "",
    userPhone: "",
    providerPhone: "",
    providerId: "",
  };
}

let phase3ChatMessages: Array<Record<string, unknown>> = [];

function makeSessionCookieValue(phone = "9999999999"): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectUserCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(),
      url: BASE_URL,
      sameSite: "Lax",
    },
  ]);
}

async function injectProviderCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(ZZ_PROVIDER_PHONE),
      url: BASE_URL,
      sameSite: "Lax",
    },
  ]);
}

async function injectAdminSession(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(ZZ_ADMIN_PHONE),
      url: BASE_URL,
      sameSite: "Lax",
    },
    {
      name: "kk_admin",
      value: "1",
      url: BASE_URL,
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem(
      "kk_admin_session",
      JSON.stringify({ isAdmin: true, name: "QA Admin", role: "admin", permissions: [] })
    );
  });
}

async function setupPhase1Routes(page: Page, audit: AuditContext) {
  await page.route("**/api/get-categories**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { name: ZZ_CATEGORY, active: "yes" },
          { name: "Plumber", active: "yes" },
          { name: "Carpenter", active: "yes" },
        ],
      }),
    });
  });

  await page.route("**/api/areas**", async (route: Route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    const areas = [ZZ_AREA, "Shastri Nagar", "Ratanada"];
    const filtered = q ? areas.filter((area) => area.toLowerCase().includes(q.toLowerCase())) : areas;
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
      body: JSON.stringify({
        ok: true,
        taskId: ZZ_TASK_ID,
        displayId: ZZ_DISPLAY_ID,
      }),
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

  await page.route("**/api/my-requests**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requests: [
          {
            TaskID: audit.taskId || ZZ_TASK_ID,
            DisplayID: audit.displayId || ZZ_DISPLAY_ID,
            Category: ZZ_CATEGORY,
            Area: ZZ_AREA,
            Details: ZZ_DETAILS,
            Status: "pending",
            CreatedAt: "2026-04-11T10:00:00.000Z",
            MatchedProviders: [],
            MatchedProviderDetails: [],
            RespondedProvider: "",
            RespondedProviderName: "",
          },
        ],
      }),
    });
  });

  await page.route("**/api/kk**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, threads: [] }),
    });
  });
}

function makePhase3ProviderProfile(audit: AuditContext) {
  return {
    ok: true,
    provider: {
      ProviderID: ZZ_PROVIDER_ID,
      ProviderName: ZZ_PROVIDER_NAME,
      Phone: ZZ_PROVIDER_PHONE,
      Verified: "yes",
      OtpVerified: "yes",
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
          TotalRequestsInMyCategories: 1,
          TotalRequestsMatchedToMe: 1,
          TotalRequestsRespondedByMe: 0,
          TotalRequestsAcceptedByMe: 0,
          TotalRequestsCompletedByMe: 0,
          ResponseRate: 0,
          AcceptanceRate: 0,
        },
        AreaDemand: [],
        SelectedAreaDemand: [],
        CategoryDemandByRange: { today: [] },
        RecentMatchedRequests: [
          {
            TaskID: audit.taskId || ZZ_TASK_ID,
            DisplayID: audit.displayId || ZZ_DISPLAY_ID,
            Category: ZZ_CATEGORY,
            Area: ZZ_AREA,
            Details: ZZ_DETAILS,
            CreatedAt: new Date().toISOString(),
            Responded: false,
            Accepted: false,
            ThreadID: "",
          },
        ],
      },
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: ZZ_AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes: [],
      },
    },
  };
}

function makePhase3Thread(audit: AuditContext) {
  return {
    ThreadID: audit.threadId || ZZ_THREAD_ID,
    TaskID: audit.taskId || ZZ_TASK_ID,
    DisplayID: audit.displayId || ZZ_DISPLAY_ID,
    UserPhone: "9999999999",
    ProviderID: ZZ_PROVIDER_ID,
    ProviderPhone: ZZ_PROVIDER_PHONE,
    Category: ZZ_CATEGORY,
    Area: ZZ_AREA,
    Status: "active",
    LastMessageAt: new Date().toISOString(),
  };
}

async function setupPhase3Routes(page: Page, audit: AuditContext) {
  phase3ChatMessages = [];

  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makePhase3ProviderProfile(audit)),
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
      if (qAction) body = { action: qAction, ...body };
    }

    const action = String(body.action || "");

    switch (action) {
      case "get_provider_by_phone":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makePhase3ProviderProfile(audit)),
        });
        return;
      case "chat_get_threads":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, threads: [] }),
        });
        return;
      case "chat_create_or_get_thread":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            created: false,
            ThreadID: audit.threadId || ZZ_THREAD_ID,
            thread: { ThreadID: audit.threadId || ZZ_THREAD_ID },
          }),
        });
        return;
      case "chat_get_messages":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            thread: makePhase3Thread(audit),
            messages: phase3ChatMessages,
          }),
        });
        return;
      case "chat_mark_read":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      case "chat_send_message": {
        const nextIndex = phase3ChatMessages.length + 1;
        const messageText = String(body.MessageText || "").trim();
        phase3ChatMessages.push({
          MessageID: `MSG-ZZ-AUDIT-${String(nextIndex).padStart(3, "0")}`,
          ThreadID: audit.threadId || ZZ_THREAD_ID,
          TaskID: audit.taskId || ZZ_TASK_ID,
          SenderType: "provider",
          MessageText: messageText,
          CreatedAt: new Date().toISOString(),
          ReadByUser: "no",
          ReadByProvider: "yes",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

async function setupPhase4Routes(page: Page, audit: AuditContext) {
  await page.route("**/api/my-requests**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requests: [
          {
            TaskID: audit.taskId || ZZ_TASK_ID,
            DisplayID: audit.displayId || ZZ_DISPLAY_ID,
            Category: ZZ_CATEGORY,
            Area: ZZ_AREA,
            Details: ZZ_DETAILS,
            Status: "responded",
            CreatedAt: "2026-04-11T10:00:00.000Z",
            MatchedProviders: [ZZ_PROVIDER_ID],
            MatchedProviderDetails: [
              {
                ProviderID: ZZ_PROVIDER_ID,
                ProviderName: ZZ_PROVIDER_NAME,
                ProviderPhone: ZZ_PROVIDER_PHONE,
                Verified: "yes",
                OtpVerified: "yes",
                ResponseStatus: "responded",
              },
            ],
            RespondedProvider: ZZ_PROVIDER_ID,
            RespondedProviderName: ZZ_PROVIDER_NAME,
          },
        ],
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
      if (qAction) body = { action: qAction, ...body };
    }

    const action = String(body.action || "");

    switch (action) {
      case "chat_get_threads":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            threads: [
              {
                ThreadID: audit.threadId || ZZ_THREAD_ID,
                TaskID: audit.taskId || ZZ_TASK_ID,
                UserPhone: "9999999999",
                ProviderID: ZZ_PROVIDER_ID,
                ProviderPhone: ZZ_PROVIDER_PHONE,
                Category: ZZ_CATEGORY,
                Area: ZZ_AREA,
                Status: "active",
                CreatedAt: "2026-04-11T10:00:00.000Z",
                UpdatedAt: new Date().toISOString(),
                LastMessageAt: new Date().toISOString(),
                LastMessageBy: "provider",
                UnreadUserCount: 2,
                UnreadProviderCount: 0,
              },
            ],
          }),
        });
        return;
      case "chat_create_or_get_thread":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            created: false,
            ThreadID: audit.threadId || ZZ_THREAD_ID,
            thread: { ThreadID: audit.threadId || ZZ_THREAD_ID },
          }),
        });
        return;
      case "chat_get_messages":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            thread: makePhase3Thread(audit),
            messages: phase3ChatMessages,
          }),
        });
        return;
      case "chat_mark_read":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      case "chat_send_message": {
        const nextIndex = phase3ChatMessages.length + 1;
        const messageText = String(body.MessageText || "").trim();
        phase3ChatMessages.push({
          MessageID: `MSG-ZZ-AUDIT-${String(nextIndex).padStart(3, "0")}`,
          ThreadID: audit.threadId || ZZ_THREAD_ID,
          TaskID: audit.taskId || ZZ_TASK_ID,
          SenderType: "user",
          MessageText: messageText,
          CreatedAt: new Date().toISOString(),
          ReadByUser: "yes",
          ReadByProvider: "no",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

async function setupPhase5Routes(page: Page) {
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
          pendingCategoryRequests: 1,
        },
        providers: [
          {
            ProviderID: ZZ_PROVIDER_ID,
            ProviderName: ZZ_PROVIDER_NAME,
            Phone: ZZ_PROVIDER_PHONE,
            Verified: "yes",
            PendingApproval: "no",
            Category: ZZ_CATEGORY,
            Areas: ZZ_AREA,
          },
        ],
        categoryApplications: [
          {
            RequestID: "ZZ-QA-CAT-REQ-AUDIT-001",
            ProviderName: ZZ_PROVIDER_NAME,
            Phone: ZZ_PROVIDER_PHONE,
            RequestedCategory: "ZZ QA Category Request",
            Status: "pending",
            CreatedAt: "2026-04-11 10:00:00",
          },
        ],
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

    switch (action) {
      case "get_admin_requests":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, requests: [] }),
        });
        return;
      case "get_admin_area_mappings":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, mappings: [] }),
        });
        return;
      case "admin_get_unmapped_areas":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, reviews: [] }),
        });
        return;
      case "admin_notification_logs":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, logs: [] }),
        });
        return;
      case "admin_notification_summary":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, summary: { total: 0, accepted: 0, failed: 0, error: 0 } }),
        });
        return;
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

async function setupPhase6ProviderRoutes(page: Page, audit: AuditContext) {
  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makePhase3ProviderProfile(audit)),
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
      if (qAction) body = { action: qAction, ...body };
    }

    const action = String(body.action || "");

    switch (action) {
      case "get_provider_by_phone":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makePhase3ProviderProfile(audit)),
        });
        return;
      case "chat_get_threads":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, threads: [] }),
        });
        return;
      case "chat_create_or_get_thread":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            created: false,
            ThreadID: audit.threadId || ZZ_THREAD_ID,
            thread: { ThreadID: audit.threadId || ZZ_THREAD_ID },
          }),
        });
        return;
      case "chat_get_messages":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            thread: makePhase3Thread(audit),
            messages: phase3ChatMessages,
          }),
        });
        return;
      case "chat_mark_read":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

async function gotoHome(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

async function fillCategory(page: Page, category: string) {
  const input = page.locator('input.bg-transparent[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.fill(category);
  await input.press("Escape");
  await input.press("Tab");
  await page.waitForTimeout(150);
}

async function selectTime(page: Page, timeLabel: string) {
  const chip = page.locator("button", { hasText: new RegExp(`^${timeLabel}$`) }).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await chip.click();
}

async function selectAreaChip(page: Page, chipText: string) {
  const chip = page.locator("button", { hasText: chipText }).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await chip.click();
}

async function fillDetails(page: Page, text: string) {
  const ta = page.locator('textarea[placeholder*="Describe"]').first();
  await expect(ta).toBeVisible({ timeout: 5_000 });
  await ta.fill(text);
}

async function clickSubmit(page: Page) {
  const btn = page.locator("button", { hasText: "Submit Request" }).first();
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await expect(btn).toBeEnabled();
  await btn.click();
}

async function expectSuccessPage(page: Page) {
  await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });
  await expect(page.getByText("Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });
}

async function openUserRequests(page: Page) {
  await page.goto("/dashboard/my-requests");
  await page.waitForLoadState("networkidle");
}

async function openProviderDashboard(page: Page) {
  await page.goto("/provider/dashboard");
  await page.waitForLoadState("networkidle");
}

async function openAdminDashboard(page: Page) {
  await page.goto("/admin/dashboard");
  await page.waitForLoadState("networkidle");
}

test.describe("Kaun Karega - Full Platform Audit", () => {
  test.describe.configure({ mode: "serial" });

  const audit = createAuditContext();

  test("PHASE 1 - User Journey", async ({ page }) => {
    await injectUserCookie(page);
    await setupPhase1Routes(page, audit);

    // 1. homepage loads
    await gotoHome(page);
    await expect(page).toHaveURL(new RegExp(`${new URL(BASE_URL).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));

    // 2. service/category entry works
    await fillCategory(page, ZZ_CATEGORY);

    // 3. area selection works
    await selectTime(page, "Right now");
    await selectAreaChip(page, ZZ_AREA);

    // 4. task submit works
    await fillDetails(page, ZZ_DETAILS);
    await clickSubmit(page);

    // 5. success page loads
    await expectSuccessPage(page);

    // 6. capture TaskID and DisplayID from URL or visible UI
    const successUrl = new URL(page.url());
    audit.taskId = successUrl.searchParams.get("taskId") || "";
    audit.displayId = successUrl.searchParams.get("displayId") || "";
    expect(audit.taskId).toBe(ZZ_TASK_ID);
    expect(audit.displayId).toBe(ZZ_DISPLAY_ID);
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // 7. open My Requests
    await openUserRequests(page);
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible({ timeout: 10_000 });

    // 8. verify the new task is visible there
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_CATEGORY)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_AREA)).toBeVisible({ timeout: 10_000 });

    // 9. verify status rendering is valid and no UI break occurs
    await expect(page.getByText(ZZ_STATUS_LABEL)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("main").last()).toContainText("Total requests:");
    await expect(page.getByText(/Loading your requests\.\.\./)).toHaveCount(0);
    await expect(page.getByText(/Failed to load requests/i)).toHaveCount(0);
  });

  test.fixme("PHASE 2 - Matching / Notification Evidence", async ({ page }) => {
    // task reaches matching path
    // TODO

    // no UI break after submit
    // TODO

    // placeholders/comments for checking provider match evidence
    // TODO:
    //  - verify provider match evidence via existing UI/API hooks if already exposed
    //  - otherwise document the exact manual verification point

    // placeholders/comments for checking notification evidence
    // TODO:
    //  - check notification evidence via admin logs/health view if available
    //  - otherwise document manual Apps Script / sheet verification

    await expect(page).toBeTruthy();
  });

  test("PHASE 3 - Provider Journey", async ({ page }) => {
    await injectProviderCookie(page);
    await setupPhase3Routes(page, audit);

    // provider dashboard loads
    await openProviderDashboard(page);
    await expect(page).toHaveURL(/\/provider\/dashboard/, { timeout: 10_000 });
    await expect(page.getByText("Recent Matched Requests")).toBeVisible({ timeout: 10_000 });

    // matched task appears
    const matchedGrid = page.locator("section").filter({ hasText: "Recent Matched Requests" });
    await expect(matchedGrid.getByText(`${ZZ_CATEGORY} in ${ZZ_AREA}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    // provider opens chat
    const openChatNavigation = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await openChatNavigation;
    audit.threadId = audit.threadId || ZZ_THREAD_ID;

    // verify chat thread loads
    await expect(page).toHaveURL(new RegExp(`/chat/thread/${audit.threadId}$`), { timeout: 10_000 });
    await expect(page.getByText("Loading chat...")).toHaveCount(0);

    const messageBox = page.locator('textarea[placeholder*="Message"]').first();
    const sendButton = page.locator("button", { hasText: /^Send$/ }).first();
    await expect(messageBox).toBeVisible({ timeout: 10_000 });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });

    // provider sends first message
    await messageBox.fill(FIRST_PROVIDER_MESSAGE);
    await sendButton.click();
    await expect(page.getByText(FIRST_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    // provider sends second message
    await messageBox.fill(SECOND_PROVIDER_MESSAGE);
    await sendButton.click();
    await expect(page.getByText(SECOND_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    // both messages render
    await expect(page.getByText(FIRST_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(SECOND_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    // ensure no UI break after both sends
    await expect(sendButton).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/chat/thread/${audit.threadId}$`));
    await expect(page.getByText(/Unable to send message/i)).toHaveCount(0);
    await expect(page.getByText(/Access denied/i)).toHaveCount(0);

    // placeholder/comment for checking first-message notification behavior
    // TODO:
    //  - confirm first provider message triggered user notification once
    //  - confirm second provider message did not re-trigger
  });

  test("PHASE 4 - User Chat Return Journey", async ({ page }) => {
    await injectUserCookie(page);
    await setupPhase4Routes(page, audit);

    // user opens chat thread
    await openUserRequests(page);
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });

    // open the same task created in Phase 1
    const taskCard = page.locator("div.rounded-xl").filter({ hasText: ZZ_DISPLAY_LABEL }).first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.locator("button").filter({ hasText: /View Responses/ }).click();
    const providerRow = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME }).first();
    await expect(providerRow).toBeVisible({ timeout: 10_000 });

    // open chat thread
    const openChatNavigation = page.waitForURL(/\/chat\/thread\/.+\?actor=user/, { timeout: 10_000 });
    await providerRow.getByRole("button", { name: "Open Chat" }).click();
    await openChatNavigation;
    await expect(page).toHaveURL(new RegExp(`/chat/thread/${audit.threadId || ZZ_THREAD_ID}\\?actor=user$`), {
      timeout: 10_000,
    });

    // user sees provider message
    await expect(page.getByText(FIRST_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(SECOND_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    // user replies
    const messageBox = page.locator('textarea[placeholder*="Message"]').first();
    const sendButton = page.locator("button", { hasText: /^Send$/ }).first();
    const userReply = "ZZ QA audit user reply";
    await expect(messageBox).toBeVisible({ timeout: 10_000 });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });
    await messageBox.fill(userReply);
    await sendButton.click();

    // reply renders correctly
    await expect(page.getByText(userReply, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(FIRST_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(SECOND_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    // ensure chat UI remains stable
    await expect(page).toHaveURL(new RegExp(`/chat/thread/${audit.threadId || ZZ_THREAD_ID}\\?actor=user$`));
    await expect(sendButton).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Unable to send message/i)).toHaveCount(0);
    await expect(page.getByText(/Access denied/i)).toHaveCount(0);
    await expect(page.getByText("Loading chat...")).toHaveCount(0);

    // placeholder/comment for future provider-reply notification verification
    // TODO:
    //  - document future provider-side notification expectations here
  });

  test("PHASE 5 - Admin Journey", async ({ page }) => {
    // admin login/dashboard access
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/login|\/admin\/login/, { timeout: 10_000 });
    await injectAdminSession(page);
    await setupPhase5Routes(page);
    await openAdminDashboard(page);
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });
    await expect(page.getByText("Admin Dashboard")).toBeVisible({ timeout: 10_000 });

    // stats/cards load
    await expect(page.getByText("Total Providers")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Verified Providers")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Pending Admin Approvals")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Pending Category Requests", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // pending queues load
    await expect(page.getByText(/Pending Category Requests/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ZZ QA Category Request")).toBeVisible({ timeout: 10_000 });

    // provider/admin critical panels render
    await expect(page.getByText("Providers Needing Attention")).toBeVisible({ timeout: 10_000 });

    // notification/health section loads if available
    await expect(page.getByText("Notification Health")).toBeVisible({ timeout: 10_000 });

    // no dashboard crash
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
    await expect(page.getByText(/Loading login/i)).toHaveCount(0);
  });

  test.fixme("PHASE 6 - End State Consistency", async ({ page }) => {
    await injectUserCookie(page);
    await setupPhase4Routes(page, audit);

    // 1. Re-open user dashboard
    await openUserRequests(page);
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible({ timeout: 10_000 });

    // 2. Verify the original task is still visible
    await expect(page.getByText(ZZ_DISPLAY_LABEL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_CATEGORY)).toBeVisible({ timeout: 10_000 });

    // 3. Open the same chat thread again
    const taskCard = page.locator("div.rounded-xl").filter({ hasText: ZZ_DISPLAY_LABEL }).first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await taskCard.locator("button").filter({ hasText: /View Responses/ }).click();
    const providerRow = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME }).first();
    await expect(providerRow).toBeVisible({ timeout: 10_000 });
    const userChatNavigation = page.waitForURL(/\/chat\/thread\/.+\?actor=user/, { timeout: 10_000 });
    await providerRow.getByRole("button", { name: "Open Chat" }).click();
    await userChatNavigation;

    // 4. Verify provider messages and user reply still visible
    await expect(page.getByText(FIRST_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(SECOND_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ZZ QA audit user reply", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 5. Ensure no UI break
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
    await expect(page.getByText("Loading chat...")).toHaveCount(0);

    // 6. Navigate to provider dashboard again
    await injectProviderCookie(page);
    await setupPhase6ProviderRoutes(page, audit);
    await openProviderDashboard(page);
    await expect(page).toHaveURL(/\/provider\/dashboard/, { timeout: 10_000 });

    // 7. Verify provider can still access the same chat thread
    const matchedGrid = page.locator("section").filter({ hasText: "Recent Matched Requests" });
    await expect(matchedGrid.getByText(`${ZZ_CATEGORY} in ${ZZ_AREA}`)).toBeVisible({ timeout: 10_000 });
    const providerOpenChatNavigation = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await providerOpenChatNavigation;
    await expect(page).toHaveURL(new RegExp(`/chat/thread/${audit.threadId || ZZ_THREAD_ID}$`), { timeout: 10_000 });
    await expect(page.getByText(FIRST_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(SECOND_PROVIDER_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ZZ QA audit user reply", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 8. Ensure system stability across navigation
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
    await expect(page.getByText(/Access denied/i)).toHaveCount(0);
  });

  test.fixme("MASTER AUDIT - Shared Helper Wiring", async () => {
    // TODO:
    //  - centralize user auth bootstrap
    //  - centralize provider auth bootstrap
    //  - centralize admin auth bootstrap
    //  - centralize task/thread capture and reuse across phases
    //  - centralize route/api observation helpers where appropriate
    expect(audit).toBeTruthy();
  });
});
