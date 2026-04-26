import { bootstrapUserSession } from "../_support/auth";
import {
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_NAME,
  QA_PROVIDER_PHONE,
  QA_REQUEST_DETAILS,
  QA_THREAD_ID,
  QA_USER_MESSAGE,
  buildUserRequest,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockUserRequestsApis } from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("User: requests and request status UX", () => {
  test("my requests renders task details, responses, and opens the user chat thread", async ({
    page,
    diag,
  }) => {
    const kkRequestBodies: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/kk")) {
        kkRequestBodies.push(request.postData() || "");
      }
    });

    await bootstrapUserSession(page);
    await mockUserRequestsApis(page);

    // Purpose: verify the core post-login request history remains readable and actionable.
    await gotoPath(page, "/dashboard/my-requests");

    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();
    await expect(page.getByText(QA_CATEGORY)).toBeVisible();
    await expect(page.getByText(QA_AREA)).toBeVisible();
    await expect(page.getByText(QA_REQUEST_DETAILS)).toBeVisible();
    await expect(page.getByText("Provider responded")).toBeVisible();

    await page.getByRole("button", { name: /view responses/i }).click();
    await expect(page.getByText(QA_PROVIDER_NAME)).toBeVisible();
    await expect(page.getByRole("link", { name: QA_PROVIDER_PHONE })).toBeVisible();

    await page.getByRole("button", { name: /open chat/i }).click();

    await expect(page).toHaveURL(new RegExp(`/chat/thread/${QA_THREAD_ID}\\?actor=user`));
    await expect(
      page.getByRole("heading", { name: /provider conversation/i })
    ).toBeVisible();

    await page.locator('textarea[placeholder*="Message provider"]').fill(QA_USER_MESSAGE);
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText(QA_USER_MESSAGE)).toBeVisible();

    expect(
      kkRequestBodies.some((body) => body.includes('"action":"chat_mark_read"'))
    ).toBeTruthy();
    expect(
      kkRequestBodies.some((body) => body.includes('"action":"chat_send_message"'))
    ).toBeTruthy();

    diag.assertClean();
  });

  test("no_providers_matched requests show a friendly zero-match state instead of dead controls", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockUserRequestsApis(page, {
      requests: [
        buildUserRequest({
          Status: "no_providers_matched",
          MatchedProviders: [],
          MatchedProviderDetails: [],
          RespondedProvider: "",
          RespondedProviderName: "",
        }),
      ],
      globalThreads: [],
      taskThreads: [],
    });

    // Purpose: keep the no-match branch user-friendly after Supabase matching changes.
    await gotoPath(page, "/dashboard/my-requests");

    await expect(
      page.getByText("No providers available in your area yet")
    ).toBeVisible();

    await page.getByRole("button", { name: /view responses/i }).click();
    await expect(page.getByText("No matched providers yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: /open chat/i })).toHaveCount(0);

    diag.assertClean();
  });
});
