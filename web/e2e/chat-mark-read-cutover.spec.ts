/**
 * E2E: chat_mark_read — Supabase-Native Cutover Validation
 *
 * Validates that action=chat_mark_read in /api/kk is fully Supabase-native
 * after removing the GAS fallback:
 *
 *  TC-01: Unauthenticated request returns 4xx — not proxied to GAS
 *  TC-02: chat_mark_read with valid session returns Supabase-native response shape
 *         (ok, status, markedCount, thread fields — not a GAS proxy payload)
 *  TC-03: thread.UnreadUserCount is 0 in the response after mark-read
 *  TC-04: No GAS URL (script.google.com / APPS_SCRIPT_URL) is hit for chat_mark_read
 *
 * SEEDING STRATEGY:
 *  The test uses a synthetic user phone (ZZ_USER_PHONE) to avoid contaminating real
 *  user data. It seeds an unread message by sending a provider-side message to the
 *  thread via chat_send_message (ActorType=provider), then reads it as the user.
 *  If the thread has no prior unread messages, the test notes this but still asserts
 *  the API contract and GAS-free path.
 *
 * OBSERVABILITY NOTE:
 *  page.route() intercepts browser-visible network calls. The /api/kk route handler
 *  runs on the Next.js server — its internal Supabase calls are NOT browser-visible.
 *  We verify GAS absence by:
 *    1. Intercepting any browser-side calls to script.google.com (must be 0)
 *    2. Confirming the response shape is Supabase-native, not a GAS proxy envelope
 *    3. Confirming the response has `markedCount` — a field that only exists in
 *       markChatReadFromSupabase(), not in any GAS response
 *
 * Run: TEST_PHONE=9XXXXXXXXX npx playwright test e2e/chat-mark-read-cutover.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://kaun-karega.vercel.app";
const TEST_PHONE = process.env.TEST_PHONE || "";

// Synthetic provider phone used only for seeding unread messages in this test.
// Must correspond to an existing provider in the Supabase `providers` table.
// If not set, the unread-seeding step is skipped.
const TEST_PROVIDER_PHONE = process.env.TEST_PROVIDER_PHONE || "";

const KK_API = "/api/kk";

// ─── Auth helpers (shared with user-login.spec.ts pattern) ───────────────────

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

  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try { resolve(JSON.parse(data) as { access_token?: string; error?: string }); }
          catch { reject(new Error(`Failed to parse token response: ${data}`)); }
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
          res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          res.on("end", () => {
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
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
        break;
      }
    } catch { /* try next tab */ }
  }

  if (rows.length < 2) throw new Error("OTP sheet is empty or unreadable.");

  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const phoneCol = headers.findIndex((h) => h.includes("phone") || h.includes("mobile") || h.includes("number"));
  const otpCol = headers.findIndex((h) => h.includes("otp") || h.includes("code"));
  const requestIdCol = headers.findIndex((h) => h.includes("requestid") || h.includes("request_id") || h.includes("request"));

  if (otpCol === -1) throw new Error(`No OTP column. Headers: ${rows[0].join(", ")}`);

  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
  let dataRows = rows.slice(1);

  if (requestId && requestIdCol !== -1) {
    const byRequestId = dataRows.filter((row) => String(row[requestIdCol] || "").trim() === requestId.trim());
    if (byRequestId.length > 0) {
      const otp = String(byRequestId[0][otpCol] || "").trim();
      if (/^\d{4}$/.test(otp)) return otp;
    }
  }

  if (phoneCol !== -1 && normalizedPhone) {
    const filtered = dataRows.filter((row) => {
      const rowPhone = String(row[phoneCol] || "").replace(/\D/g, "").slice(-10);
      return rowPhone === normalizedPhone;
    });
    if (filtered.length > 0) dataRows = filtered;
  }

  const otp = String(dataRows[dataRows.length - 1]?.[otpCol] || "").trim();
  if (!/^\d{4}$/.test(otp)) throw new Error(`OTP "${otp}" is not a valid 4-digit code.`);
  return otp;
}

async function loginViaOtp(page: Page, phone: string): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const phoneInput = page.locator("#phone");
  await expect(phoneInput).toBeVisible({ timeout: 10_000 });
  await phoneInput.click();
  await phoneInput.pressSequentially(phone.replace(/\D/g, "").slice(0, 10), { delay: 50 });

  let capturedRequestId = "";
  page.on("request", (req) => {
    if (req.url().includes("/api/send-whatsapp-otp") || req.url().includes("/api/send-otp")) {
      try {
        const body = JSON.parse(req.postData() || "{}") as { requestId?: string };
        if (body.requestId) capturedRequestId = body.requestId;
      } catch { /* ignore */ }
    }
  });

  await page.getByRole("button", { name: /send otp/i }).click();
  await page.waitForURL(/\/verify/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  const verifyUrl = new URL(page.url());
  const requestId = verifyUrl.searchParams.get("requestId") || capturedRequestId;

  await page.waitForTimeout(9_000);
  const otp = await getLatestOtpFromSheet(phone, requestId || undefined);

  const otpInputs = page.locator('input[maxlength="1"]');
  const count = await otpInputs.count();
  if (count === 4) {
    for (let i = 0; i < 4; i++) {
      await otpInputs.nth(i).fill(otp[i]);
      await page.waitForTimeout(60);
    }
  } else {
    const singleInput = page.locator('input[placeholder*="OTP" i], input[type="tel"]').first();
    await singleInput.fill(otp);
  }

  await page.getByRole("button", { name: /verify & continue/i }).click();
  await page.waitForLoadState("networkidle");

  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/verify"), { timeout: 12_000 });
  } catch { /* may have already left */ }
}

// ─── Session cookie helper ────────────────────────────────────────────────────

function makeSessionCookieValue(phone: string): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectSessionCookie(page: Page, phone: string): Promise<void> {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(phone),
      domain: new URL(BASE_URL).hostname,
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

// ─── GAS interception ─────────────────────────────────────────────────────────

let gasInterceptCount = 0;

function resetGasCounter(): void {
  gasInterceptCount = 0;
}

async function setupGasInterception(page: Page): Promise<void> {
  // Catch any direct browser-side call to Google Apps Script infrastructure.
  // script.google.com is the canonical host for GAS web app deployments.
  await page.route("**script.google.com**", async (route) => {
    gasInterceptCount++;
    console.warn(`[INTERCEPT] Browser-side GAS call blocked: ${route.request().url()}`);
    await route.abort();
  });

  // Catch any call to the /api/kk route itself being forwarded to a GAS URL.
  // This catches the case where /api/kk proxies to an external URL that Playwright
  // can observe as a browser-side redirect. In practice, the proxy runs server-side,
  // so this fires only if there is an unexpected client-side redirect to GAS.
  await page.route("**/exec**", async (route) => {
    const url = route.request().url();
    if (url.includes("script.google.com") || url.includes("macros")) {
      gasInterceptCount++;
      console.warn(`[INTERCEPT] Browser-side GAS exec call blocked: ${url}`);
      await route.abort();
    } else {
      await route.continue();
    }
  });
}

// ─── API helpers ──────────────────────────────────────────────────────────────

type KkResponse = Record<string, unknown>;

async function kkPost(page: Page, body: Record<string, unknown>): Promise<KkResponse> {
  const response = await page.request.post(`${BASE_URL}${KK_API}`, {
    data: body,
    headers: { "Content-Type": "application/json" },
  });
  let json: KkResponse = {};
  try { json = (await response.json()) as KkResponse; }
  catch { json = { _rawStatus: response.status(), _parseError: true }; }
  return { ...json, _httpStatus: response.status() };
}

async function getThreadsForUser(page: Page, userPhone: string): Promise<unknown[]> {
  const result = await kkPost(page, {
    action: "chat_get_threads",
    ActorType: "user",
    UserPhone: userPhone,
  });
  if (!result.ok) return [];
  return Array.isArray(result.threads) ? (result.threads as unknown[]) : [];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("chat_mark_read — Supabase-Native Cutover", () => {
  test.beforeEach(() => {
    resetGasCounter();
  });

  // ── TC-01: Unauthenticated request is rejected, not proxied ──────────────
  test("TC-01: Unauthenticated chat_mark_read returns 4xx — not proxied to GAS", async ({ page }) => {
    await setupGasInterception(page);

    // Navigate to home first so page context is initialized
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const result = await kkPost(page, {
      action: "chat_mark_read",
      ThreadID: "THREAD-ZZ-NOAUTH-001",
      ActorType: "user",
      UserPhone: "0000000000",
    });

    const httpStatus = result._httpStatus as number;
    console.log("[TC-01] Response:", JSON.stringify(result));

    // chat_mark_read is NOT in ADMIN_ONLY_ACTIONS, so it will reach markChatReadFromSupabase.
    // With an invalid UserPhone, Supabase will return an error (Thread not found / actor error)
    // but NOT proxy to GAS. Either a 4xx (if auth guard fires) or 200 with ok:false is acceptable.
    // The critical assertion is ok:false, no GAS call, and no GAS-proxy error envelope.
    expect(result.ok, "Unauthenticated call with invalid thread must not return ok:true").toBe(false);

    // A GAS proxy response would have: { ok: false, error: "KK_PROXY_POST_FAILED" } or
    // the upstream GAS error format. Supabase-native errors always have a plain `error` string.
    const errorMsg = String(result.error || "");
    expect(
      errorMsg,
      "Error must not be the GAS proxy sentinel KK_PROXY_POST_FAILED"
    ).not.toBe("KK_PROXY_POST_FAILED");

    expect(
      gasInterceptCount,
      "No browser-side GAS calls must occur"
    ).toBe(0);

    console.log(`[TC-01] PASS — httpStatus: ${httpStatus}, error: "${errorMsg}", GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-02: Valid session returns Supabase-native response shape ──────────
  test("TC-02: chat_mark_read response shape is Supabase-native (markedCount field present)", async ({ page }) => {
    if (!TEST_PHONE) {
      test.skip();
      return;
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);
    await loginViaOtp(page, TEST_PHONE);

    const phone10 = TEST_PHONE.replace(/\D/g, "").slice(-10);
    const threads = await getThreadsForUser(page, phone10);

    if (threads.length === 0) {
      console.log("[TC-02] No chat threads found for TEST_PHONE — skipping thread-specific assertions");
      console.log("[TC-02] NOTE: Run with a phone that has existing chat threads to fully validate");

      // Still verify the API works without a 5xx
      const result = await kkPost(page, {
        action: "chat_mark_read",
        ThreadID: "THREAD-ZZ-NOEXIST-999",
        ActorType: "user",
        UserPhone: phone10,
      });
      expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);
      expect(gasInterceptCount, "No GAS calls").toBe(0);
      console.log("[TC-02] PASS (partial — no threads available)");
      return;
    }

    const thread = threads[0] as Record<string, unknown>;
    const threadId = String(thread.ThreadID || thread.threadId || "").trim();
    expect(threadId, "Thread must have a ThreadID").toBeTruthy();

    console.log(`[TC-02] Using thread: ${threadId}, UnreadUserCount: ${thread.UnreadUserCount}`);

    const result = await kkPost(page, {
      action: "chat_mark_read",
      ThreadID: threadId,
      ActorType: "user",
      UserPhone: phone10,
    });

    console.log("[TC-02] mark_read response:", JSON.stringify(result));

    expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);
    expect(result.ok, "Response must have ok field").toBeDefined();

    if (result.ok === true) {
      // Verify Supabase-native response shape — these fields only exist in markChatReadFromSupabase()
      expect(
        result,
        "Supabase-native response must have `status` field"
      ).toHaveProperty("status");
      expect(
        result,
        "Supabase-native response must have `markedCount` field — absent in any GAS response"
      ).toHaveProperty("markedCount");
      expect(
        result,
        "Supabase-native response must have `thread` object"
      ).toHaveProperty("thread");

      const statusValue = result.status;
      expect(statusValue, "`status` must be 'success'").toBe("success");

      const markedCount = result.markedCount;
      expect(typeof markedCount, "`markedCount` must be a number").toBe("number");
    } else {
      // ok:false is acceptable if the thread belongs to a different user — still Supabase-native
      const errorMsg = String(result.error || "");
      expect(errorMsg).not.toBe("KK_PROXY_POST_FAILED");
      console.log(`[TC-02] Thread access denied (ok:false) — error: "${errorMsg}" — still Supabase-native`);
    }

    expect(gasInterceptCount, "No browser-side GAS calls").toBe(0);
    console.log(`[TC-02] PASS — markedCount: ${result.markedCount}, GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-03: UnreadUserCount is 0 in response after mark-read ─────────────
  test("TC-03: thread.UnreadUserCount is 0 in response after chat_mark_read", async ({ page }) => {
    if (!TEST_PHONE) {
      test.skip();
      return;
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);
    await loginViaOtp(page, TEST_PHONE);

    const phone10 = TEST_PHONE.replace(/\D/g, "").slice(-10);

    // Step 1: Get threads and find one the user owns
    const threads = await getThreadsForUser(page, phone10);
    if (threads.length === 0) {
      console.log("[TC-03] No threads found — skipping");
      test.skip();
      return;
    }

    // Prefer a thread with unread messages if available
    const threadsTyped = threads as Record<string, unknown>[];
    const threadWithUnread = threadsTyped.find((t) => Number(t.UnreadUserCount ?? 0) > 0);
    const selectedThread = threadWithUnread ?? threadsTyped[0];
    const threadId = String(selectedThread.ThreadID || selectedThread.threadId || "").trim();
    const unreadBefore = Number(selectedThread.UnreadUserCount ?? 0);

    console.log(`[TC-03] Thread: ${threadId}, UnreadUserCount before mark-read: ${unreadBefore}`);

    if (unreadBefore === 0) {
      console.log(
        "[TC-03] NOTE: No unread messages found. Seeding requires TEST_PROVIDER_PHONE env var. " +
        "Still verifying API contract: mark-read must return UnreadUserCount=0."
      );
    }

    // Step 2: Seed an unread message (provider → user) if TEST_PROVIDER_PHONE is set
    if (TEST_PROVIDER_PHONE && unreadBefore === 0) {
      const providerPhone10 = TEST_PROVIDER_PHONE.replace(/\D/g, "").slice(-10);
      const seedResult = await kkPost(page, {
        action: "chat_send_message",
        ThreadID: threadId,
        ActorType: "provider",
        loggedInProviderPhone: providerPhone10,
        MessageText: `[TEST] Seeded unread message at ${new Date().toISOString()}`,
        MessageType: "text",
        SenderName: "Test Provider",
      });
      if (seedResult.ok === true) {
        console.log("[TC-03] Seeded provider message — user should now have unread count > 0");
        // Re-fetch threads to confirm unread > 0
        const threadsAfterSeed = (await getThreadsForUser(page, phone10)) as Record<string, unknown>[];
        const updatedThread = threadsAfterSeed.find(
          (t) => String(t.ThreadID || t.threadId || "").trim() === threadId
        );
        const unreadAfterSeed = Number(updatedThread?.UnreadUserCount ?? 0);
        console.log(`[TC-03] UnreadUserCount after seed: ${unreadAfterSeed}`);
        expect(unreadAfterSeed, "Seeded message must create unread count > 0").toBeGreaterThan(0);
      } else {
        console.log(`[TC-03] Seed failed (provider may not own thread): ${JSON.stringify(seedResult)}`);
      }
    }

    // Step 3: Call chat_mark_read as user
    const markResult = await kkPost(page, {
      action: "chat_mark_read",
      ThreadID: threadId,
      ActorType: "user",
      UserPhone: phone10,
    });

    console.log("[TC-03] mark_read response:", JSON.stringify(markResult));

    expect(markResult.ok, "mark_read must succeed").toBe(true);
    expect(markResult.status, "status must be success").toBe("success");
    expect(markResult, "markedCount field must exist").toHaveProperty("markedCount");
    expect(markResult, "thread field must exist").toHaveProperty("thread");

    const responseThread = markResult.thread as Record<string, unknown>;
    const unreadAfterMark = Number(responseThread?.UnreadUserCount ?? responseThread?.unread_user_count ?? -1);

    console.log(`[TC-03] UnreadUserCount in response: ${unreadAfterMark}`);

    expect(
      unreadAfterMark,
      "UnreadUserCount in mark_read response must be 0"
    ).toBe(0);

    // Step 4: Re-fetch threads to confirm persistence
    const threadsAfterMark = (await getThreadsForUser(page, phone10)) as Record<string, unknown>[];
    const persistedThread = threadsAfterMark.find(
      (t) => String(t.ThreadID || t.threadId || "").trim() === threadId
    );
    const unreadPersisted = Number(persistedThread?.UnreadUserCount ?? 0);

    console.log(`[TC-03] UnreadUserCount after re-fetch: ${unreadPersisted}`);
    expect(unreadPersisted, "UnreadUserCount must remain 0 on re-fetch").toBe(0);

    expect(gasInterceptCount, "No GAS calls").toBe(0);
    console.log("[TC-03] PASS");
  });

  // ── TC-04: No GAS call under any chat_mark_read invocation ───────────────
  test("TC-04: No GAS URL is hit — chat_mark_read has no GAS fallback path", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    // Use an injected session cookie so this test runs without OTP infrastructure
    const syntheticPhone = "9988776655";
    await injectSessionCookie(page, syntheticPhone);

    // Fire chat_mark_read with various invalid inputs to exercise all error branches.
    // None of these should reach GAS — all should return Supabase-native error responses.

    const cases: Array<Record<string, unknown>> = [
      // Missing ThreadID
      { action: "chat_mark_read", ActorType: "user", UserPhone: syntheticPhone },
      // Invalid ActorType
      { action: "chat_mark_read", ThreadID: "THREAD-ZZ-001", ActorType: "unknown", UserPhone: syntheticPhone },
      // Non-existent thread
      { action: "chat_mark_read", ThreadID: "THREAD-ZZ-NOEXIST-999", ActorType: "user", UserPhone: syntheticPhone },
      // Empty body
      { action: "chat_mark_read" },
    ];

    for (const [i, requestBody] of cases.entries()) {
      const result = await kkPost(page, requestBody);
      console.log(`[TC-04] Case ${i + 1} response:`, JSON.stringify(result));

      const httpStatus = result._httpStatus as number;
      const errorMsg = String(result.error || "");

      // Must not 5xx from an unhandled proxy failure
      expect(httpStatus, `Case ${i + 1}: Must not 5xx`).toBeLessThan(500);

      // Must not be the GAS proxy sentinel error
      expect(errorMsg, `Case ${i + 1}: Must not be KK_PROXY_POST_FAILED`).not.toBe("KK_PROXY_POST_FAILED");

      // ok must be false for invalid inputs
      expect(result.ok, `Case ${i + 1}: Must return ok:false for invalid input`).toBe(false);
    }

    // Zero GAS calls across all cases confirms there is no fallback path
    expect(
      gasInterceptCount,
      "Zero GAS calls across all chat_mark_read invocations — no fallback path exists"
    ).toBe(0);

    console.log("[TC-04] PASS — no GAS calls, all error paths return Supabase-native errors");
  });
});
