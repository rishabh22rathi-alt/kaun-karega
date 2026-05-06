import type { Page, Route } from "@playwright/test";

import { bootstrapUserSession } from "../_support/auth";
import { test, expect } from "../_support/test";

const QA_USER_PHONE = "9888800001";
const THREAD_ID = "ZZ-PATCH6C-THREAD-1";
const TASK_ID = "ZZ-PATCH6C-TASK-1";

type KkBody = {
  action?: string;
};

const baseThread = {
  ThreadID: THREAD_ID,
  TaskID: TASK_ID,
  DisplayID: "T-PATCH6C",
  UserPhone: QA_USER_PHONE,
  ProviderID: "ZZ-PROV-PATCH6C",
  Status: "active",
  LastMessageAt: new Date().toISOString(),
};

function makeMessage(id: string, sender: "user" | "provider", text: string, secondsAgo: number) {
  return {
    MessageID: id,
    ThreadID: THREAD_ID,
    TaskID: TASK_ID,
    SenderType: sender,
    MessageText: text,
    CreatedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
    ReadByUser: "yes",
    ReadByProvider: "yes",
  };
}

// Build a long backlog so the scroll container actually has overflow.
const initialMessages = Array.from({ length: 30 }, (_, i) =>
  makeMessage(`M${i + 1}`, i % 2 === 0 ? "user" : "provider", `Message ${i + 1}`, 600 - i * 10)
);
const incomingMessage = makeMessage("M-NEW", "provider", "New message from provider", 1);
const userSentMessage = makeMessage("M-USER-SENT", "user", "Hello from user", 1);

type ScenarioState = {
  pollCount: number;
  appendIncoming: boolean;
  appendUserSent: boolean;
};

async function setupChat(page: Page, state: ScenarioState) {
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
      state.pollCount += 1;
      const list = [...initialMessages];
      if (state.appendIncoming) list.push(incomingMessage);
      if (state.appendUserSent) list.push(userSentMessage);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, thread: baseThread, messages: list }),
      });
      return;
    }

    if (action === "chat_send_message") {
      // Mark that the user just sent — next refresh will include it.
      state.appendUserSent = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (action === "chat_mark_read") {
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

  await bootstrapUserSession(page, QA_USER_PHONE);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/chat/thread/${THREAD_ID}?actor=user`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('textarea[placeholder*="Message"]')).toBeVisible({ timeout: 5_000 });
}

async function readScrollState(page: Page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("div"));
    const scroll = candidates.find((el) => {
      const cs = getComputedStyle(el);
      return cs.overflowY === "auto" && parseFloat(cs.height) > 200;
    });
    if (!scroll) return null;
    return {
      scrollTop: scroll.scrollTop,
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
    };
  });
}

async function setScrollTop(page: Page, value: number) {
  await page.evaluate((target) => {
    const candidates = Array.from(document.querySelectorAll("div"));
    const scroll = candidates.find((el) => {
      const cs = getComputedStyle(el);
      return cs.overflowY === "auto" && parseFloat(cs.height) > 200;
    });
    if (!scroll) return;
    scroll.scrollTop = target;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, value);
}

async function waitForPollCount(state: ScenarioState, target: number, timeoutMs = 12_000) {
  const start = Date.now();
  while (state.pollCount < target) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pollCount did not reach ${target} within ${timeoutMs}ms (got ${state.pollCount})`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.describe("PATCH 6C — chat auto-scroll gating", () => {
  test("user near bottom — incoming poll keeps view pinned to bottom", async ({ page }) => {
    const state: ScenarioState = { pollCount: 0, appendIncoming: false, appendUserSent: false };
    await setupChat(page, state);

    // Initial auto-scroll should land near bottom.
    await expect.poll(async () => {
      const s = await readScrollState(page);
      return s ? s.scrollHeight - s.scrollTop - s.clientHeight : -1;
    }, { timeout: 5_000 }).toBeLessThanOrEqual(20);

    // Trigger an incoming poll.
    state.appendIncoming = true;
    const startedPolls = state.pollCount;
    await waitForPollCount(state, startedPolls + 1, 12_000);

    // After the poll, still pinned to bottom (within tolerance).
    await expect.poll(async () => {
      const s = await readScrollState(page);
      return s ? s.scrollHeight - s.scrollTop - s.clientHeight : -1;
    }, { timeout: 3_000 }).toBeLessThanOrEqual(20);
  });

  test("user scrolled up — incoming poll does NOT snap to bottom", async ({ page }) => {
    const state: ScenarioState = { pollCount: 0, appendIncoming: false, appendUserSent: false };
    await setupChat(page, state);

    // Wait for initial auto-scroll, then scroll to top.
    await expect.poll(async () => {
      const s = await readScrollState(page);
      return s ? s.scrollHeight - s.scrollTop - s.clientHeight : -1;
    }, { timeout: 5_000 }).toBeLessThanOrEqual(20);

    await setScrollTop(page, 0);
    const before = await readScrollState(page);
    expect(before?.scrollTop ?? -1).toBeLessThan(20);

    // Trigger an incoming poll.
    state.appendIncoming = true;
    const startedPolls = state.pollCount;
    await waitForPollCount(state, startedPolls + 1, 12_000);

    // After the poll, scroll position should still be near the top.
    await page.waitForTimeout(300);
    const after = await readScrollState(page);
    expect(after?.scrollTop ?? -1).toBeLessThan(50);
  });

  test("user scrolled up — sending a message auto-scrolls to bottom", async ({ page }) => {
    const state: ScenarioState = { pollCount: 0, appendIncoming: false, appendUserSent: false };
    await setupChat(page, state);

    await expect.poll(async () => {
      const s = await readScrollState(page);
      return s ? s.scrollHeight - s.scrollTop - s.clientHeight : -1;
    }, { timeout: 5_000 }).toBeLessThanOrEqual(20);

    await setScrollTop(page, 0);
    const before = await readScrollState(page);
    expect(before?.scrollTop ?? -1).toBeLessThan(20);

    // Send a message via the composer.
    const textarea = page.locator('textarea[placeholder*="Message"]').first();
    await textarea.fill("Hello from user");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // After send, the auto-scroll should snap to bottom regardless of prior scroll.
    await expect.poll(async () => {
      const s = await readScrollState(page);
      return s ? s.scrollHeight - s.scrollTop - s.clientHeight : -1;
    }, { timeout: 5_000 }).toBeLessThanOrEqual(20);
  });
});
