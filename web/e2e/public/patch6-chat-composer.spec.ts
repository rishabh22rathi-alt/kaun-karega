import type { Page, Route } from "@playwright/test";

import { bootstrapUserSession } from "../_support/auth";
import { test, expect } from "../_support/test";

const QA_USER_PHONE = "9888800001";
const THREAD_ID = "ZZ-PATCH6-THREAD-1";
const TASK_ID = "ZZ-PATCH6-TASK-1";

type KkBody = {
  action?: string;
  ActorType?: string;
  ThreadID?: string;
  UserPhone?: string;
  loggedInProviderPhone?: string;
};

const baseThread = {
  ThreadID: THREAD_ID,
  TaskID: TASK_ID,
  DisplayID: "T-PATCH6",
  UserPhone: QA_USER_PHONE,
  ProviderID: "ZZ-PROV-PATCH6",
  Status: "active",
  LastMessageAt: new Date().toISOString(),
};

const baseMessages = [
  {
    MessageID: "M1",
    ThreadID: THREAD_ID,
    TaskID: TASK_ID,
    SenderType: "user",
    MessageText: "Hi there",
    CreatedAt: new Date(Date.now() - 60_000).toISOString(),
    ReadByUser: "yes",
    ReadByProvider: "yes",
  },
  {
    MessageID: "M2",
    ThreadID: THREAD_ID,
    TaskID: TASK_ID,
    SenderType: "provider",
    MessageText: "Hello, how can I help?",
    CreatedAt: new Date(Date.now() - 30_000).toISOString(),
    ReadByUser: "yes",
    ReadByProvider: "yes",
  },
];

async function mockChatRoutes(page: Page) {
  await page.route("**/api/kk**", async (route: Route) => {
    const request = route.request();
    let body: KkBody = {};
    try {
      body = JSON.parse(request.postData() || "{}") as KkBody;
    } catch {
      body = {};
    }
    const action = body.action || new URL(request.url()).searchParams.get("action") || "";

    if (action === "chat_get_messages") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, thread: baseThread, messages: baseMessages }),
      });
      return;
    }

    if (action === "chat_mark_read" || action === "chat_send_message") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

async function gotoChat(page: Page) {
  await bootstrapUserSession(page, QA_USER_PHONE);
  await mockChatRoutes(page);
  await page.goto(`/chat/thread/${THREAD_ID}?actor=user`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('textarea[placeholder*="Message"]')).toBeVisible({ timeout: 5_000 });
}

test.describe("PATCH 6A+6B — chat composer responsiveness", () => {
  test("mobile 390 — composer rendered and message scroll uses dvh-based height", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoChat(page);

    const sendBtn = page.getByRole("button", { name: "Send", exact: true });
    await expect(sendBtn).toBeVisible();

    // The message scroll container should resolve to a non-zero height anchored
    // to the dynamic viewport (we use h-[62dvh]). A naive computed height check
    // proves the unit resolved (would be 0 if the unit failed in this engine).
    const scrollHeightPx = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("div"));
      const scroll = candidates.find((el) => {
        const cs = getComputedStyle(el);
        return cs.overflowY === "auto" && parseFloat(cs.height) > 200;
      });
      if (!scroll) return 0;
      return parseFloat(getComputedStyle(scroll).height);
    });
    expect(scrollHeightPx).toBeGreaterThan(0);
    // 62% of 844 = 523.28; allow tolerance for browser rounding and zoom.
    expect(scrollHeightPx).toBeGreaterThan(440);
    expect(scrollHeightPx).toBeLessThan(620);
  });

  test("mobile 390 — Send button is adjacent (right of) textarea, not below", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoChat(page);

    const textarea = page.locator('textarea[placeholder*="Message"]').first();
    const sendBtn = page.getByRole("button", { name: "Send", exact: true });

    const taBox = await textarea.boundingBox();
    const sendBox = await sendBtn.boundingBox();
    expect(taBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    if (taBox && sendBox) {
      // Send button's left edge must be to the right of textarea's right edge
      // (with small tolerance for the gap).
      expect(sendBox.x).toBeGreaterThanOrEqual(taBox.x + taBox.width - 1);
      // Their vertical bands must overlap (i.e., they're on the same row).
      const taBottom = taBox.y + taBox.height;
      const sendBottom = sendBox.y + sendBox.height;
      const overlap = Math.min(taBottom, sendBottom) - Math.max(taBox.y, sendBox.y);
      expect(overlap).toBeGreaterThan(0);
    }
  });

  test("mobile 390 — Thread ID pill hidden", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoChat(page);

    const threadIdPill = page.getByText(/^Thread ID:/);
    await expect(threadIdPill).toBeHidden();
  });

  test("desktop 1280 — Thread ID pill visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoChat(page);

    const threadIdPill = page.getByText(/^Thread ID:/);
    await expect(threadIdPill).toBeVisible();
  });

  test("desktop 1280 — composer regression: textarea + helper + Send still rendered", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoChat(page);

    const textarea = page.locator('textarea[placeholder*="Message"]').first();
    const sendBtn = page.getByRole("button", { name: "Send", exact: true });
    const helper = page.getByText(/Press Enter to send/);

    await expect(textarea).toBeVisible();
    await expect(sendBtn).toBeVisible();
    await expect(helper).toBeVisible();

    const taBox = await textarea.boundingBox();
    const sendBox = await sendBtn.boundingBox();
    const helperBox = await helper.boundingBox();

    if (taBox && sendBox && helperBox) {
      // Send button is to the right of textarea on desktop (preserved).
      expect(sendBox.x).toBeGreaterThanOrEqual(taBox.x + taBox.width - 1);
      // Helper text is above the Send button (column layout preserved on desktop).
      expect(helperBox.y + helperBox.height).toBeLessThanOrEqual(sendBox.y + 2);
    }
  });
});
