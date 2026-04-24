import { bootstrapProviderSession, bootstrapUserSession } from "../_support/auth";
import {
  QA_PROVIDER_MESSAGE,
  QA_THREAD_ID,
  QA_USER_MESSAGE,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import {
  mockProviderDashboardApis,
  mockUserRequestsApis,
} from "../_support/scenarios";
import { test, expect } from "../_support/test";

test.describe("Chat: user and provider threads", () => {
  test("user chat threads load, mark as read, and send follow-up messages", async ({
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

    // Purpose: verify the user-side thread can still load and send messages after native chat migration.
    await gotoPath(page, `/chat/thread/${QA_THREAD_ID}?actor=user`);

    await expect(
      page.getByRole("heading", { name: /provider conversation/i })
    ).toBeVisible();
    await expect(page.getByText("Viewing as: User")).toBeVisible();
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

  test("provider chat threads deep-link into provider mode and send provider replies", async ({
    page,
    diag,
  }) => {
    await bootstrapProviderSession(page);
    await mockProviderDashboardApis(page);

    // Purpose: guard the provider-mode deep-link and actor-specific header/UI state.
    await gotoPath(page, `/chat/thread/${QA_THREAD_ID}`);

    await expect(
      page.getByRole("heading", { name: /customer conversation/i })
    ).toBeVisible();
    await expect(page.getByText("Viewing as: Provider")).toBeVisible();
    const providerReply = `${QA_PROVIDER_MESSAGE} follow-up`;
    await page.locator('textarea[placeholder*="Message user"]').fill(providerReply);
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText(providerReply)).toBeVisible();

    diag.assertClean();
  });

  test("chat deep links enforce the correct guest redirect target for each actor", async ({
    page,
    diag,
  }) => {
    // Purpose: keep actor-specific route protection intact for copied WhatsApp and in-app links.
    await gotoPath(page, `/chat/thread/${QA_THREAD_ID}?actor=user`);
    await expect(page).toHaveURL(
      new RegExp(`/login\\?next=%2Fchat%2Fthread%2F${QA_THREAD_ID}%3Factor%3Duser`)
    );

    await gotoPath(page, `/chat/thread/${QA_THREAD_ID}`);
    await expect(page).toHaveURL(
      new RegExp(`/provider/login\\?next=%2Fchat%2Fthread%2F${QA_THREAD_ID}$`)
    );

    diag.assertClean();
  });

  test("access-controlled threads show a clear denial state instead of a silent failure", async ({
    page,
    diag,
  }) => {
    await bootstrapUserSession(page);
    await mockUserRequestsApis(page, { chatAccessDenied: true });
    diag.allowConsoleError(/403 \(Forbidden\)/i);
    diag.allowHttpError(/POST .*\/api\/kk 403/i);

    // Purpose: keep authorization failures user-visible and debuggable.
    await gotoPath(page, `/chat/thread/${QA_THREAD_ID}?actor=user`);

    await expect(
      page.getByText("Access denied. This chat thread does not belong to the logged-in account.")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/dashboard/my-requests"
    );

    diag.assertClean();
  });
});
