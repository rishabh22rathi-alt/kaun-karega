import type { Page } from "@playwright/test";

import { gotoPath } from "../_support/home";
import { mockJson } from "../_support/routes";
import { test, expect } from "../_support/test";

const VERIFY_URL = "/verify?phone=9876543210&requestId=otp-paste-req&next=%2F";

function allowExpectedGuestNoise(diag: {
  allowHttpError: (p: RegExp) => void;
  allowConsoleError: (p: RegExp) => void;
}): void {
  diag.allowHttpError(/\/api\/auth\/whoami.*401/i);
  diag.allowConsoleError(
    /Failed to load resource: the server responded with a status of 401/i
  );
}

async function mockVerifyPageApis(page: Page): Promise<void> {
  await mockJson(page, /\/api\/auth\/whoami/, {
    status: 401,
    body: { ok: false, reason: "no-session" },
  });
  await mockJson(page, "**/api/send-whatsapp-otp", {
    body: { ok: true, message: "OTP sent successfully", requestId: "otp-paste-req" },
  });
}

async function pasteIntoOtp(page: Page, text: string): Promise<void> {
  const input = page.getByLabel("Enter OTP");
  await input.click();
  await input.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
  }, text);
}

async function expectOtpValue(page: Page, value: string): Promise<void> {
  await expect(page.getByLabel("Enter OTP")).toHaveValue(value);
  await expect(page.getByText(/Application error/i)).toHaveCount(0);
}

test.describe("Auth: OTP paste input", () => {
  test.use({ baseURL: "http://127.0.0.1:3000" });

  test("pastes full 4-digit OTP on /verify", async ({ page, diag }) => {
    allowExpectedGuestNoise(diag);
    await mockVerifyPageApis(page);

    await gotoPath(page, VERIFY_URL);
    await pasteIntoOtp(page, "1234");
    await expectOtpValue(page, "1234");

    diag.assertClean();
  });

  test("pastes OTP with spaces on /verify", async ({ page, diag }) => {
    allowExpectedGuestNoise(diag);
    await mockVerifyPageApis(page);

    await gotoPath(page, VERIFY_URL);
    await pasteIntoOtp(page, "1 2 3 4");
    await expectOtpValue(page, "1234");

    diag.assertClean();
  });

  test("pastes OTP from message text on /verify", async ({ page, diag }) => {
    allowExpectedGuestNoise(diag);
    await mockVerifyPageApis(page);

    await gotoPath(page, VERIFY_URL);
    await pasteIntoOtp(page, "Your OTP is 1234");
    await expectOtpValue(page, "1234");

    diag.assertClean();
  });

  test("manual typing still works on /verify", async ({ page, diag }) => {
    allowExpectedGuestNoise(diag);
    await mockVerifyPageApis(page);

    await gotoPath(page, VERIFY_URL);
    await page.getByLabel("Enter OTP").fill("1234");
    await expectOtpValue(page, "1234");

    diag.assertClean();
  });

  test("submit calls existing /api/verify-otp endpoint with normalized OTP", async ({
    page,
    diag,
  }) => {
    allowExpectedGuestNoise(diag);
    await mockVerifyPageApis(page);

    let verifyBody: Record<string, unknown> | null = null;
    await page.route("**/api/verify-otp", async (route) => {
      verifyBody = JSON.parse(route.request().postData() || "{}") as Record<
        string,
        unknown
      >;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Invalid OTP" }),
      });
    });

    await gotoPath(page, VERIFY_URL);
    await pasteIntoOtp(page, "Your OTP is 1234");
    await page.getByRole("button", { name: /verify & continue/i }).click();

    await expect.poll(() => verifyBody).not.toBeNull();
    expect(verifyBody).toMatchObject({
      phoneNumber: "919876543210",
      requestId: "otp-paste-req",
      otp: "1234",
    });

    diag.assertClean();
  });

  test("mobile viewport paste normalizes OTP text", async ({ page, diag }) => {
    allowExpectedGuestNoise(diag);
    await page.setViewportSize({ width: 390, height: 844 });
    await mockVerifyPageApis(page);

    await gotoPath(page, VERIFY_URL);
    await pasteIntoOtp(page, "Your OTP is 1234");
    await expectOtpValue(page, "1234");

    diag.assertClean();
  });

  test("/otp route also accepts pasted OTP text", async ({ page, diag }) => {
    allowExpectedGuestNoise(diag);
    await mockVerifyPageApis(page);

    await gotoPath(page, "/otp?phone=9876543210&requestId=otp-paste-req");
    await pasteIntoOtp(page, "Your OTP is 1234");
    await expectOtpValue(page, "1234");

    diag.assertClean();
  });
});
