import { bootstrapProviderSession, bootstrapUserSession } from "../_support/auth";
import { QA_TASK_ID, QA_THREAD_ID, QA_USER_PHONE } from "../_support/data";
import {
  completeHomeRequestFlow,
  gotoPath,
} from "../_support/home";
import { mockCommonCatalogRoutes, mockJson } from "../_support/routes";
import {
  mockProviderDashboardApis,
  mockUserRequestsApis,
} from "../_support/scenarios";
import { envFlag } from "../_support/runtime";
import { test, expect } from "../_support/test";

const APPS_SCRIPT_PATTERNS = ["script.google.com", "/macros/"];

function getAppsScriptRequests(urls: string[]): string[] {
  return urls.filter((url) =>
    APPS_SCRIPT_PATTERNS.some((pattern) => url.toLowerCase().includes(pattern))
  );
}

function expectNoAppsScriptRequests(urls: string[], label: string): void {
  expect(
    getAppsScriptRequests(urls),
    `${label} should never call Apps Script directly from the browser.`
  ).toEqual([]);
}

test.describe("Migration: hardening and contract coverage", () => {
  test("public and provider flows stay on internal routes instead of browser-side Apps Script calls", async ({
    page,
    diag,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await mockCommonCatalogRoutes(page);

    // Purpose: verify migrated public interactions stay on internal APIs in the browser.
    await gotoPath(page, "/");
    await completeHomeRequestFlow(page, {
      service: "Electrician",
      time: "Today",
      area: "Sardarpura",
      details: "Need a quick migration audit check.",
    });

    expect(requestUrls.some((url) => url.includes("/api/categories"))).toBeTruthy();
    expect(requestUrls.some((url) => url.includes("/api/areas"))).toBeTruthy();
    expectNoAppsScriptRequests(requestUrls, "Homepage flow");

    requestUrls.length = 0;

    await mockProviderDashboardApis(page);
    await bootstrapProviderSession(page);
    await gotoPath(page, "/provider/dashboard");

    expect(requestUrls.some((url) => url.includes("/api/provider/dashboard-profile"))).toBeTruthy();
    expect(requestUrls.some((url) => url.includes("/api/kk"))).toBeTruthy();
    expectNoAppsScriptRequests(requestUrls, "Provider dashboard flow");

    diag.assertClean();
  });

  test("chat and success-page matching flows continue to use internal native endpoints", async ({
    page,
    diag,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await mockUserRequestsApis(page);
    await bootstrapUserSession(page);
    await gotoPath(page, `/chat/thread/${QA_THREAD_ID}?actor=user`);
    await expect(page.getByText("Viewing as: User")).toBeVisible();

    expect(requestUrls.some((url) => url.includes("/api/kk"))).toBeTruthy();
    expectNoAppsScriptRequests(requestUrls, "Chat flow");

    requestUrls.length = 0;

    await mockJson(page, "**/api/process-task-notifications**", {
      status: 200,
      body: { ok: true, matchedProviders: 0, attemptedSends: 0, failedSends: 0 },
    });
    await mockJson(page, "**/api/find-provider**", {
      status: 200,
      body: { ok: true, count: 0, providers: [] },
    });
    await gotoPath(page, "/success?service=Electrician&area=Sardarpura&taskId=TK-QA-0001");
    await page.waitForTimeout(3200);
    await page.getByRole("button", { name: /show service provider numbers/i }).click();

    expect(requestUrls.some((url) => url.includes("/api/process-task-notifications"))).toBeTruthy();
    expect(requestUrls.some((url) => url.includes("/api/find-provider"))).toBeTruthy();
    expectNoAppsScriptRequests(requestUrls, "Success page flow");

    diag.assertClean();
  });

  test.skip(
    !envFlag("PLAYWRIGHT_LIVE_CONTRACTS"),
    "Live contract checks require a seeded local environment."
  );

  test("critical migrated endpoints keep returning JSON contracts in a live environment", async ({
    request,
  }) => {
    // Purpose: keep a live scaffold for route contracts that cannot be fully proven with browser mocks alone.
    const chatRes = await request.post("/api/kk", {
      data: {
        action: "chat_get_messages",
        ActorType: "user",
        ThreadID: "missing-thread",
        UserPhone: QA_USER_PHONE,
      },
    });
    expect(chatRes.headers()["content-type"]).toContain("application/json");
    const chatText = await chatRes.text();
    expect(chatText).not.toMatch(/script\.google\.com|\/macros\//i);

    const matchRes = await request.post("/api/find-provider", {
      data: {
        category: "Electrician",
        area: "Sardarpura",
        taskId: QA_TASK_ID,
        userPhone: QA_USER_PHONE,
        limit: 5,
      },
    });
    expect(matchRes.headers()["content-type"]).toContain("application/json");

    const notifyRes = await request.post("/api/process-task-notifications", {
      data: {
        taskId: QA_TASK_ID,
      },
    });
    expect(notifyRes.headers()["content-type"]).toContain("application/json");
  });
});
