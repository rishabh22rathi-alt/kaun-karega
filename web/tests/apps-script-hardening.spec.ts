import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const BASE_URL = "http://localhost:3000";
const APPS_SCRIPT_PATTERNS = ["script.google.com", "/macros/"];

function createAuthSessionCookie(phone = "9876543210") {
  return {
    name: "kk_auth_session",
    value: encodeURIComponent(
      JSON.stringify({
        phone,
        verified: true,
        createdAt: Date.now(),
      })
    ),
    url: BASE_URL,
  };
}

function getAppsScriptRequests(requestUrls: string[]) {
  return requestUrls.filter((url) =>
    APPS_SCRIPT_PATTERNS.some((pattern) => url.includes(pattern))
  );
}

function assertNoAppsScriptCalls(requestUrls: string[]) {
  const appsScriptRequests = getAppsScriptRequests(requestUrls);
  expect(
    appsScriptRequests,
    `Browser should never call Apps Script directly. Found: ${appsScriptRequests.join(", ")}`
  ).toEqual([]);
}

function expectInternalApiRequest(requestUrls: string[], path: string) {
  const matchingRequests = requestUrls.filter((url) => url.includes(path));
  expect(
    matchingRequests.length,
    `Expected browser request through internal API route ${path}. Recorded requests: ${requestUrls.join(", ")}`
  ).toBeGreaterThan(0);
}

async function openHomepageOnMobile(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL);
  await expect(page.getByLabel("Open menu")).toBeVisible();
}

async function fillHomepageServiceFlow(page: Page) {
  const categoryInput = page
    .locator('input[placeholder*="service" i], input[placeholder*="what service" i], input[type="text"]')
    .first();

  await categoryInput.click();
  await categoryInput.fill("Electrician");
  await page.waitForTimeout(500);

  const electricianSuggestion = page.getByRole("button", { name: /Electrician/i }).first();
  if (await electricianSuggestion.isVisible().catch(() => false)) {
    await electricianSuggestion.click();
  }

  const todayButton = page.getByRole("button", { name: /^Today$/i }).first();
  await expect(todayButton).toBeVisible();
  await todayButton.click();

  const sardarpuraOption = page.getByRole("button", { name: /Sardarpura/i }).first();
  await expect(sardarpuraOption).toBeVisible();
  await sardarpuraOption.click();
}

test.describe("Apps Script hardening", () => {
  test("Homepage load makes no direct Apps Script browser requests", async ({ page }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await openHomepageOnMobile(page);
    await page.waitForTimeout(1500);

    assertNoAppsScriptCalls(requestUrls);
  });

  test("Sidebar interaction still avoids direct Apps Script browser requests", async ({ page }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await openHomepageOnMobile(page);
    await page.getByLabel("Open menu").click();
    await page.waitForTimeout(1200);

    assertNoAppsScriptCalls(requestUrls);
  });

  test("Category and area selection uses no direct Apps Script browser requests", async ({
    page,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await openHomepageOnMobile(page);
    await fillHomepageServiceFlow(page);
    await page.waitForTimeout(1500);

    assertNoAppsScriptCalls(requestUrls);
  });

  test("Show numbers flow goes through /api/find-provider and not Apps Script", async ({
    page,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    const findProviderRequest = page.waitForRequest((request) =>
      request.url().includes("/api/find-provider")
    );

    await page.goto(`${BASE_URL}/success?service=Electrician&area=Sardarpura`);
    await expect(
      page.getByRole("button", { name: /Show Service Provider Numbers/i })
    ).toBeVisible();
    await page.getByRole("button", { name: /Show Service Provider Numbers/i }).click();
    await findProviderRequest;
    await page.waitForTimeout(1000);

    expectInternalApiRequest(requestUrls, "/api/find-provider");
    assertNoAppsScriptCalls(requestUrls);
  });

  test("Provider profile fetch goes through /api/provider/dashboard-profile and not Apps Script", async ({
    page,
    context,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await context.addCookies([createAuthSessionCookie()]);

    const providerProfileRequest = page.waitForRequest((request) =>
      request.url().includes("/api/provider/dashboard-profile")
    );

    await openHomepageOnMobile(page);
    await page.getByLabel("Open menu").click();
    await providerProfileRequest;
    await page.waitForTimeout(1200);

    expectInternalApiRequest(requestUrls, "/api/provider/dashboard-profile");
    assertNoAppsScriptCalls(requestUrls);
  });
});
