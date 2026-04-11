/**
 * E2E: Provider first chat message notification trigger
 *
 * Scope:
 *  - Submit a fresh task through the user flow
 *  - Open the provider dashboard for that task
 *  - Enter the provider chat thread
 *  - Send first and second provider messages
 *
 * Uses route interception only. No real GAS / WhatsApp delivery is asserted here.
 *
 * Manual Apps Script verification after running:
 *  - First provider message should fire the user notification exactly once.
 *  - Second provider message must not re-trigger that notification.
 */

import { test, expect, Page, Route } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

const ZZ_CATEGORY = "Electrician";
const ZZ_AREA = "Sardarpura";
const ZZ_DETAILS = "ZZ QA first-provider-message notification test. Please ignore.";
const ZZ_USER_PHONE = "9999999911";
const ZZ_PROVIDER_PHONE = "9876543211";
const ZZ_PROVIDER_ID = "ZZ-PROV-QA-FIRST-001";
const ZZ_PROVIDER_NAME = "ZZ QA Provider First Message";
const ZZ_THREAD_ID = "ZZ-THREAD-QA-FIRST-001";
const ZZ_TASK_ID = "TASK-ZZ-QA-FIRST-001";
const ZZ_DISPLAY_ID = "ZZ-QA-FIRST-001";
const FIRST_MESSAGE = "ZZ QA provider first manual message";
const SECOND_MESSAGE = "ZZ QA provider second manual message";

type KkCallRecord = {
  action: string;
  body: Record<string, unknown>;
};

let kkCallRecords: KkCallRecord[] = [];
let chatMessages: Array<Record<string, unknown>> = [];
let currentTaskId = ZZ_TASK_ID;
let currentDisplayId = ZZ_DISPLAY_ID;

function resetState() {
  kkCallRecords = [];
  chatMessages = [];
  currentTaskId = ZZ_TASK_ID;
  currentDisplayId = ZZ_DISPLAY_ID;
}

function makeSessionCookieValue(phone: string): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectUserCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(ZZ_USER_PHONE),
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

function makeProviderProfile() {
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
            TaskID: currentTaskId,
            DisplayID: currentDisplayId,
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

function makeThread() {
  return {
    ThreadID: ZZ_THREAD_ID,
    TaskID: currentTaskId,
    DisplayID: currentDisplayId,
    UserPhone: ZZ_USER_PHONE,
    ProviderID: ZZ_PROVIDER_ID,
    ProviderPhone: ZZ_PROVIDER_PHONE,
    Category: ZZ_CATEGORY,
    Area: ZZ_AREA,
    Status: "active",
    LastMessageAt: new Date().toISOString(),
  };
}

async function setupRoutes(page: Page) {
  await page.route("**/api/get-categories**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { name: ZZ_CATEGORY, active: "yes" },
          { name: "Plumber", active: "yes" },
        ],
      }),
    });
  });

  await page.route("**/api/areas**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, areas: [ZZ_AREA, "Shastri Nagar"] }),
    });
  });

  await page.route("**/api/submit-request**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        taskId: currentTaskId,
        displayId: currentDisplayId,
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

  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeProviderProfile()),
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
    kkCallRecords.push({ action, body });

    switch (action) {
      case "get_provider_by_phone":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeProviderProfile()),
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
            ThreadID: ZZ_THREAD_ID,
            thread: { ThreadID: ZZ_THREAD_ID },
          }),
        });
        return;
      case "chat_get_messages":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            thread: makeThread(),
            messages: chatMessages,
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
        const nextIndex = chatMessages.length + 1;
        const messageText = String(body.MessageText || "").trim();
        chatMessages.push({
          MessageID: `MSG-ZZ-FIRST-${String(nextIndex).padStart(3, "0")}`,
          ThreadID: ZZ_THREAD_ID,
          TaskID: currentTaskId,
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

test.describe("Provider First Message Notification", () => {
  test.beforeEach(async ({ page }) => {
    resetState();
    await injectUserCookie(page);
    await setupRoutes(page);
  });

  test("provider first manual chat message sends cleanly and second message does not break flow", async ({ page }) => {
    await gotoHome(page);
    await fillCategory(page, ZZ_CATEGORY);
    await selectTime(page, "Right now");
    await selectAreaChip(page, ZZ_AREA);
    await fillDetails(page, ZZ_DETAILS);
    await clickSubmit(page);

    await expect(page).toHaveURL(/\/success/, { timeout: 15_000 });
    await expect(page.getByText("Task Submitted Successfully")).toBeVisible({ timeout: 10_000 });

    const successUrl = new URL(page.url());
    currentTaskId = successUrl.searchParams.get("taskId") || currentTaskId;
    currentDisplayId = successUrl.searchParams.get("displayId") || currentDisplayId;

    expect(currentTaskId).toBeTruthy();
    expect(currentDisplayId).toBeTruthy();

    await injectProviderCookie(page);
    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(`${ZZ_CATEGORY} in ${ZZ_AREA}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "Open Chat" }).first()).toBeVisible({ timeout: 10_000 });

    const openChatNavigation = page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });
    await page.locator("button", { hasText: "Open Chat" }).first().click();
    await openChatNavigation;

    await expect(page).toHaveURL(new RegExp(`/chat/thread/${ZZ_THREAD_ID}$`), { timeout: 10_000 });
    await expect(page.getByText("Loading chat...")).not.toBeVisible({ timeout: 10_000 }).catch(() => {});

    const messageBox = page.locator('textarea[placeholder*="Message"]').first();
    const sendButton = page.locator("button", { hasText: /^Send$/ }).first();

    await expect(messageBox).toBeVisible({ timeout: 10_000 });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });

    await messageBox.fill(FIRST_MESSAGE);
    await sendButton.click();
    await expect(page.getByText(FIRST_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    await messageBox.fill(SECOND_MESSAGE);
    await sendButton.click();
    await expect(page.getByText(SECOND_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(FIRST_MESSAGE, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/chat/thread/${ZZ_THREAD_ID}$`));

    const providerSends = kkCallRecords.filter((record) => record.action === "chat_send_message");
    expect(providerSends).toHaveLength(2);
    expect(String(providerSends[0]?.body.ThreadID || "")).toBe(ZZ_THREAD_ID);
    expect(String(providerSends[0]?.body.MessageText || "")).toBe(FIRST_MESSAGE);
    expect(String(providerSends[1]?.body.MessageText || "")).toBe(SECOND_MESSAGE);

    // Manual Apps Script check:
    // 1. First provider message should emit one user_chat_first_provider_message notification.
    // 2. Second provider message should not emit a second notification for the same thread.
  });
});
