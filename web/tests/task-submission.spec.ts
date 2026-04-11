/**
 * E2E: Full Task Submission Flow
 *
 * Steps:
 *  1. Open homepage
 *  2. Fill category (Electrician), area (Sardarpura), time (Today)
 *  3. Click Submit Request → redirected to /login (unauthenticated)
 *  4. Enter TEST_PHONE, click Send OTP
 *  5. Read latest OTP from Google Sheet via Service Account JWT
 *  6. Enter OTP on /verify page
 *  7. Verify redirect back to homepage → auto-submit task
 *  8. Assert /success page shows "Kaam No."
 *
 * Config:
 *  - Set TEST_PHONE below to a real 10-digit WhatsApp number registered in the system.
 *  - Credentials are read from .env.local automatically via Playwright's env loading.
 *
 * Run:
 *   npx playwright test tests/task-submission.spec.ts --reporter=line
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Config ───────────────────────────────────────────────────────────────────

const TEST_PHONE = process.env.TEST_PHONE || ""; // set via env or hardcode a test number here
const BASE_URL = "http://localhost:3000";

// ─── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
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

// ─── Google Sheets OTP reader ─────────────────────────────────────────────────

async function getLatestOtpFromSheet(phone: string): Promise<string> {
  const env = loadEnvLocal();
  const sheetId = env.GOOGLE_SHEET_ID;
  const serviceEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!sheetId || !serviceEmail || !rawKey) {
    throw new Error(
      "Missing GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env.local"
    );
  }

  // Build JWT for Google OAuth
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: serviceEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(rawKey, "base64url");
  const jwt = `${signingInput}.${signature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth2:grant_type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  // Read OTP sheet — try common tab names
  const tabNames = ["OTP", "Otp", "otp", "Sheet1"];
  let rows: string[][] = [];
  for (const tab of tabNames) {
    const range = `${tab}!A:Z`;
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    if (!sheetRes.ok) continue;
    const sheetData = (await sheetRes.json()) as { values?: string[][] };
    if (Array.isArray(sheetData.values) && sheetData.values.length > 1) {
      rows = sheetData.values;
      console.log(`[OTP] Read ${rows.length - 1} data rows from tab "${tab}"`);
      break;
    }
  }

  if (rows.length < 2) {
    throw new Error("OTP sheet is empty or unreadable. Check tab name and share permissions.");
  }

  // Find header row, locate Phone and OTP columns
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const phoneCol = headers.findIndex((h) => h.includes("phone") || h.includes("mobile") || h.includes("number"));
  const otpCol = headers.findIndex((h) => h.includes("otp") || h.includes("code"));
  const timeCol = headers.findIndex((h) => h.includes("time") || h.includes("created") || h.includes("timestamp"));

  if (otpCol === -1) {
    throw new Error(`No OTP column found. Headers: ${rows[0].join(", ")}`);
  }

  console.log(`[OTP] Columns — phone:${phoneCol} otp:${otpCol} time:${timeCol}`);

  // Get data rows, filter by phone if column found, sort by time desc
  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
  let dataRows = rows.slice(1);

  if (phoneCol !== -1 && normalizedPhone) {
    const filtered = dataRows.filter((row) => {
      const rowPhone = String(row[phoneCol] || "").replace(/\D/g, "").slice(-10);
      return rowPhone === normalizedPhone;
    });
    if (filtered.length > 0) {
      dataRows = filtered;
      console.log(`[OTP] Filtered to ${dataRows.length} rows for phone ${normalizedPhone}`);
    }
  }

  // Sort by time column descending to get latest
  if (timeCol !== -1) {
    dataRows = dataRows
      .slice()
      .sort((a, b) => {
        const ta = new Date(String(a[timeCol] || "")).getTime() || 0;
        const tb = new Date(String(b[timeCol] || "")).getTime() || 0;
        return tb - ta;
      });
  }

  const latestRow = dataRows[dataRows.length - 1]; // fallback: last row if no time sort
  const sortedLatest = dataRows[0]; // after sort: most recent first
  const targetRow = timeCol !== -1 ? sortedLatest : latestRow;

  const otp = String(targetRow?.[otpCol] || "").trim();
  if (!/^\d{4}$/.test(otp)) {
    throw new Error(`OTP "${otp}" is not a valid 4-digit code. Row: ${JSON.stringify(targetRow)}`);
  }

  console.log(`[OTP] Latest OTP for ${normalizedPhone}: ${otp}`);
  return otp;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test("Full task submission: Electrician / Sardarpura / Today → OTP → Kaam No.", async ({ page }) => {
  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!TEST_PHONE) {
    throw new Error(
      "TEST_PHONE is not set. " +
      "Run with: TEST_PHONE=9XXXXXXXXX npx playwright test tests/task-submission.spec.ts"
    );
  }

  // ── Step 1: Open homepage ─────────────────────────────────────────────────
  console.log("[Step 1] Opening homepage");
  await page.goto(BASE_URL);
  await expect(page).toHaveURL(/localhost:3000/);
  // Wait for category input to be visible — the form is the core of the page
  await page.waitForSelector('input[placeholder*="service"], input[placeholder*="Service"], input[type="text"]', {
    timeout: 10_000,
  });
  console.log("[Step 1] PASS — homepage loaded");

  // ── Step 2: Fill category (Electrician) ──────────────────────────────────
  console.log("[Step 2] Filling category: Electrician");
  // Category is a text input with autocomplete suggestions
  const categoryInput = page.locator('input').filter({ hasText: '' }).first();
  // More reliable: find by placeholder or nearby label
  const catInput = page.locator('input[placeholder*="service" i], input[placeholder*="what" i], input[placeholder*="category" i]').first();

  // Try to find any visible text input that likely is the category field
  await page.locator('input[type="text"]').first().click();
  await page.locator('input[type="text"]').first().fill("Electrician");
  await page.waitForTimeout(400); // wait for autocomplete debounce

  // Select from suggestion dropdown if visible
  const suggestion = page.locator('text=Electrician').first();
  if (await suggestion.isVisible().catch(() => false)) {
    await suggestion.click();
    console.log("[Step 2] Selected Electrician from dropdown");
  } else {
    console.log("[Step 2] No dropdown — typed directly");
  }

  // ── Step 3: Select area (Sardarpura) ─────────────────────────────────────
  console.log("[Step 3] Selecting area: Sardarpura");
  // Area selection is a separate component — look for area input or button
  const areaInput = page.locator('input[placeholder*="area" i], input[placeholder*="location" i], button:has-text("area"), [data-testid="area"]').first();

  // Try typing in any input that accepts area
  const allInputs = page.locator('input[type="text"]');
  const inputCount = await allInputs.count();
  console.log(`[Step 3] Found ${inputCount} text inputs`);

  // Area input is typically the second text input on the page
  if (inputCount >= 2) {
    await allInputs.nth(1).click();
    await allInputs.nth(1).fill("Sardarpura");
    await page.waitForTimeout(400);
    const areaSuggestion = page.locator('text=Sardarpura').first();
    if (await areaSuggestion.isVisible().catch(() => false)) {
      await areaSuggestion.click();
      console.log("[Step 3] Selected Sardarpura from dropdown");
    }
  }

  // ── Step 4: Select time (Today) ───────────────────────────────────────────
  console.log("[Step 4] Selecting time: Today");
  const todayBtn = page.locator('button:has-text("Today"), [role="button"]:has-text("Today")').first();
  if (await todayBtn.isVisible().catch(() => false)) {
    await todayBtn.click();
    console.log("[Step 4] Clicked Today button");
  } else {
    // Try any element containing "Today"
    await page.locator('text=Today').first().click();
    console.log("[Step 4] Clicked Today text");
  }

  // ── Step 5: Click Submit Request ─────────────────────────────────────────
  console.log("[Step 5] Clicking Submit Request");
  const submitBtn = page.locator('button:has-text("Submit Request")');
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  // ── Step 6: Login page — enter phone ─────────────────────────────────────
  console.log("[Step 6] Waiting for /login");
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  console.log("[Step 6] PASS — redirected to login");

  await page.locator('#phone').fill(TEST_PHONE.replace(/\D/g, "").slice(0, 10));
  console.log(`[Step 6] Entered phone: ${TEST_PHONE}`);

  const sendOtpBtn = page.locator('button[type="submit"], button:has-text("Send OTP"), button:has-text("Continue"), button:has-text("Get OTP")').first();
  await sendOtpBtn.click();
  console.log("[Step 6] Clicked Send OTP");

  // ── Step 7: Verify page — read OTP from Sheets ───────────────────────────
  console.log("[Step 7] Waiting for /verify");
  await page.waitForURL(/\/verify/, { timeout: 15_000 });
  console.log("[Step 7] PASS — on verify page");

  // Wait for OTP to be sent (page shows success message)
  await page.waitForSelector('text=OTP sent, text=sent, text=Code sent', { timeout: 15_000 }).catch(() => {
    console.log("[Step 7] OTP sent message not found — continuing anyway");
  });

  // Give WhatsApp delivery + Sheet write ~5 seconds
  console.log("[Step 7] Waiting 5s for OTP to be written to sheet...");
  await page.waitForTimeout(5_000);

  const otp = await getLatestOtpFromSheet(TEST_PHONE);
  console.log(`[Step 7] Got OTP from sheet: ${otp}`);

  // ── Step 8: Enter OTP — 4 individual digit inputs ────────────────────────
  console.log("[Step 8] Entering OTP digits");
  const otpInputs = page.locator('input[maxlength="1"], input[inputmode="numeric"][maxlength="1"]');
  const otpCount = await otpInputs.count();

  if (otpCount === 4) {
    for (let i = 0; i < 4; i++) {
      await otpInputs.nth(i).fill(otp[i]);
      await page.waitForTimeout(80);
    }
    console.log("[Step 8] Entered OTP via 4 individual inputs");
  } else {
    // Fallback: single OTP input
    console.log(`[Step 8] Found ${otpCount} inputs — trying single OTP field`);
    const singleOtp = page.locator('input[placeholder*="OTP" i], input[placeholder*="code" i], input[type="tel"]').first();
    await singleOtp.fill(otp);
  }

  // Click verify
  const verifyBtn = page.locator('button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Submit")').first();
  await verifyBtn.click();
  console.log("[Step 8] Clicked Verify");

  // ── Step 9: Wait for redirect back to home and auto-submit ────────────────
  console.log("[Step 9] Waiting for /success page");
  await page.waitForURL(/\/success/, { timeout: 30_000 });
  console.log("[Step 9] PASS — on success page");

  // ── Step 10: Assert "Kaam No." is visible ────────────────────────────────
  console.log("[Step 10] Checking for Kaam No.");
  await expect(page.locator('text=Kaam No.')).toBeVisible({ timeout: 10_000 });

  const kaamText = await page.locator('text=Kaam No.').first().textContent();
  console.log(`[Step 10] PASS — visible: "${kaamText}"`);
});
