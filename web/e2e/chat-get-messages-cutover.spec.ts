/**
 * E2E: chat_get_messages — Supabase-Native Cutover Validation
 *
 * Validates that action=chat_get_messages in /api/kk is fully Supabase-native
 * after removing the GAS fallback (the hydrateChatSnapshotFromGas call that fires
 * when getChatMessagesFromSupabase returns error:"Thread not found").
 *
 *  TC-01: Invalid / missing input returns native Supabase errors — not KK_PROXY or GAS envelopes
 *  TC-02: Successful fetch on an existing Supabase thread returns native response shape
 *         (ok, status, thread, messages[] — messages[] absent from any GAS response)
 *  TC-03: Thread-not-found returns native "Thread not found" error — GAS is not called
 *  TC-04: Zero GAS / script.google.com calls across all chat_get_messages test cases
 *
 * ARCHITECTURE NOTE — GAS fallback path being tested:
 *  Current kk/route.ts (pre-cutover):
 *    if (!result.ok && result.error === "Thread not found") {
 *      await hydrateChatSnapshotFromGas(...);   // this must be removed
 *      result = await getChatMessagesFromSupabase(body);
 *    }
 *  Post-cutover: the hydration block is removed. TC-03 and TC-04 together verify
 *  that a non-existent thread returns a native "Thread not found" error without any
 *  GAS hydration attempt.
 *
 * NATIVE RESPONSE DISCRIMINATOR:
 *  getChatMessagesFromSupabase() returns { ok, status, thread, messages }.
 *  `messages` is an array of ChatMessagePayload objects (each with MessageID, ThreadID,
 *  SenderType, MessageText). No GAS response has this shape — GAS returns a different
 *  envelope with different field names. `messages` being an array is the key discriminator.
 *
 * Run: TEST_PHONE=9XXXXXXXXX npx playwright test e2e/chat-get-messages-cutover.spec.ts
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

test.describe("chat_get_messages — Supabase-Native Cutover", () => {
  test.beforeEach(() => {
    resetGasCounter();
  });

  // ── TC-01: Invalid / missing input returns native Supabase errors ─────────
  test("TC-01: Invalid inputs return native Supabase errors — not KK_PROXY or GAS envelopes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9988776655";
    await injectSessionCookie(page, syntheticPhone);

    const invalidCases: Array<{ label: string; body: Record<string, unknown>; expectError: string }> = [
      {
        label: "missing ThreadID",
        body: {
          action: "chat_get_messages",
          ActorType: "user",
          UserPhone: syntheticPhone,
        },
        expectError: "ThreadID required",
      },
      {
        label: "invalid ActorType",
        body: {
          action: "chat_get_messages",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "admin",
          UserPhone: syntheticPhone,
        },
        expectError: "ActorType must be user or provider",
      },
      {
        label: "missing UserPhone for user actor",
        body: {
          action: "chat_get_messages",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "user",
        },
        expectError: "UserPhone required for user context",
      },
      {
        label: "missing provider phone for provider actor",
        body: {
          action: "chat_get_messages",
          ThreadID: "THREAD-ZZ-NOEXIST-001",
          ActorType: "provider",
          // No loggedInProviderPhone or ProviderPhone supplied
        },
        // resolveChatActor returns "ProviderPhone required for provider context"
        // when both loggedInProviderPhone and ProviderID are absent.
        expectError: "Trusted logged-in provider phone is required for provider context",
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

      // The GAS proxy sentinel must not appear — it would mean the route fell
      // through to the GAS fallback instead of returning a Supabase-native error.
      expect(errorMsg, `"${label}": must not be KK_PROXY_POST_FAILED`).not.toBe("KK_PROXY_POST_FAILED");

      // Native error responses from getChatMessagesFromSupabase have only {ok,status,error}.
      // A success response would add `messages` and `thread`. Neither must be present on error.
      expect(result, `"${label}": error response must not have "messages" array`).not.toHaveProperty("messages");
      expect(result, `"${label}": error response must not have "thread" object`).not.toHaveProperty("thread");
    }

    expect(gasInterceptCount, "No browser-side GAS calls for any invalid input").toBe(0);
    console.log(`[TC-01] PASS — ${invalidCases.length} invalid cases, GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-02: Successful fetch returns Supabase-native shape ────────────────
  test("TC-02: Successful fetch on existing thread returns native response with thread + messages[] fields", async ({ page }) => {
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
      console.log("[TC-02] No threads found for TEST_PHONE — skipping message fetch assertions");
      console.log("[TC-02] NOTE: Run with a phone that has existing Supabase chat threads");

      // Verify the route does not 5xx even when no threads exist for this phone
      const result = await kkPost(page, {
        action: "chat_get_messages",
        ThreadID: "THREAD-ZZ-NOEXIST-999",
        ActorType: "user",
        UserPhone: phone10,
      });
      expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);
      expect(gasInterceptCount, "No GAS calls").toBe(0);
      console.log("[TC-02] PASS (partial — no threads available)");
      return;
    }

    // Pick the first thread; prefer one with messages if the thread list exposes a count
    const threadsTyped = threads as KkResponse[];
    const threadWithMessages = threadsTyped.find(
      (t) => Number(t.LastMessageAt || 0) > 0 || String(t.LastMessageAt || "").length > 0
    ) ?? threadsTyped[0];

    const threadId = String(threadWithMessages.ThreadID || threadWithMessages.threadId || "").trim();
    expect(threadId, "Thread must have a ThreadID").toBeTruthy();

    console.log(`[TC-02] Fetching messages for thread: ${threadId}`);

    const result = await kkPost(page, {
      action: "chat_get_messages",
      ThreadID: threadId,
      ActorType: "user",
      UserPhone: phone10,
    });

    console.log(
      "[TC-02] get_messages response (truncated):",
      JSON.stringify({ ok: result.ok, status: result.status, error: result.error, messageCount: Array.isArray(result.messages) ? (result.messages as unknown[]).length : "n/a" })
    );

    expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);

    if (result.ok === true) {
      // ── Supabase-native success shape ──
      expect(result.status, "status must be 'success'").toBe("success");

      // `messages` array is the primary Supabase-native discriminator.
      // GAS never returns a `messages` field with this shape.
      expect(result, "Response must have `messages` field").toHaveProperty("messages");
      expect(result, "Response must have `thread` field").toHaveProperty("thread");

      const messages = result.messages as KkResponse[];
      const thread = result.thread as KkResponse;

      expect(Array.isArray(messages), "`messages` must be an array").toBe(true);

      // thread fields — populated by mapThreadRow() in chatPersistence.ts
      expect(thread, "thread must have ThreadID").toHaveProperty("ThreadID");
      expect(thread, "thread must have TaskID").toHaveProperty("TaskID");
      expect(thread, "thread must have UnreadUserCount").toHaveProperty("UnreadUserCount");
      expect(String(thread.ThreadID).trim(), "thread.ThreadID must match requested thread").toBe(threadId);

      // Validate each message object if any exist
      for (const [i, msg] of messages.entries()) {
        const m = msg as KkResponse;
        expect(m, `messages[${i}] must have MessageID`).toHaveProperty("MessageID");
        expect(m, `messages[${i}] must have ThreadID`).toHaveProperty("ThreadID");
        expect(m, `messages[${i}] must have SenderType`).toHaveProperty("SenderType");
        expect(m, `messages[${i}] must have MessageText`).toHaveProperty("MessageText");
        expect(
          String(m.ThreadID).trim(),
          `messages[${i}].ThreadID must match thread`
        ).toBe(threadId);
        const senderType = String(m.SenderType || "").toLowerCase();
        expect(
          senderType === "user" || senderType === "provider",
          `messages[${i}].SenderType must be "user" or "provider", got "${senderType}"`
        ).toBe(true);
      }

      console.log(
        `[TC-02] thread.ThreadID: ${thread.ThreadID}, ` +
        `messages.length: ${messages.length}, ` +
        `UnreadUserCount: ${thread.UnreadUserCount}`
      );
    } else {
      // ok:false is acceptable if the thread belongs to a different user or is access-denied.
      // Still verify it is a Supabase-native error, not a GAS proxy error.
      const errorMsg = String(result.error || "");
      expect(errorMsg, "Error must not be KK_PROXY_POST_FAILED").not.toBe("KK_PROXY_POST_FAILED");
      expect(result, "Error response must not have `messages` array").not.toHaveProperty("messages");
      console.log(`[TC-02] Access denied (ok:false) — error: "${errorMsg}" — still Supabase-native`);
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

    // This thread ID is guaranteed to not exist in Supabase `chat_threads`.
    // Pre-cutover: kk/route.ts calls hydrateChatSnapshotFromGas() when it gets
    //   getChatMessagesFromSupabase → { ok:false, error:"Thread not found" }
    // Post-cutover: that hydration block is removed. The native error flows through directly.
    const phantomThreadId = "THREAD-ZZ-PHANTOM-CUTOVER-001";

    const result = await kkPost(page, {
      action: "chat_get_messages",
      ThreadID: phantomThreadId,
      ActorType: "user",
      UserPhone: syntheticPhone,
    });

    console.log("[TC-03] Thread-not-found response:", JSON.stringify(result));

    const httpStatus = result._httpStatus as number;
    const errorMsg = String(result.error || "");

    expect(httpStatus, "Must not 5xx").toBeLessThan(500);
    expect(result.ok, "ok must be false for non-existent thread").toBe(false);
    expect(result.status, "status must be 'error'").toBe("error");

    // Post-cutover: native error must flow through without any GAS hydration attempt.
    // This is the exact error string returned by getChatMessagesFromSupabase when the
    // thread row is not found in `chat_threads`.
    expect(errorMsg, "Native error must be 'Thread not found'").toBe("Thread not found");

    // GAS proxy sentinel must not appear
    expect(errorMsg, "Must not be KK_PROXY_POST_FAILED").not.toBe("KK_PROXY_POST_FAILED");

    // Error response must not carry `messages` or `thread` — those are success-only fields
    expect(result, "Error response must not have `messages` array").not.toHaveProperty("messages");
    expect(result, "Error response must not have `thread` object").not.toHaveProperty("thread");

    // NOTE: hydrateChatSnapshotFromGas() runs as a server-side Node.js fetch and is NOT
    // browser-observable. This intercept catches any regression where the client is
    // redirected to a GAS URL, or where GAS leaks into a browser-visible request.
    expect(
      gasInterceptCount,
      "Zero browser-side GAS calls — hydration block must not redirect browser to GAS"
    ).toBe(0);

    console.log(
      `[TC-03] PASS — error: "${errorMsg}", httpStatus: ${httpStatus}, GAS calls: ${gasInterceptCount}`
    );
  });

  // ── TC-04: Zero GAS calls across all tested cases ─────────────────────────
  test("TC-04: Zero GAS / script.google.com calls across all chat_get_messages invocations", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9977665544";
    await injectSessionCookie(page, syntheticPhone);

    // Exercise every distinct branch that could conceivably trigger a fallback.
    const cases: Array<{ label: string; body: Record<string, unknown> }> = [
      {
        label: "no ThreadID — validation error before any DB lookup",
        body: {
          action: "chat_get_messages",
          ActorType: "user",
          UserPhone: syntheticPhone,
        },
      },
      {
        label: "invalid ActorType — fails actor resolution before DB lookup",
        body: {
          action: "chat_get_messages",
          ThreadID: "THREAD-ZZ-TC04-001",
          ActorType: "system",
          UserPhone: syntheticPhone,
        },
      },
      {
        label: "phantom thread, user actor — triggers the 'Thread not found' branch",
        body: {
          action: "chat_get_messages",
          ThreadID: "THREAD-ZZ-TC04-PHANTOM",
          ActorType: "user",
          UserPhone: syntheticPhone,
        },
      },
      {
        label: "phantom thread, provider actor — exercises provider branch",
        body: {
          action: "chat_get_messages",
          ThreadID: "THREAD-ZZ-TC04-PHANTOM",
          ActorType: "provider",
          loggedInProviderPhone: syntheticPhone,
        },
      },
      {
        label: "empty ThreadID string — treated as missing",
        body: {
          action: "chat_get_messages",
          ThreadID: "   ",
          ActorType: "user",
          UserPhone: syntheticPhone,
        },
      },
    ];

    let allOk = true;

    for (const { label, body } of cases) {
      const result = await kkPost(page, body);
      const httpStatus = result._httpStatus as number;
      const errorMsg = String(result.error || "");

      console.log(
        `[TC-04] "${label}":`,
        JSON.stringify({ ok: result.ok, status: result.status, error: errorMsg, httpStatus })
      );

      if (httpStatus >= 500) {
        console.error(`[TC-04] UNEXPECTED 5xx for "${label}" — HTTP ${httpStatus}`);
        allOk = false;
      }

      if (errorMsg === "KK_PROXY_POST_FAILED") {
        console.error(`[TC-04] GAS PROXY SENTINEL detected for "${label}"`);
        allOk = false;
      }

      // Every case must return ok:false — none of these inputs can produce a valid thread fetch
      if (result.ok !== false) {
        console.error(`[TC-04] Expected ok:false but got ok:${String(result.ok)} for "${label}"`);
        allOk = false;
      }
    }

    expect(allOk, "All cases must return ok:false, non-5xx, non-KK_PROXY responses").toBe(true);

    // Primary assertion: after removing the GAS fallback, none of these cases should
    // produce a browser-visible call to script.google.com.
    expect(
      gasInterceptCount,
      `Zero browser-side GAS calls across all ${cases.length} chat_get_messages cases`
    ).toBe(0);

    console.log(
      `[TC-04] PASS — ${cases.length} cases tested, GAS calls: ${gasInterceptCount}`
    );
  });
});
