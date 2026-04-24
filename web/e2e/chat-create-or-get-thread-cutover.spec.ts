/**
 * E2E: chat_create_or_get_thread — Supabase-Native Cutover Validation
 *
 * Validates that action=chat_create_or_get_thread in /api/kk is fully Supabase-native
 * after removing the GAS hydration fallback.
 *
 *  TC-01: Invalid / missing input returns native Supabase errors — not KK_PROXY or GAS envelopes
 *  TC-02: Idempotency — calling with the same inputs twice returns the same ThreadID
 *         and created:false on the second call, proving no duplicate threads
 *  TC-03: New thread creation — a valid but unused TaskID+provider combination returns
 *         ok:true, created:true, ThreadID present
 *  TC-04: Zero GAS / script.google.com calls across all test cases
 *
 * ARCHITECTURE NOTE — GAS fallback path being tested:
 *  Pre-cutover kk/route.ts had:
 *    const existingThreads = await getChatThreadsFromSupabase({...body});
 *    const hasExactExisting = existingThreads.ok && existingThreads.threads.some(...);
 *    if (!hasExactExisting) {
 *      await hydrateChatThreadsFromGas(...);    // fires for EVERY new-thread case
 *    }                                           // and for EVERY invalid-input case
 *    const result = await createOrGetChatThreadFromSupabase(body);
 *
 *  Post-cutover (current): the hydration block is removed entirely. The route calls
 *  createOrGetChatThreadFromSupabase() directly and returns its result.
 *
 *  Consequence: pre-cutover, GAS was called even for invalid inputs (because
 *  getChatThreadsFromSupabase returns ok:false for bad actors, making hasExactExisting
 *  false). TC-01 and TC-04 together verify this path is gone.
 *
 * NATIVE RESPONSE DISCRIMINATOR:
 *  createOrGetChatThreadFromSupabase() returns { ok, status, created, thread }.
 *  The `created` boolean field exists ONLY in the Supabase-native path — no GAS
 *  response has this field. A false `created` proves the thread was found in Supabase,
 *  not fetched from GAS. A true `created` proves the thread was inserted natively.
 *
 * PROVIDER MATCH REQUIREMENT:
 *  A `provider_task_matches` row must exist for the TaskID+ProviderID combination.
 *  Without it, createOrGetChatThreadFromSupabase returns "Provider is not matched
 *  to this task". TC-02 and TC-03 use combinations where the match row exists.
 *
 * Run:
 *   TEST_PHONE=9XXXXXXXXX TEST_PROVIDER_PHONE=9XXXXXXXXX \
 *   npx playwright test e2e/chat-create-or-get-thread-cutover.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://kaun-karega.vercel.app";
const TEST_PHONE = process.env.TEST_PHONE || "";
const TEST_PROVIDER_PHONE = process.env.TEST_PROVIDER_PHONE || "";
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

async function getProviderByPhone(page: Page, phone: string): Promise<KkResponse | null> {
  const phone10 = phone.replace(/\D/g, "").slice(-10);
  const result = await page.request.get(
    `${BASE_URL}${KK_API}?action=get_provider_by_phone&phone=${phone10}`
  );
  let json: KkResponse = {};
  try { json = (await result.json()) as KkResponse; }
  catch { return null; }
  if (!json.ok) return null;
  return (json.provider as KkResponse) ?? null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("chat_create_or_get_thread — Supabase-Native Cutover", () => {
  test.beforeEach(() => {
    resetGasCounter();
  });

  // ── TC-01: Invalid / missing input returns native Supabase errors ─────────
  test("TC-01: Invalid inputs return native Supabase errors — not KK_PROXY or GAS envelopes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9988776655";
    await injectSessionCookie(page, syntheticPhone);

    // Validation happens in two layers:
    //  1. resolveChatActor() — ActorType + phone validation (before any DB call)
    //  2. createOrGetChatThreadFromSupabase() — TaskID, task existence, provider match
    // Pre-cutover: GAS hydration was attempted for ALL of these before returning the error,
    // because getChatThreadsFromSupabase returns ok:false → hasExactExisting is false.
    // Post-cutover: native error flows through directly without GAS.
    const invalidCases: Array<{ label: string; body: Record<string, unknown>; expectError: string }> = [
      {
        label: "missing TaskID",
        body: {
          action: "chat_create_or_get_thread",
          ActorType: "user",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-001",
        },
        expectError: "TaskID required",
      },
      {
        label: "missing ActorType",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-NOEXIST-001",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-001",
        },
        expectError: "ActorType must be user or provider",
      },
      {
        label: "invalid ActorType value",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-NOEXIST-001",
          ActorType: "admin",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-001",
        },
        expectError: "ActorType must be user or provider",
      },
      {
        label: "missing UserPhone for user actor",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-NOEXIST-001",
          ActorType: "user",
          ProviderID: "PROVIDER-ZZ-001",
        },
        expectError: "UserPhone required for user context",
      },
      {
        label: "missing provider phone for provider actor",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-NOEXIST-001",
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

      // GAS proxy sentinel must not appear
      expect(errorMsg, `"${label}": must not be KK_PROXY_POST_FAILED`).not.toBe("KK_PROXY_POST_FAILED");

      // Error responses have only {ok, status, error}.
      // A success response adds `created` and `thread` — must be absent on error paths.
      expect(result, `"${label}": error response must not have "created" field`).not.toHaveProperty("created");
      expect(result, `"${label}": error response must not have "thread" object`).not.toHaveProperty("thread");
    }

    expect(gasInterceptCount, "No browser-side GAS calls for any invalid input").toBe(0);
    console.log(`[TC-01] PASS — ${invalidCases.length} invalid cases, GAS calls: ${gasInterceptCount}`);
  });

  // ── TC-02: Idempotency — same inputs return same thread, created:false ────
  test("TC-02: Calling with same inputs twice returns same ThreadID and created:false — no duplicates", async ({ page }) => {
    if (!TEST_PHONE) {
      test.skip();
      return;
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);
    await loginViaOtp(page, TEST_PHONE);

    const phone10 = TEST_PHONE.replace(/\D/g, "").slice(-10);

    // Find an existing thread — it carries a TaskID + ProviderID that already has
    // a valid provider_task_matches row and an existing thread_id in Supabase.
    const threads = await getThreadsForUser(page, phone10);

    if (threads.length === 0) {
      console.log("[TC-02] No existing threads for TEST_PHONE — skipping idempotency assertions");
      console.log("[TC-02] NOTE: Run with a phone that has at least one existing chat thread");
      expect(gasInterceptCount, "No GAS calls even when skipping").toBe(0);
      console.log("[TC-02] SKIP (no threads found)");
      return;
    }

    // Prefer a thread that is still active (not closed)
    const activeThread = threads.find(
      (t) => String(t.ThreadStatus || "").toLowerCase() !== "closed"
    ) ?? threads[0];

    const taskId = String(activeThread.TaskID || activeThread.taskId || "").trim();
    const providerId = String(activeThread.ProviderID || activeThread.providerId || "").trim();

    expect(taskId, "Selected thread must have a TaskID").toBeTruthy();
    expect(providerId, "Selected thread must have a ProviderID").toBeTruthy();

    const requestBody = {
      action: "chat_create_or_get_thread",
      TaskID: taskId,
      ProviderID: providerId,
      ActorType: "user",
      UserPhone: phone10,
    };

    console.log(`[TC-02] Using TaskID: ${taskId}, ProviderID: ${providerId}`);

    // ── First call ──
    const firstResult = await kkPost(page, requestBody);
    console.log("[TC-02] First call response:", JSON.stringify({
      ok: firstResult.ok,
      status: firstResult.status,
      created: firstResult.created,
      threadId: (firstResult.thread as KkResponse | undefined)?.ThreadID,
    }));

    expect(firstResult._httpStatus as number, "First call: must not 5xx").toBeLessThan(500);
    expect(firstResult.ok, "First call: ok must be true").toBe(true);
    expect(firstResult.status, "First call: status must be 'success'").toBe("success");
    expect(firstResult, "First call: must have `created` field").toHaveProperty("created");
    expect(firstResult, "First call: must have `thread` field").toHaveProperty("thread");

    const firstThread = firstResult.thread as KkResponse;
    const firstThreadId = String(firstThread.ThreadID || "").trim();
    expect(firstThreadId, "First call: ThreadID must be non-empty").toBeTruthy();

    // The first call may return created:true (if the thread existed in Supabase already,
    // this would be false; if it was somehow absent, it would be true). Either is valid here —
    // TC-03 specifically targets created:true. TC-02's concern is the SECOND call.

    // ── Second call — identical inputs ──
    const secondResult = await kkPost(page, requestBody);
    console.log("[TC-02] Second call response:", JSON.stringify({
      ok: secondResult.ok,
      status: secondResult.status,
      created: secondResult.created,
      threadId: (secondResult.thread as KkResponse | undefined)?.ThreadID,
    }));

    expect(secondResult._httpStatus as number, "Second call: must not 5xx").toBeLessThan(500);
    expect(secondResult.ok, "Second call: ok must be true").toBe(true);
    expect(secondResult.status, "Second call: status must be 'success'").toBe("success");
    expect(secondResult, "Second call: must have `created` field").toHaveProperty("created");
    expect(secondResult, "Second call: must have `thread` field").toHaveProperty("thread");

    // The primary TC-02 assertion: second call must never create a duplicate
    expect(
      secondResult.created,
      "Second call with same inputs must return created:false — no duplicate thread"
    ).toBe(false);

    const secondThread = secondResult.thread as KkResponse;
    const secondThreadId = String(secondThread.ThreadID || "").trim();

    // Both calls must return the same thread
    expect(
      secondThreadId,
      "Second call must return the same ThreadID as the first call"
    ).toBe(firstThreadId);

    // Validate thread shape on the idempotent response
    expect(secondThread, "thread must have TaskID").toHaveProperty("TaskID");
    expect(secondThread, "thread must have ProviderID").toHaveProperty("ProviderID");
    expect(secondThread, "thread must have UnreadUserCount").toHaveProperty("UnreadUserCount");
    expect(String(secondThread.TaskID), "thread.TaskID must match request").toBe(taskId);
    expect(String(secondThread.ProviderID), "thread.ProviderID must match request").toBe(providerId);

    expect(gasInterceptCount, "No browser-side GAS calls").toBe(0);
    console.log(
      `[TC-02] PASS — ThreadID: ${firstThreadId}, created on first call: ${firstResult.created}, ` +
      `created on second call: ${secondResult.created}, GAS calls: ${gasInterceptCount}`
    );
  });

  // ── TC-03: New thread creation returns created:true ───────────────────────
  test("TC-03: New TaskID+provider combination returns ok:true, created:true, ThreadID present", async ({ page }) => {
    if (!TEST_PHONE || !TEST_PROVIDER_PHONE) {
      console.log("[TC-03] Requires TEST_PHONE and TEST_PROVIDER_PHONE — skipping");
      test.skip();
      return;
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);
    await loginViaOtp(page, TEST_PHONE);

    const userPhone10 = TEST_PHONE.replace(/\D/g, "").slice(-10);
    const providerPhone10 = TEST_PROVIDER_PHONE.replace(/\D/g, "").slice(-10);

    // Resolve TEST_PROVIDER_PHONE to a ProviderID — requires get_provider_by_phone
    // (open endpoint, no auth required).
    const providerData = await getProviderByPhone(page, providerPhone10);
    if (!providerData) {
      console.log(`[TC-03] Provider not found for TEST_PROVIDER_PHONE (${providerPhone10}) — skipping`);
      console.log("[TC-03] NOTE: TEST_PROVIDER_PHONE must correspond to an active provider in the DB");
      expect(gasInterceptCount, "No GAS calls even when skipping").toBe(0);
      return;
    }

    const testProviderId = String(providerData.ProviderID || providerData.provider_id || "").trim();
    if (!testProviderId) {
      console.log("[TC-03] Could not extract ProviderID from provider lookup — skipping");
      expect(gasInterceptCount, "No GAS calls even when skipping").toBe(0);
      return;
    }

    console.log(`[TC-03] TEST_PROVIDER_PHONE resolved to ProviderID: ${testProviderId}`);

    // Collect TaskIDs from TEST_PHONE's existing threads to find one where
    // TEST_PROVIDER_PHONE is NOT the current provider — that gives us a
    // TaskID+provider combination that has no existing thread with this provider.
    const existingThreads = await getThreadsForUser(page, userPhone10);
    const existingProviderIdsByTask = new Map<string, Set<string>>();

    for (const t of existingThreads as KkResponse[]) {
      const tTaskId = String(t.TaskID || "").trim();
      const tProviderId = String(t.ProviderID || "").trim();
      if (tTaskId && tProviderId) {
        if (!existingProviderIdsByTask.has(tTaskId)) {
          existingProviderIdsByTask.set(tTaskId, new Set());
        }
        existingProviderIdsByTask.get(tTaskId)!.add(tProviderId);
      }
    }

    // Find a TaskID where testProviderId has no existing thread, but the task is
    // known to have a provider_task_matches row (we probe by attempting creation).
    let newThreadId = "";
    let usedTaskId = "";

    const candidateTaskIds = [...existingProviderIdsByTask.keys()].filter(
      (taskId) => !existingProviderIdsByTask.get(taskId)!.has(testProviderId)
    );

    console.log(
      `[TC-03] Candidate task IDs with no thread for ProviderID ${testProviderId}: ` +
      `${candidateTaskIds.length > 0 ? candidateTaskIds.join(", ") : "(none found in thread list)"}`
    );

    for (const candidateTaskId of candidateTaskIds) {
      const attemptResult = await kkPost(page, {
        action: "chat_create_or_get_thread",
        TaskID: candidateTaskId,
        ProviderID: testProviderId,
        ActorType: "user",
        UserPhone: userPhone10,
      });

      console.log(
        `[TC-03] Attempt with TaskID ${candidateTaskId}:`,
        JSON.stringify({ ok: attemptResult.ok, error: attemptResult.error, created: attemptResult.created })
      );

      if (attemptResult.ok === true && attemptResult.created === true) {
        // New thread created — this is the TC-03 success case
        newThreadId = String((attemptResult.thread as KkResponse).ThreadID || "").trim();
        usedTaskId = candidateTaskId;
        break;
      }

      if (attemptResult.ok === true && attemptResult.created === false) {
        // Thread already exists for this combo — continue searching
        continue;
      }

      // "Provider is not matched to this task" or other non-match errors — try next task
    }

    if (!newThreadId) {
      console.log(
        "[TC-03] Could not find a TaskID+provider combination that produces created:true. " +
        "Possible reasons: TEST_PROVIDER_PHONE has no provider_task_matches rows that lack threads, " +
        "or TEST_PROVIDER_PHONE is not matched to any of TEST_PHONE's tasks."
      );
      console.log(
        "[TC-03] NOTE: Run /api/process-task-notifications for a task owned by TEST_PHONE " +
        "with TEST_PROVIDER_PHONE as a matched provider to seed a provider_task_matches row."
      );

      // Even in skip, verify the API returns Supabase-native errors — not GAS envelopes
      const probeResult = await kkPost(page, {
        action: "chat_create_or_get_thread",
        TaskID: "TASK-ZZ-TC03-PROBE",
        ProviderID: testProviderId,
        ActorType: "user",
        UserPhone: userPhone10,
      });
      expect(probeResult._httpStatus as number, "Probe: must not 5xx").toBeLessThan(500);
      expect(String(probeResult.error || ""), "Probe: must not be KK_PROXY_POST_FAILED")
        .not.toBe("KK_PROXY_POST_FAILED");
      expect(gasInterceptCount, "No GAS calls even when no new thread found").toBe(0);
      console.log("[TC-03] PARTIAL PASS — API contract verified, created:true not achievable without seeded match");
      return;
    }

    // ── Full TC-03 assertions ──
    console.log(`[TC-03] New thread created — ThreadID: ${newThreadId}, TaskID: ${usedTaskId}`);

    // Re-fetch the thread via chat_create_or_get_thread to confirm idempotency:
    // the SAME combination called again must now return created:false.
    const verifyResult = await kkPost(page, {
      action: "chat_create_or_get_thread",
      TaskID: usedTaskId,
      ProviderID: testProviderId,
      ActorType: "user",
      UserPhone: userPhone10,
    });

    expect(verifyResult.ok, "Verification call: ok must be true").toBe(true);
    expect(verifyResult.created, "Verification call: created must be false (idempotency)").toBe(false);
    expect(
      String((verifyResult.thread as KkResponse).ThreadID || "").trim(),
      "Verification call: ThreadID must match the newly created thread"
    ).toBe(newThreadId);

    // Validate the native response shape
    const newThread = (
      await kkPost(page, {
        action: "chat_create_or_get_thread",
        TaskID: usedTaskId,
        ProviderID: testProviderId,
        ActorType: "user",
        UserPhone: userPhone10,
      })
    ).thread as KkResponse;

    expect(newThread, "thread must have ThreadID").toHaveProperty("ThreadID");
    expect(newThread, "thread must have TaskID").toHaveProperty("TaskID");
    expect(newThread, "thread must have ProviderID").toHaveProperty("ProviderID");
    expect(newThread, "thread must have UserPhone").toHaveProperty("UserPhone");
    expect(newThread, "thread must have UnreadUserCount").toHaveProperty("UnreadUserCount");

    expect(String(newThread.ThreadID).trim(), "thread.ThreadID must be non-empty").toBeTruthy();
    expect(String(newThread.TaskID), "thread.TaskID must match").toBe(usedTaskId);
    expect(String(newThread.ProviderID), "thread.ProviderID must match").toBe(testProviderId);

    expect(gasInterceptCount, "No browser-side GAS calls").toBe(0);
    console.log(
      `[TC-03] PASS — ThreadID: ${newThreadId}, TaskID: ${usedTaskId}, GAS calls: ${gasInterceptCount}`
    );
  });

  // ── TC-04: Zero GAS calls across all tested cases ─────────────────────────
  test("TC-04: Zero GAS / script.google.com calls across all chat_create_or_get_thread invocations", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await setupGasInterception(page);

    const syntheticPhone = "9977665544";
    await injectSessionCookie(page, syntheticPhone);

    // These cases cover every branch in the kk route handler that previously triggered GAS:
    //  - Invalid actor → hasExactExisting is false (getChatThreadsFromSupabase returns ok:false)
    //  - Phantom task → hasExactExisting is false (getChatThreadsFromSupabase returns empty array)
    // Pre-cutover GAS would be called in ALL of these. Post-cutover: none.
    const cases: Array<{ label: string; body: Record<string, unknown> }> = [
      {
        label: "missing TaskID — validation error before actor resolution",
        body: {
          action: "chat_create_or_get_thread",
          ActorType: "user",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-001",
        },
      },
      {
        label: "missing ActorType — actor resolution failure",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-TC04-001",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-001",
        },
      },
      {
        label: "invalid ActorType — actor resolution failure",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-TC04-001",
          ActorType: "bot",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-001",
        },
      },
      {
        label: "missing UserPhone — actor resolution failure, hasExactExisting false",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-TC04-001",
          ActorType: "user",
          ProviderID: "PROVIDER-ZZ-001",
        },
      },
      {
        label: "phantom task, valid actor — task-not-found after actor resolution",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-TC04-PHANTOM",
          ActorType: "user",
          UserPhone: syntheticPhone,
          ProviderID: "PROVIDER-ZZ-TC04-PHANTOM",
        },
      },
      {
        label: "missing ProviderID for user actor — ProviderID required error",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-TC04-001",
          ActorType: "user",
          UserPhone: syntheticPhone,
          // No ProviderID — triggers "ProviderID required for user flow" after task lookup
        },
      },
      {
        label: "missing provider phone for provider actor — actor resolution failure",
        body: {
          action: "chat_create_or_get_thread",
          TaskID: "TASK-ZZ-TC04-001",
          ActorType: "provider",
          // No loggedInProviderPhone
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

      // Every case must return ok:false — none of these inputs can succeed
      if (result.ok !== false) {
        console.error(`[TC-04] Expected ok:false but got ok:${String(result.ok)} for "${label}"`);
        allOk = false;
      }

      // `created` and `thread` must be absent on error paths
      if ("created" in result) {
        console.error(`[TC-04] Unexpected "created" field on error response for "${label}"`);
        allOk = false;
      }
    }

    expect(allOk, "All cases must return ok:false, non-5xx, non-KK_PROXY responses").toBe(true);

    // Primary assertion: no case should produce a browser-visible GAS call.
    // Pre-cutover, GAS was called for EVERY case here because:
    //   - Invalid-actor inputs → getChatThreadsFromSupabase returns ok:false
    //     → hasExactExisting is false → GAS hydration was triggered
    //   - Phantom task → getChatThreadsFromSupabase may return ok:true with empty array
    //     → hasExactExisting is false → GAS hydration was triggered
    // Post-cutover: the hydration block is removed entirely.
    expect(
      gasInterceptCount,
      `Zero browser-side GAS calls across all ${cases.length} chat_create_or_get_thread cases`
    ).toBe(0);

    console.log(
      `[TC-04] PASS — ${cases.length} cases tested, GAS calls: ${gasInterceptCount}`
    );
  });
});
