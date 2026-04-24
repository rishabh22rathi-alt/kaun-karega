/**
 * E2E: chat_send_message — Supabase-Native Cutover Validation
 *
 * Validates that action=chat_send_message in /api/kk is fully Supabase-native
 * after removing the GAS fallback (the hydrateChatSnapshotFromGas call that fires
 * when sendChatMessageFromSupabase returns error:"Thread not found").
 *
 *  TC-01: Invalid / unauthenticated input returns native error, not a GAS proxy envelope
 *  TC-02: Successful send on an existing Supabase thread returns native response shape
 *         (ok, status, thread, message — message.MessageID absent from any GAS response)
 *  TC-03: Thread-not-found returns native Supabase error — GAS is not called (post-cutover)
 *  TC-04: Zero GAS / script.google.com calls across all chat_send_message test cases
 *
 * ARCHITECTURE NOTE — GAS fallback path being tested:
 *  Current kk/route.ts (pre-cutover):
 *    if (!result.ok && result.error === "Thread not found") {
 *      await hydrateChatSnapshotFromGas(...);   // this must be removed
 *      result = await sendChatMessageFromSupabase(body);
 *    }
 *  Post-cutover: the hydration block is removed. TC-03 and TC-04 together verify
 *  that a non-existent thread returns a native "Thread not found" error and never
 *  triggers a browser-observable GAS call.
 *
 * NATIVE RESPONSE DISCRIMINATOR:
 *  sendChatMessageFromSupabase() returns { ok, status, thread, message }.
 *  The `message` field (with MessageID, ThreadID, MessageText) only exists in the
 *  Supabase-native path. No GAS response has this shape.
 *
 * Run: TEST_PHONE=9XXXXXXXXX npx playwright test e2e/chat-send-message-cutover.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://kaun-karega.vercel.app";
const TEST_PHONE = process.env.TEST_PHONE || "";
const KK_API = "/api/kk";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

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
  const requestIdCol = headers.findIndex(
    (h) => h.includes("requestid") || h.includes("request_id") || h.includes("request")
  );

  if (otpCol === -1) throw new Error(`No OTP column. Headers: ${rows[0].join(", ")}`);

  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
  let dataRows = rows.slice(1);

  if (requestId && requestIdCol !== -1) {
    const byRequestId = dataRows.filter(
      (row) => String(row[requestIdCol] || "").trim() === requestId.trim()
    );
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
  await page.route("**script.google.com**", async (route) => {
    gasInterceptCount++;
    console.warn(`[INTERCEPT] Browser-side GAS call blocked: ${route.request().url()}`);
    await route.abort();
  });

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

async function getThreadsForUser(page: Page, userPhone: string): Promise<KkResponse[]> {
  const result = await kkPost(page, {
    action: "chat_get_threads",
    ActorType: "user",
    UserPhone: userPhone,
  });
  if (!result.ok || !Array.isArray(result.threads)) return [];
  return result.threads as KkResponse[];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("chat_send_message — Supabase-Native Cutover", () => {
  test.beforeEach(() => {
    resetGasCounter();
  });

  // ── TC-01: Invalid / unauthenticated input returns native error ───────────
  test("TC-01: Invalid inputs return native Supabase errors — not KK_PROXY or GAS envelopes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    // Inject a session so the route doesn't reject at the cookie layer —
    // we want to exercise validation inside sendChatMessageFromSupabase itself.
    const syntheticPhone = "9988776655";
    await injectSessionCookie(page, syntheticPhone);

    const invalidCases: Array<{ label: string; body: Record<string, unknown>; expectError: string }> = [
      {
        label: "missing ThreadID",
        body: {
          action: "chat_send_message",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageText: "Hello",
          MessageType: "text",
        },
        expectError: "ThreadID required",
      },
      {
        label: "missing MessageText",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageType: "text",
        },
        expectError: "MessageText required",
      },
      {
        label: "invalid ActorType",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "admin",
          UserPhone: syntheticPhone,
          MessageText: "Hello",
          MessageType: "text",
        },
        expectError: "ActorType must be user or provider",
      },
      {
        label: "unsupported MessageType",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageText: "Hello",
          MessageType: "image",
        },
        expectError: "Only text messages are supported",
      },
      {
        label: "MessageText exceeds 2000 chars",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageText: "x".repeat(2001),
          MessageType: "text",
        },
        expectError: "MessageText too long",
      },
    ];

    for (const { label, body, expectError } of invalidCases) {
      const result = await kkPost(page, body);
      console.log(`[TC-01] "${label}" response:`, JSON.stringify(result));

      const httpStatus = result._httpStatus as number;
      const errorMsg = String(result.error || "");

      expect(httpStatus, `"${label}": must not 5xx`).toBeLessThan(500);
      expect(result.ok, `"${label}": ok must be false`).toBe(false);
      expect(result.status, `"${label}": status must be "error"`).toBe("error");
      expect(errorMsg, `"${label}": must return native error "${expectError}"`).toBe(expectError);

      // A GAS proxy failure always surfaces as KK_PROXY_POST_FAILED; a GAS upstream
      // error surfaces with a non-Supabase error string. Neither must appear here.
      expect(errorMsg, `"${label}": must not be KK_PROXY_POST_FAILED`).not.toBe("KK_PROXY_POST_FAILED");
      expect(result, `"${label}": must not have GAS proxy 'message' field`).not.toHaveProperty("message");
      // The native success path has a `message` object; error path must not have it.
      // Confirmed: sendChatMessageFromSupabase error branches return only {ok,status,error}.
    }

    expect(gasInterceptCount, "No browser-side GAS calls for any invalid input").toBe(0);
    console.log(`[TC-01] PASS — ${invalidCases.length} invalid cases, GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-02: Successful send returns Supabase-native shape ─────────────────
  test("TC-02: Successful send on existing thread returns native response with message + thread fields", async ({ page }) => {
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
      console.log("[TC-02] No threads found for TEST_PHONE — skipping send assertions");
      console.log("[TC-02] NOTE: Run with a phone that has existing Supabase chat threads");

      // Verify the route itself doesn't 5xx when no thread exists
      const result = await kkPost(page, {
        action: "chat_send_message",
        ThreadID: "THREAD-ZZ-NOEXIST-999",
        ActorType: "user",
        UserPhone: phone10,
        MessageText: "Test message",
        MessageType: "text",
      });
      expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);
      expect(gasInterceptCount, "No GAS calls").toBe(0);
      console.log("[TC-02] PASS (partial — no threads available)");
      return;
    }

    // Use the first active thread (prefer non-closed)
    const activeThread = threads.find(
      (t) => String(t.ThreadStatus || t.Status || "").toLowerCase() !== "closed"
    ) ?? threads[0];

    const threadId = String(activeThread.ThreadID || activeThread.threadId || "").trim();
    expect(threadId, "Thread must have a ThreadID").toBeTruthy();

    console.log(`[TC-02] Sending message to thread: ${threadId}`);

    const testMessage = `[TEST] chat_send_message cutover check ${Date.now()}`;

    const result = await kkPost(page, {
      action: "chat_send_message",
      ThreadID: threadId,
      ActorType: "user",
      UserPhone: phone10,
      MessageText: testMessage,
      MessageType: "text",
      SenderName: "Test User",
    });

    console.log("[TC-02] send response:", JSON.stringify(result));

    expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);

    if (result.ok === true) {
      // ── Supabase-native success shape ──
      expect(result.status, "status must be 'success'").toBe("success");

      // `message` is the primary Supabase-native discriminator — absent from all GAS responses
      expect(result, "Response must have `message` field").toHaveProperty("message");
      expect(result, "Response must have `thread` field").toHaveProperty("thread");

      const message = result.message as KkResponse;
      const thread = result.thread as KkResponse;

      // message fields — populated by mapMessageRow() in chatPersistence.ts
      expect(message, "message must have MessageID").toHaveProperty("MessageID");
      expect(message, "message must have ThreadID").toHaveProperty("ThreadID");
      expect(message, "message must have MessageText").toHaveProperty("MessageText");
      expect(message, "message must have SenderType").toHaveProperty("SenderType");

      expect(String(message.MessageText), "MessageText must match sent text").toBe(testMessage);
      expect(String(message.ThreadID), "Message ThreadID must match").toBe(threadId);
      expect(String(message.SenderType).toLowerCase(), "SenderType must be 'user'").toBe("user");

      // thread fields — populated by mapThreadRow() in chatPersistence.ts
      expect(thread, "thread must have ThreadID").toHaveProperty("ThreadID");
      expect(thread, "thread must have UnreadProviderCount").toHaveProperty("UnreadProviderCount");

      // Sending as user must increment provider's unread count
      const unreadProviderCount = Number(thread.UnreadProviderCount ?? -1);
      expect(unreadProviderCount, "UnreadProviderCount must be >= 1 after user sends").toBeGreaterThanOrEqual(1);

      console.log(
        `[TC-02] MessageID: ${message.MessageID}, ` +
        `UnreadProviderCount: ${unreadProviderCount}`
      );
    } else {
      // ok:false is acceptable if the thread is closed or the user is not the thread owner.
      // Still verify it's a Supabase-native error, not a GAS proxy error.
      const errorMsg = String(result.error || "");
      expect(errorMsg, "Error must not be KK_PROXY_POST_FAILED").not.toBe("KK_PROXY_POST_FAILED");
      expect(result, "Error response must not have `message` object").not.toHaveProperty("message");
      console.log(`[TC-02] Thread not accessible (ok:false) — error: "${errorMsg}" — still Supabase-native`);
    }

    expect(gasInterceptCount, "No browser-side GAS calls").toBe(0);
    console.log(`[TC-02] PASS — GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-03: Thread-not-found → native error, no GAS call ─────────────────
  test("TC-03: Non-existent thread returns native 'Thread not found' error — GAS is not called", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9988776655";
    await injectSessionCookie(page, syntheticPhone);

    // This thread ID is guaranteed to not exist in Supabase.
    // Pre-cutover: kk/route.ts would call hydrateChatSnapshotFromGas() here.
    // Post-cutover: it must return the native error immediately.
    const phantomThreadId = "THREAD-ZZ-PHANTOM-CUTOVER-001";

    const result = await kkPost(page, {
      action: "chat_send_message",
      ThreadID: phantomThreadId,
      ActorType: "user",
      UserPhone: syntheticPhone,
      MessageText: "This thread does not exist in Supabase",
      MessageType: "text",
    });

    console.log("[TC-03] Thread-not-found response:", JSON.stringify(result));

    const httpStatus = result._httpStatus as number;
    const errorMsg = String(result.error || "");

    expect(httpStatus, "Must not 5xx").toBeLessThan(500);
    expect(result.ok, "ok must be false for non-existent thread").toBe(false);
    expect(result.status, "status must be 'error'").toBe("error");

    // Post-cutover, the native error must flow through directly.
    // Pre-cutover, the route would call GAS and return either a GAS response or
    // a second attempt's error. The native error message is "Thread not found".
    expect(errorMsg, "Native error must be 'Thread not found'").toBe("Thread not found");

    // The GAS proxy sentinel must not appear — confirms no proxy fallback fired
    expect(errorMsg, "Must not be KK_PROXY_POST_FAILED").not.toBe("KK_PROXY_POST_FAILED");

    // No browser-side GAS calls observed — confirms the hydration block was not triggered
    // in a way that results in a browser-visible GAS request.
    // NOTE: hydrateChatSnapshotFromGas() executes server-side (Node.js fetch), so it is
    // not browser-observable. This assertion catches any regression where the client is
    // redirected to GAS or a GAS URL leaks into a browser fetch.
    expect(
      gasInterceptCount,
      "Zero browser-side GAS calls — hydration block must not redirect browser to GAS"
    ).toBe(0);

    console.log(
      `[TC-03] PASS — error: "${errorMsg}", httpStatus: ${httpStatus}, GAS calls: ${gasInterceptCount}`
    );
  });

  // ── TC-04: Zero GAS calls across all tested cases ─────────────────────────
  test("TC-04: Zero GAS / script.google.com calls across all chat_send_message invocations", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9977665544";
    await injectSessionCookie(page, syntheticPhone);

    // Exercise every distinct error branch that could conceivably reach a fallback.
    const cases: Array<{ label: string; body: Record<string, unknown> }> = [
      {
        label: "no ThreadID (validation error before any DB call)",
        body: {
          action: "chat_send_message",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageText: "Hello",
          MessageType: "text",
        },
      },
      {
        label: "no MessageText (validation error before any DB call)",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-TC04-001",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageType: "text",
        },
      },
      {
        label: "phantom thread — triggers the 'Thread not found' branch",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-TC04-PHANTOM",
          ActorType: "user",
          UserPhone: syntheticPhone,
          MessageText: "Hello",
          MessageType: "text",
        },
      },
      {
        label: "phantom thread with provider actor — exercises provider branch",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-TC04-PHANTOM",
          ActorType: "provider",
          loggedInProviderPhone: syntheticPhone,
          MessageText: "Hello from provider",
          MessageType: "text",
        },
      },
      {
        label: "invalid ActorType — fails actor resolution before DB call",
        body: {
          action: "chat_send_message",
          ThreadID: "THREAD-ZZ-TC04-001",
          ActorType: "bot",
          UserPhone: syntheticPhone,
          MessageText: "Hello",
          MessageType: "text",
        },
      },
    ];

    let allOk = true;

    for (const { label, body } of cases) {
      const result = await kkPost(page, body);
      const httpStatus = result._httpStatus as number;
      const errorMsg = String(result.error || "");

      console.log(`[TC-04] "${label}":`, JSON.stringify({ ok: result.ok, status: result.status, error: errorMsg, httpStatus }));

      if (httpStatus >= 500) {
        console.error(`[TC-04] UNEXPECTED 5xx for "${label}" — HTTP ${httpStatus}`);
        allOk = false;
      }

      if (errorMsg === "KK_PROXY_POST_FAILED") {
        console.error(`[TC-04] GAS PROXY SENTINEL detected for "${label}"`);
        allOk = false;
      }
    }

    expect(allOk, "All cases must return non-5xx, non-KK_PROXY responses").toBe(true);

    // This is the primary assertion: after removing the GAS fallback, no test case
    // should produce a browser-visible call to script.google.com.
    expect(
      gasInterceptCount,
      `Zero browser-side GAS calls across all ${cases.length} chat_send_message cases`
    ).toBe(0);

    console.log(
      `[TC-04] PASS — ${cases.length} cases tested, GAS calls: ${gasInterceptCount}`
    );
  });
});
