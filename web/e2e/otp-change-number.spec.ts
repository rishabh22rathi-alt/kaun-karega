/**
 * OTP verify screens — "Wrong number? Change number" affordance.
 *
 * Both /verify and /otp now render a small secondary action under the
 * "Code sent to …" line. Clicking it:
 *   - clears local OTP/requestId/phone/cooldown/error/message state
 *   - navigates to /login (preserving any `next` redirect param)
 *   - does NOT log the user out (no session is written before successful
 *     verification anyway, and we don't touch the cookie either way)
 *
 * Both verify screens auto-fire /api/send-whatsapp-otp on mount when a
 * `phone` query param is present — we mock that endpoint so the tests
 * are deterministic and don't hit WhatsApp.
 */

import type { Page } from "@playwright/test";

import { mockJson, jsonOk } from "./_support/routes";
import { test, expect } from "./_support/test";

async function mockSendOtp(page: Page) {
  await mockJson(page, "**/api/send-whatsapp-otp**", jsonOk({}));
}

test.describe("OTP verify — Change number affordance", () => {
  test("/verify shows phone, surfaces Change number, returns to /login preserving next", async ({
    page,
  }) => {
    await mockSendOtp(page);
    await page.goto(
      "/verify?phone=9999999911&requestId=qa-req-001&next=%2Fi-need%2Fpost",
      { waitUntil: "domcontentloaded" }
    );

    // The header should echo back the 10-digit number from the query.
    await expect(
      page.getByText(/Code sent to/).filter({ hasText: "+91 9999999911" })
    ).toBeVisible({ timeout: 5_000 });

    const changeNumber = page.getByTestId("kk-verify-change-number");
    await expect(changeNumber).toBeVisible();

    await changeNumber.click();

    // We land on /login with the original `next` preserved and no
    // residual phone / requestId in the URL.
    await page.waitForURL(/\/login\?next=%2Fi-need%2Fpost$/, {
      timeout: 5_000,
    });
    expect(page.url()).toContain("/login?next=");
    expect(page.url()).not.toContain("phone=");
    expect(page.url()).not.toContain("requestId=");

    // /login renders the phone-entry form so a corrected number can be
    // requested without reload.
    await expect(
      page.locator('input[placeholder="Enter 10-digit WhatsApp number"]')
    ).toBeVisible({ timeout: 5_000 });
  });

  test("/verify Change number works without a next param (defaults to /)", async ({
    page,
  }) => {
    await mockSendOtp(page);
    await page.goto("/verify?phone=9999999911&requestId=qa-req-002", {
      waitUntil: "domcontentloaded",
    });

    // Wait for the auto-fire send-OTP cooldown text so we know the page
    // has fully hydrated and the cooldown setState has flushed; clicking
    // mid-hydration was racing the router.replace in the previous run.
    await expect(page.getByText(/Resend OTP in/)).toBeVisible({
      timeout: 5_000,
    });

    await page.getByTestId("kk-verify-change-number").click();
    await page.waitForURL(/\/login\?next=%2F$/, { timeout: 5_000 });
  });

  test("/verify Change number does not clobber an existing session cookie", async ({
    page,
  }) => {
    // Seed a session cookie (mirrors a returning user re-verifying).
    await page.context().addCookies([
      {
        name: "kk_auth_session",
        value: encodeURIComponent(
          JSON.stringify({
            phone: "9999999911",
            verified: true,
            createdAt: Date.now(),
          })
        ),
        url: "http://127.0.0.1:3000/",
        sameSite: "Lax",
      },
    ]);

    await mockSendOtp(page);
    await page.goto("/verify?phone=9999999911&requestId=qa-req-003", {
      waitUntil: "domcontentloaded",
    });

    await page.getByTestId("kk-verify-change-number").click();
    await page.waitForURL(/\/login/, { timeout: 5_000 });

    const cookies = await page.context().cookies();
    const auth = cookies.find((c) => c.name === "kk_auth_session");
    expect(auth, "session cookie must survive Change number").toBeTruthy();
  });

  test("/otp shows phone, surfaces Change number, returns to /login", async ({
    page,
  }) => {
    await mockSendOtp(page);
    await page.goto("/otp?phone=9999999912&requestId=qa-req-004", {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByText(/Code sent to/).filter({ hasText: "+91 9999999912" })
    ).toBeVisible({ timeout: 5_000 });

    const changeNumber = page.getByTestId("kk-otp-change-number");
    await expect(changeNumber).toBeVisible();
    await changeNumber.click();

    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).not.toContain("phone=");
    expect(page.url()).not.toContain("requestId=");
  });
});

/**
 * MANUAL TEST NOTES
 * -----------------
 * 1. Open /login on a fresh browser, enter a phone (e.g. 9876500001),
 *    submit. You land on /verify with that number echoed in the header.
 * 2. The line "Wrong number? Change number" sits directly under the
 *    "Code sent to +91 9876500001" text.
 * 3. Click "Change number" → you return to /login. The phone input is
 *    empty (state cleared). The `next` query param, if any, is preserved.
 * 4. Enter a corrected number (e.g. 9876500002) and submit. /verify
 *    re-renders with the new number; a fresh requestId is generated.
 * 5. If a user was already logged in (rare — re-auth flow), running
 *    through Change number does NOT log them out — only the unverified
 *    phone/requestId state is dropped. The signed session cookie is
 *    untouched.
 * 6. Same flow works on /otp (the alternate verify route).
 */
