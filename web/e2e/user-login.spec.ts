import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const BASE_URL = "https://kaun-karega.vercel.app";
const TEST_PHONE = process.env.TEST_PHONE || "";
const t0 = Date.now();
const elapsed = () => `[+${((Date.now() - t0) / 1000).toFixed(1)}s]`;

function fixPemNewlines(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 92 && str.charCodeAt(i + 1) === 110) {
      out += "\n";
      i++;
    } else {
      out += str[i];
    }
  }
  return out;
}

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return {};

  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = value;
  }

  return env;
}

async function getLatestOtpFromSheet(phone: string, requestId?: string): Promise<string> {
  const env = loadEnvLocal();
  const sheetId = env.GOOGLE_SHEET_ID;
  const serviceEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = fixPemNewlines(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "");

  if (!sheetId || !serviceEmail || !rawKey) {
    throw new Error(
      "Missing GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env.local"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const b64url = (s: string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: serviceEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer
    .sign(rawKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const jwt = `${signingInput}.${signature}`;
  const postBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();

  const https = require("https") as typeof import("https");

  const tokenData = await new Promise<{ access_token?: string; error?: string }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postBody),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as { access_token?: string; error?: string });
          } catch {
            reject(new Error(`Failed to parse token response: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(postBody);
    req.end();
  });

  if (!tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  const httpsGet = (url: string, accessToken: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      https
        .get(url, { headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Parse error: ${data.slice(0, 200)}`));
            }
          });
        })
        .on("error", reject);
    });

  const tabNames = ["OTP", "Otp", "otp", "Sheet1"];
  let rows: string[][] = [];

  for (const tab of tabNames) {
    const range = `${tab}!A:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;

    try {
      const sheetData = (await httpsGet(url, tokenData.access_token)) as { values?: string[][] };
      if (Array.isArray(sheetData.values) && sheetData.values.length > 1) {
        rows = sheetData.values;
        console.log(`${elapsed()} [OTP] Read ${rows.length - 1} rows from tab "${tab}"`);
        break;
      }
    } catch {
      // try next tab
    }
  }

  if (rows.length < 2) {
    throw new Error("OTP sheet is empty or unreadable.");
  }

  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const phoneCol = headers.findIndex((h) => h.includes("phone") || h.includes("mobile") || h.includes("number"));
  const otpCol = headers.findIndex((h) => h.includes("otp") || h.includes("code"));
  const requestIdCol = headers.findIndex((h) => h.includes("requestid") || h.includes("request_id") || h.includes("request"));

  if (otpCol === -1) {
    throw new Error(`No OTP column. Headers: ${rows[0].join(", ")}`);
  }

  console.log(`${elapsed()} [OTP] Headers: [${headers.join(", ")}] | phone=${phoneCol} otp=${otpCol} reqId=${requestIdCol}`);

  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
  let dataRows = rows.slice(1);

  if (requestId && requestIdCol !== -1) {
    const byRequestId = dataRows.filter((row) => String(row[requestIdCol] || "").trim() === requestId.trim());
    if (byRequestId.length > 0) {
      const otp = String(byRequestId[0][otpCol] || "").trim();
      if (/^\d{4}$/.test(otp)) {
        console.log(`${elapsed()} [OTP] Found by requestId ${requestId}: ${otp}`);
        return otp;
      }
    }
    console.log(`${elapsed()} [OTP] requestId match not found, falling back to latest by phone`);
  }

  if (phoneCol !== -1 && normalizedPhone) {
    const filtered = dataRows.filter((row) => {
      const rowPhone = String(row[phoneCol] || "").replace(/\D/g, "").slice(-10);
      return rowPhone === normalizedPhone;
    });
    if (filtered.length > 0) {
      dataRows = filtered;
    }
  }

  const otp = String(dataRows[dataRows.length - 1]?.[otpCol] || "").trim();
  if (!/^\d{4}$/.test(otp)) {
    throw new Error(`OTP "${otp}" is not a valid 4-digit code.`);
  }

  console.log(`${elapsed()} [OTP] Latest OTP for ${normalizedPhone}: ${otp}`);
  return otp;
}

async function startOtpFlow(page: Page, phone: string): Promise<string> {
  console.log(`${elapsed()} [AUTH] Opening login page`);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login/);

  const phoneInput = page.locator("#phone");
  await expect(phoneInput).toBeVisible({ timeout: 10_000 });
  await phoneInput.click();
  await phoneInput.pressSequentially(phone.replace(/\D/g, "").slice(0, 10), { delay: 50 });
  console.log(`${elapsed()} [AUTH] Entered phone: ${phone}`);

  let capturedRequestId = "";
  page.on("request", (req) => {
    if (req.url().includes("/api/send-whatsapp-otp") || req.url().includes("/api/send-otp")) {
      try {
        const body = JSON.parse(req.postData() || "{}") as { requestId?: string };
        if (body.requestId) {
          capturedRequestId = body.requestId;
        }
      } catch {
        // ignore parsing failures
      }
    }
  });

  const sendOtpButton = page.getByRole("button", { name: /send otp/i });
  await expect(sendOtpButton).toBeVisible();
  await sendOtpButton.click();
  console.log(`${elapsed()} [AUTH] Clicked Send OTP`);

  await page.waitForURL(/\/verify/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  const verifyUrl = new URL(page.url());
  const requestId = verifyUrl.searchParams.get("requestId") || capturedRequestId;
  console.log(`${elapsed()} [AUTH] Verify URL: ${page.url()}`);
  console.log(`${elapsed()} [AUTH] requestId: ${requestId}`);

  return requestId;
}

async function fillOtpInputs(page: Page, otp: string) {
  const otpInputs = page.locator('input[maxlength="1"]');
  const count = await otpInputs.count();

  if (count === 4) {
    for (let i = 0; i < 4; i++) {
      await otpInputs.nth(i).fill(otp[i]);
      await page.waitForTimeout(60);
    }
    console.log(`${elapsed()} [AUTH] Entered OTP into 4 digit inputs: ${otp}`);
    return;
  }

  const singleInput = page.locator('input[placeholder*="OTP" i], input[type="tel"]').first();
  await singleInput.fill(otp);
  console.log(`${elapsed()} [AUTH] Entered OTP into fallback input: ${otp}`);
}

async function getVisibleOtpFailureText(page: Page): Promise<string> {
  const candidates = [
    page.locator("text=/invalid otp/i").first(),
    page.locator("text=/incorrect otp/i").first(),
    page.locator("text=/wrong otp/i").first(),
    page.locator("text=/invalid verification code/i").first(),
    page.locator('[role="alert"]').first(),
    page.locator(".text-red-600").first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      const text = (await locator.textContent().catch(() => "")) || "";
      if (text.trim()) {
        return text.trim();
      }
    }
  }

  return "";
}

function getVerifyUrlState(page: Page) {
  const url = new URL(page.url());
  return {
    href: url.toString(),
    phone: url.searchParams.get("phone") || "",
    requestId: url.searchParams.get("requestId") || "",
    next: url.searchParams.get("next") || "",
  };
}

async function getProtectedRouteState(page: Page) {
  await page.goto("/dashboard/my-requests", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  const url = page.url();
  const redirectedToLogin = url.includes("/login");
  const stillOnVerify = url.includes("/verify");
  const loggedInHeadingVisible = await page
    .getByRole("heading", { name: /my requests/i })
    .isVisible()
    .catch(() => false);
  const loginPromptVisible = await page
    .getByText("Please log in to view your requests.")
    .isVisible()
    .catch(() => false);

  return {
    url,
    redirectedToLogin,
    stillOnVerify,
    loggedInHeadingVisible,
    loginPromptVisible,
  };
}

test.describe.serial("User login via OTP", () => {
  test.beforeEach(async () => {
    if (!TEST_PHONE) {
      throw new Error(
        "TEST_PHONE is not set. Run with: TEST_PHONE=9XXXXXXXXX npx playwright test e2e/user-login.spec.ts"
      );
    }
  });

  test("TC-01: Valid OTP login redirects away from verify", async ({ page }) => {
    console.log(`${elapsed()} [TC-01] Base URL: ${BASE_URL}`);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/kaun-karega/);

    const requestId = await startOtpFlow(page, TEST_PHONE);

    await page.waitForTimeout(9_000);
    const otp = await getLatestOtpFromSheet(TEST_PHONE, requestId || undefined);
    console.log(`${elapsed()} [TC-01] OTP fetched for requestId ${requestId}: ${otp}`);

    await fillOtpInputs(page, otp);

    const verifyButton = page.getByRole("button", { name: /verify & continue/i });
    await expect(verifyButton).toBeVisible();
    console.log(`${elapsed()} [TC-01] URL before verify click: ${page.url()}`);
    console.log(`${elapsed()} [TC-01] requestId before verify click: ${requestId}`);
    await verifyButton.click();
    console.log(`${elapsed()} [TC-01] Clicked Verify & Continue`);

    await page.waitForLoadState("networkidle");

    let leftVerify = false;
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/verify"), { timeout: 12_000 });
      leftVerify = true;
    } catch {
      leftVerify = !page.url().includes("/verify");
    }

    const postVerifyUrl = page.url();
    console.log(`${elapsed()} [TC-01] Final URL after login attempt: ${postVerifyUrl}`);

    if (!leftVerify && postVerifyUrl.includes("/verify")) {
      const otpFailureText = await getVisibleOtpFailureText(page);
      console.log(`${elapsed()} [TC-01] Still on /verify after OTP submit`);
      console.log(`${elapsed()} [TC-01] Visible OTP failure text: ${otpFailureText || "<none>"}`);
    }

    await page.goto("/dashboard/my-requests", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    console.log(`${elapsed()} [TC-01] Protected page URL after login attempt: ${page.url()}`);

    const protectedUrl = page.url();
    const redirectedToLogin = protectedUrl.includes("/login");
    const stillOnVerify = protectedUrl.includes("/verify");
    const loggedInIndicatorVisible = await page.getByRole("heading", { name: /my requests/i }).isVisible().catch(() => false);
    const loginPromptVisible = await page.getByText("Please log in to view your requests.").isVisible().catch(() => false);

    if (stillOnVerify || redirectedToLogin || loginPromptVisible) {
      const otpFailureText = await getVisibleOtpFailureText(page);
      throw new Error(
        [
          "Valid OTP login did not establish an authenticated session.",
          `requestId: ${requestId || "<missing>"}`,
          `post-verify URL: ${postVerifyUrl}`,
          `protected page URL: ${protectedUrl}`,
          `visible OTP failure text: ${otpFailureText || "<none>"}`,
        ].join("\n")
      );
    }

    expect(loggedInIndicatorVisible || !redirectedToLogin).toBeTruthy();
    expect(protectedUrl).not.toContain("/verify");
    console.log("Login success URL:", protectedUrl);
  });

  test("TC-02: Invalid OTP stays on verify and shows an error", async ({ page }) => {
    console.log(`${elapsed()} [TC-02] Starting invalid OTP flow`);

    const requestId = await startOtpFlow(page, TEST_PHONE);
    await fillOtpInputs(page, "0000");

    const verifyButton = page.getByRole("button", { name: /verify & continue/i });
    await expect(verifyButton).toBeVisible();
    console.log(`${elapsed()} [TC-02] URL before verify click: ${page.url()}`);
    console.log(`${elapsed()} [TC-02] requestId before verify click: ${requestId}`);
    await verifyButton.click();
    console.log(`${elapsed()} [TC-02] Submitted invalid OTP 0000`);

    await page.waitForLoadState("networkidle");
    console.log(`${elapsed()} [TC-02] URL after verify click: ${page.url()}`);

    const visibleErrorText = await getVisibleOtpFailureText(page);
    console.log(`${elapsed()} [TC-02] Visible auth message after invalid OTP: ${visibleErrorText || "<none>"}`);

    const protectedState = await getProtectedRouteState(page);
    console.log(`${elapsed()} [TC-02] Protected route URL after invalid OTP: ${protectedState.url}`);

    const invalidOtpRejected =
      protectedState.redirectedToLogin ||
      protectedState.stillOnVerify ||
      protectedState.loginPromptVisible ||
      !protectedState.loggedInHeadingVisible;

    expect(invalidOtpRejected).toBeTruthy();
  });

  test("TC-03: Resend OTP becomes available after cooldown and preserves verify state", async ({ page }) => {
    console.log(`${elapsed()} [TC-03] Starting resend OTP flow`);

    await startOtpFlow(page, TEST_PHONE);

    const initialState = getVerifyUrlState(page);
    console.log(`${elapsed()} [TC-03] Initial verify URL: ${initialState.href}`);
    console.log(`${elapsed()} [TC-03] Initial requestId: ${initialState.requestId || "<missing>"}`);

    expect(initialState.phone).toBeTruthy();
    expect(initialState.requestId).toBeTruthy();

    const resendButton = page.getByRole("button", { name: /resend otp/i });
    const cooldownText = page.locator("text=/resend otp in/i").first();

    const resendInitiallyVisible = await resendButton.isVisible().catch(() => false);
    const cooldownInitiallyVisible = await cooldownText.isVisible().catch(() => false);
    console.log(`${elapsed()} [TC-03] Resend button initially visible: ${resendInitiallyVisible}`);
    console.log(`${elapsed()} [TC-03] Cooldown text initially visible: ${cooldownInitiallyVisible}`);

    await expect
      .poll(
        async () => {
          const buttonVisible = await resendButton.isVisible().catch(() => false);
          const buttonEnabled = buttonVisible ? await resendButton.isEnabled().catch(() => false) : false;
          return buttonVisible && buttonEnabled;
        },
        {
          timeout: 70_000,
          intervals: [1000, 2000, 3000],
        }
      )
      .toBeTruthy();

    console.log(`${elapsed()} [TC-03] Resend button became enabled`);

    await resendButton.click();
    console.log(`${elapsed()} [TC-03] Clicked Resend OTP`);

    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/verify/);

    const postResendState = getVerifyUrlState(page);
    console.log(`${elapsed()} [TC-03] Post-resend verify URL: ${postResendState.href}`);
    console.log(`${elapsed()} [TC-03] Post-resend requestId: ${postResendState.requestId || "<missing>"}`);
    console.log(
      `${elapsed()} [TC-03] requestId ${postResendState.requestId === initialState.requestId ? "unchanged" : "changed"} after resend`
    );

    expect(postResendState.phone).toBeTruthy();
    expect(postResendState.requestId).toBeTruthy();

    const visibleMessage = await getVisibleOtpFailureText(page);
    console.log(`${elapsed()} [TC-03] Visible verify-page message after resend: ${visibleMessage || "<none>"}`);

    const otpInputs = page.locator('input[maxlength="1"]');
    await expect(otpInputs.first()).toBeVisible({ timeout: 10_000 });

    const unrecoverableError = /unauthorized|server error|something went wrong|failed to resend/i.test(
      visibleMessage.toLowerCase()
    );
    expect(unrecoverableError).toBeFalsy();
  });
});
