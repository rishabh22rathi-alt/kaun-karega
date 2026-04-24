import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_ID,
  QA_PROVIDER_NAME,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { test, expect } from "../_support/test";

const EXPECTED_TOAST = "You are already registered. Redirecting to dashboard...";

type JsonResult = {
  status?: number;
  body: unknown;
};

type KkCallLog = {
  action: string;
  requestPayload: Record<string, unknown>;
  responseStatus: number;
  responseBody: unknown;
};

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function collectObservedUiState(
  page: Page,
  kkCalls: KkCallLog[],
  browserConsoleErrors: string[]
) {
  const saveButton = page.getByRole("button", { name: /save changes|submitting/i }).first();
  const toastVisible = await page
    .getByText(EXPECTED_TOAST, { exact: true })
    .isVisible()
    .catch(() => false);

  return {
    url: page.url(),
    saveButtonVisible: await saveButton.isVisible().catch(() => false),
    saveButtonEnabled: await saveButton.isEnabled().catch(() => false),
    nameValue: await page
      .locator('input[placeholder="Enter your full name"]')
      .inputValue()
      .catch(() => ""),
    submitErrors: await page
      .locator(".text-red-600, .text-red-700")
      .allTextContents()
      .catch(() => []),
    toastVisible,
    bodyText: await page
      .locator("body")
      .innerText()
      .then((text) => text.slice(0, 2000))
      .catch(() => ""),
    kkCalls,
    browserConsoleErrors,
  };
}

async function failWithObservedUiState(
  page: Page,
  reason: string,
  kkCalls: KkCallLog[],
  browserConsoleErrors: string[]
): Promise<never> {
  const observed = await collectObservedUiState(page, kkCalls, browserConsoleErrors);
  console.log("[provider edit save] observed UI state:", JSON.stringify(observed, null, 2));
  throw new Error(`${reason}\nObserved UI state: ${JSON.stringify(observed, null, 2)}`);
}

test.describe("Provider: edit profile save", () => {
  test("already-registered provider sees success toast and redirects to dashboard", async ({
    page,
  }) => {
    const kkCalls: KkCallLog[] = [];
    const browserConsoleErrors: string[] = [];
    const dashboardResponse = buildProviderDashboardResponse();
    const provider = {
      ProviderID: QA_PROVIDER_ID,
      ProviderName: QA_PROVIDER_NAME,
      Phone: QA_PROVIDER_PHONE,
      Verified: "yes",
      OtpVerified: "yes",
      PendingApproval: "no",
      Status: "active",
      Services: [{ Category: QA_CATEGORY }],
      Areas: [{ Area: QA_AREA }],
    };

    const recordKkCall = (
      action: string,
      requestPayload: Record<string, unknown>,
      result: JsonResult
    ): JsonResult => {
      kkCalls.push({
        action,
        requestPayload,
        responseStatus: result.status ?? 200,
        responseBody: result.body,
      });
      return result;
    };

    page.on("console", (message) => {
      if (message.type() === "error") {
        browserConsoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      browserConsoleErrors.push(`[pageerror] ${error.message}`);
    });

    await bootstrapProviderSession(page);
    await mockJson(
      page,
      "**/api/categories**",
      jsonOk({
        data: COMMON_CATEGORIES.map((category) => ({
          name: category.name,
          active: category.active,
        })),
      })
    );
    await mockJson(page, "**/api/provider/dashboard-profile**", {
      status: 200,
      body: dashboardResponse,
    });
    await mockKkActions(page, {
      get_areas: ({ body, action }) =>
        recordKkCall(action, body, jsonOk({ areas: COMMON_AREAS })),
      get_provider_by_phone: ({ body, action }) =>
        recordKkCall(action, body, jsonOk({ provider })),
      get_my_needs: ({ body, action }) =>
        recordKkCall(action, body, jsonOk({ needs: [] })),
      chat_get_threads: ({ body, action }) =>
        recordKkCall(action, body, jsonOk({ threads: [] })),
      provider_register: ({ body, action }) =>
        recordKkCall(action, body, {
          status: 409,
          body: { ok: false, error: "already_registered" },
        }),
    });

    await gotoPath(page, "/provider/register?edit=services");

    await expect(page.getByText("Edit Provider Profile")).toBeVisible();
    await expect(page.locator('input[placeholder="Enter your full name"]')).toHaveValue(
      QA_PROVIDER_NAME.toUpperCase()
    );

    const saveButton = page.getByRole("button", { name: "Save Changes" });
    await expect(saveButton).toBeEnabled();

    const providerRegisterRequestPromise = page.waitForRequest((request) => {
      return (
        request.url().includes("/api/kk") &&
        request.method() === "POST" &&
        (request.postData() || "").includes('"provider_register"')
      );
    });
    const providerRegisterResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/kk") &&
        response.request().method() === "POST" &&
        (response.request().postData() || "").includes('"provider_register"')
      );
    });

    await saveButton.click();

    const providerRegisterRequest = await providerRegisterRequestPromise;
    const providerRegisterResponse = await providerRegisterResponsePromise;
    const kkRequestPayload = tryParseJson(providerRegisterRequest.postData() || "{}");
    const kkResponseStatus = providerRegisterResponse.status();
    const kkResponseText = await providerRegisterResponse.text();
    const kkResponseBody = tryParseJson(kkResponseText);

    console.log(
      "[provider edit save] /api/kk request payload:",
      JSON.stringify(kkRequestPayload, null, 2)
    );
    console.log("[provider edit save] /api/kk response status:", kkResponseStatus);
    console.log(
      "[provider edit save] /api/kk response body:",
      JSON.stringify(kkResponseBody, null, 2)
    );

    let toastAppeared = true;
    try {
      await expect(page.getByText(EXPECTED_TOAST, { exact: true })).toBeVisible({
        timeout: 2500,
      });
    } catch {
      toastAppeared = false;
    }

    console.log(
      "[provider edit save] browser console errors:",
      JSON.stringify(browserConsoleErrors, null, 2)
    );

    if (!toastAppeared) {
      await failWithObservedUiState(
        page,
        `Expected toast "${EXPECTED_TOAST}" to appear after already_registered response.`,
        kkCalls,
        browserConsoleErrors
      );
    }

    let redirected = true;
    try {
      await page.waitForURL(/\/provider\/dashboard(?:[?#]|$)/, { timeout: 5000 });
    } catch {
      redirected = false;
    }

    if (!redirected) {
      await failWithObservedUiState(
        page,
        `Expected redirect to /provider/dashboard after already_registered response, but final URL was ${page.url()}.`,
        kkCalls,
        browserConsoleErrors
      );
    }

    expect(toastAppeared).toBe(true);
    await expect(page).toHaveURL(/\/provider\/dashboard(?:[?#]|$)/);
  });
});
