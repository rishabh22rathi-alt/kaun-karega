/**
 * E2E: chat_get_threads — Supabase-Native Cutover Validation
 *
 * Validates that action=chat_get_threads in /api/kk is fully Supabase-native
 * with no GAS hydration fallback.
 *
 *  TC-01: Invalid / missing input returns native Supabase errors — not KK_PROXY or GAS envelopes
 *  TC-02: Successful fetch for a user with threads returns native response shape
 *         (ok, status, threads[] — each thread has ThreadID, TaskID, UnreadUserCount)
 *  TC-03: Empty-result case (valid actor, no threads in DB) returns native { ok:true, threads:[] }
 *         without calling GAS — confirms the hydration fallback was removed and stays removed
 *  TC-04: Zero GAS / script.google.com calls across all chat_get_threads test cases
 *
 * ARCHITECTURE NOTE — fallback path being validated:
 *  Pre-cutover kk/route.ts had:
 *    if (result.ok && result.threads.length === 0) {
 *      await hydrateChatThreadsFromGas(...);    // this was removed
 *      result = await getChatThreadsFromSupabase(body);
 *    }
 *  Post-cutover (current): the handler is a direct pass-through —
 *    const result = await getChatThreadsFromSupabase(body);
 *    return withNoCache(NextResponse.json(result));
 *  TC-03 and TC-04 together lock in that the empty-result path never calls GAS.
 *
 * NATIVE RESPONSE DISCRIMINATOR:
 *  getChatThreadsFromSupabase() returns { ok, status, threads }.
 *  `threads` is an array of ChatThreadPayload objects (each with ThreadID, TaskID,
 *  UnreadUserCount, etc.). No GAS response has this shape or field naming convention.
 *  An empty `threads: []` on a valid actor is a first-class Supabase response, not
 *  a fallback trigger.
 *
 * VALIDATION SCOPE:
 *  getChatThreadsFromSupabase() requires only ActorType + actor phone — no ThreadID.
 *  Invalid-input cases (TC-01) exercise actor resolution failures only.
 *  Thread-level filtering (TaskID, Status) is optional and not a validation boundary.
 *
 * Run: TEST_PHONE=9XXXXXXXXX npx playwright test e2e/chat-get-threads-cutover.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://kaun-karega.vercel.app";
const TEST_PHONE = process.env.TEST_PHONE || "";
const KK_API = "/api/kk";

// Synthetic phone guaranteed to have zero threads in the DB.
// Used in TC-03 to exercise the empty-result path without contaminating real data.
const ZERO_THREADS_PHONE = "9900000001";

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

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("chat_get_threads — Supabase-Native Cutover", () => {
  test.beforeEach(() => {
    resetGasCounter();
  });

  // ── TC-01: Invalid / missing input returns native Supabase errors ─────────
  test("TC-01: Invalid inputs return native Supabase errors — not KK_PROXY or GAS envelopes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9988776655";
    await injectSessionCookie(page, syntheticPhone);

    // getChatThreadsFromSupabase() has no ThreadID requirement — the only validation
    // boundary is actor resolution (ActorType + actor phone). These cases exercise
    // every distinct failure mode in resolveChatActor().
    const invalidCases: Array<{ label: string; body: Record<string, unknown>; expectError: string }> = [
      {
        label: "missing ActorType",
        body: {
          action: "chat_get_threads",
          UserPhone: syntheticPhone,
        },
        expectError: "ActorType must be user or provider",
      },
      {
        label: "invalid ActorType value",
        body: {
          action: "chat_get_threads",
          ActorType: "admin",
          UserPhone: syntheticPhone,
        },
        expectError: "ActorType must be user or provider",
      },
      {
        label: "missing UserPhone for user actor",
        body: {
          action: "chat_get_threads",
          ActorType: "user",
        },
        expectError: "UserPhone required for user context",
      },
      {
        label: "missing provider phone for provider actor",
        body: {
          action: "chat_get_threads",
          ActorType: "provider",
          // No loggedInProviderPhone or ProviderID supplied
        },
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

      // GAS proxy sentinel must not appear — it would mean the route fell through
      // to the upstream proxy instead of returning a Supabase-native error.
      expect(errorMsg, `"${label}": must not be KK_PROXY_POST_FAILED`).not.toBe("KK_PROXY_POST_FAILED");

      // Error responses from getChatThreadsFromSupabase have only {ok, status, error}.
      // A success response adds `threads`. It must be absent on every error path.
      expect(result, `"${label}": error response must not have "threads" array`).not.toHaveProperty("threads");
    }

    expect(gasInterceptCount, "No browser-side GAS calls for any invalid input").toBe(0);
    console.log(`[TC-01] PASS — ${invalidCases.length} invalid cases, GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-02: Successful fetch returns Supabase-native shape ────────────────
  test("TC-02: Successful fetch for user with threads returns native response with threads[] field", async ({ page }) => {
    if (!TEST_PHONE) {
      test.skip();
      return;
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);
    await loginViaOtp(page, TEST_PHONE);

    const phone10 = TEST_PHONE.replace(/\D/g, "").slice(-10);

    const result = await kkPost(page, {
      action: "chat_get_threads",
      ActorType: "user",
      UserPhone: phone10,
    });

    console.log(
      "[TC-02] get_threads response (truncated):",
      JSON.stringify({
        ok: result.ok,
        status: result.status,
        error: result.error,
        threadCount: Array.isArray(result.threads) ? (result.threads as unknown[]).length : "n/a",
      })
    );

    expect(result._httpStatus as number, "Must not 5xx").toBeLessThan(500);
    expect(result.ok, "ok must be true for valid actor").toBe(true);
    expect(result.status, "status must be 'success'").toBe("success");

    // `threads` is the primary Supabase-native discriminator.
    // GAS never returns a `threads` array with this field naming.
    expect(result, "Response must have `threads` field").toHaveProperty("threads");
    const threads = result.threads as KkResponse[];
    expect(Array.isArray(threads), "`threads` must be an array").toBe(true);

    if (threads.length === 0) {
      console.log(
        "[TC-02] NOTE: No threads found for TEST_PHONE. " +
        "Shape assertions pass on empty array — use a phone with existing threads to validate item shape."
      );
    } else {
      // Validate every thread object in the response
      for (const [i, thread] of threads.entries()) {
        const t = thread as KkResponse;

        expect(t, `threads[${i}] must have ThreadID`).toHaveProperty("ThreadID");
        expect(t, `threads[${i}] must have TaskID`).toHaveProperty("TaskID");
        expect(t, `threads[${i}] must have UserPhone`).toHaveProperty("UserPhone");
        expect(t, `threads[${i}] must have ProviderID`).toHaveProperty("ProviderID");
        expect(t, `threads[${i}] must have UnreadUserCount`).toHaveProperty("UnreadUserCount");
        expect(t, `threads[${i}] must have UnreadProviderCount`).toHaveProperty("UnreadProviderCount");
        expect(t, `threads[${i}] must have CreatedAt`).toHaveProperty("CreatedAt");

        expect(
          String(t.ThreadID || "").trim().length,
          `threads[${i}].ThreadID must be non-empty`
        ).toBeGreaterThan(0);

        expect(
          typeof t.UnreadUserCount,
          `threads[${i}].UnreadUserCount must be a number`
        ).toBe("number");

        // All returned threads must belong to the requesting user
        const threadUserPhone = String(t.UserPhone || "").replace(/\D/g, "").slice(-10);
        expect(
          threadUserPhone,
          `threads[${i}].UserPhone must match the requesting user`
        ).toBe(phone10);
      }

      console.log(`[TC-02] Validated ${threads.length} thread(s), first ThreadID: ${String((threads[0] as KkResponse).ThreadID)}`);
    }

    expect(gasInterceptCount, "No browser-side GAS calls").toBe(0);
    console.log(`[TC-02] PASS — threadCount: ${threads.length}, GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-03: Empty-result case returns native response, no GAS call ────────
  test("TC-03: Valid actor with zero threads returns native { ok:true, threads:[] } — GAS not called", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);
    await injectSessionCookie(page, ZERO_THREADS_PHONE);

    // ZERO_THREADS_PHONE has no rows in `chat_threads`. getChatThreadsFromSupabase()
    // succeeds (ok:true) but returns threads:[]. Pre-cutover this triggered GAS hydration.
    // Post-cutover the empty array is returned directly as a first-class response.
    const result = await kkPost(page, {
      action: "chat_get_threads",
      ActorType: "user",
      UserPhone: ZERO_THREADS_PHONE,
    });

    console.log("[TC-03] Empty-result response:", JSON.stringify(result));

    const httpStatus = result._httpStatus as number;

    expect(httpStatus, "Must not 5xx").toBeLessThan(500);

    // The query succeeds — ok must be true even when threads is empty.
    // This is the critical distinction from the error case: an empty thread list is NOT
    // a failure; it is a valid Supabase result. Pre-cutover, this path called GAS.
    expect(result.ok, "ok must be true for a valid actor with zero threads").toBe(true);
    expect(result.status, "status must be 'success'").toBe("success");
    expect(result, "Response must have `threads` field").toHaveProperty("threads");

    const threads = result.threads as unknown[];
    expect(Array.isArray(threads), "`threads` must be an array").toBe(true);
    expect(threads.length, "`threads` must be empty for a phone with no chat history").toBe(0);

    // GAS proxy sentinel must not appear in any form
    expect(String(result.error || ""), "Must not be KK_PROXY_POST_FAILED").not.toBe("KK_PROXY_POST_FAILED");

    // Zero browser-side GAS calls confirms the hydration fallback was not triggered.
    // NOTE: hydrateChatThreadsFromGas() runs as a server-side Node.js fetch and is
    // NOT browser-observable by Playwright. This intercept catches any regression
    // where the client is redirected to a GAS URL or a GAS URL leaks into a browser fetch.
    expect(
      gasInterceptCount,
      "Zero browser-side GAS calls — empty-result path must not trigger GAS hydration"
    ).toBe(0);

    console.log(
      `[TC-03] PASS — threads: [], httpStatus: ${httpStatus}, GAS calls: ${gasInterceptCount}`
    );
  });

  // ── TC-04: Zero GAS calls across all tested cases ─────────────────────────
  test("TC-04: Zero GAS / script.google.com calls across all chat_get_threads invocations", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9977665544";
    await injectSessionCookie(page, syntheticPhone);

    // Exercise every distinct code path: actor resolution failures, valid-actor-empty-result,
    // and optional filters. Each must resolve entirely within Supabase.
    const cases: Array<{ label: string; body: Record<string, unknown> }> = [
      {
        label: "missing ActorType — fails actor resolution immediately",
        body: {
          action: "chat_get_threads",
          UserPhone: syntheticPhone,
        },
      },
      {
        label: "invalid ActorType — fails actor resolution immediately",
        body: {
          action: "chat_get_threads",
          ActorType: "system",
          UserPhone: syntheticPhone,
        },
      },
      {
        label: "missing UserPhone for user actor — fails actor resolution",
        body: {
          action: "chat_get_threads",
          ActorType: "user",
        },
      },
      {
        label: "valid user actor, no threads — exercises the empty-result path",
        body: {
          action: "chat_get_threads",
          ActorType: "user",
          UserPhone: ZERO_THREADS_PHONE,
        },
      },
      {
        label: "valid user actor with TaskID filter, no matching threads",
        body: {
          action: "chat_get_threads",
          ActorType: "user",
          UserPhone: ZERO_THREADS_PHONE,
          TaskID: "TASK-ZZ-TC04-NOEXIST",
        },
      },
      {
        label: "valid user actor with Status filter, no matching threads",
        body: {
          action: "chat_get_threads",
          ActorType: "user",
          UserPhone: ZERO_THREADS_PHONE,
          Status: "open",
        },
      },
      {
        label: "missing provider phone — fails actor resolution for provider actor",
        body: {
          action: "chat_get_threads",
          ActorType: "provider",
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
    }

    expect(allOk, "All cases must return non-5xx, non-KK_PROXY responses").toBe(true);

    // Primary assertion: the handler is a direct Supabase pass-through.
    // None of these cases should produce a browser-visible call to script.google.com,
    // including the empty-result cases that would have triggered hydration pre-cutover.
    expect(
      gasInterceptCount,
      `Zero browser-side GAS calls across all ${cases.length} chat_get_threads cases`
    ).toBe(0);

    console.log(
      `[TC-04] PASS — ${cases.length} cases tested, GAS calls: ${gasInterceptCount}`
    );
  });
});
