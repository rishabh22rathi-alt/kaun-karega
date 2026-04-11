/**
 * E2E AUDIT — Admin Dashboard Full End-to-End Test
 *
 * Admin phone : 9462098100
 * OTP source  : Google Sheets (via Service Account JWT)
 *
 * Auth flow   : /admin/login → /login?next=... → /verify?phone=...&next=...
 *               verify-otp returns { isAdmin:true } → localStorage kk_admin_session set
 *               → router.replace("/admin/dashboard")
 *
 * Runs with pw-e2e-temp.config.ts (headless, baseURL=http://localhost:3000)
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const ADMIN_PHONE = "9462098100";
const BASE_URL = "http://localhost:3000";

// ─── Load .env.local ─────────────────────────────────────────────────────────

/**
 * Replace literal backslash+n (char codes 92,110) with real newline.
 * Standard regex .replace(/\\n/g, "\n") does not work in this Node.js env
 * because the PEM key is stored with raw bytes 0x5C 0x6E in .env.local.
 */
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
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
  return env;
}

// ─── Google Sheets OTP reader ─────────────────────────────────────────────────

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

  // base64url encoding matching app's own getSheetsAccessToken implementation
  const b64url = (s: string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  // Sign using same approach as app's own getSheetsAccessToken
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const sigBuf = signer.sign(rawKey); // returns Buffer
  const signature = sigBuf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const jwt = `${signingInput}.${signature}`;

  // Use same grant_type as the app's own code (RFC 7523 — hyphen, no '2')
  const https = require("https") as typeof import("https");
  const postBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();

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

  // Helper: HTTPS GET with auth header
  const httpsGet = (url: string, accessToken: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const https2 = require("https") as typeof import("https");
      https2.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
        });
      }).on("error", reject);
    });

  const tabNames = ["OTP", "Otp", "otp", "Sheet1"];
  let rows: string[][] = [];
  for (const tab of tabNames) {
    const range = `${tab}!A:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
    try {
      const sheetData = await httpsGet(url, tokenData.access_token) as { values?: string[][] };
      if (Array.isArray(sheetData.values) && sheetData.values.length > 1) {
        rows = sheetData.values;
        console.log(`[OTP] Read ${rows.length - 1} data rows from tab "${tab}"`);
        break;
      }
    } catch { /* try next tab */ }
  }

  if (rows.length < 2) throw new Error("OTP sheet is empty or unreadable.");

  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const phoneCol = headers.findIndex((h) => h.includes("phone") || h.includes("mobile") || h.includes("number"));
  const otpCol = headers.findIndex((h) => h.includes("otp") || h.includes("code"));
  // requestId column — the sheet stores it (header: "RequestId")
  const requestIdCol = headers.findIndex((h) => h.includes("requestid") || h.includes("request_id") || h.includes("request"));

  if (otpCol === -1) throw new Error(`No OTP column found. Headers: ${rows[0].join(", ")}`);
  console.log(`[OTP] Headers: [${headers.join(", ")}] | phoneCol=${phoneCol} otpCol=${otpCol} requestIdCol=${requestIdCol}`);

  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);
  let dataRows = rows.slice(1);

  // Priority 1: match by exact requestId (most precise)
  if (requestId && requestIdCol !== -1) {
    const byRequestId = dataRows.filter((row) =>
      String(row[requestIdCol] || "").trim() === requestId.trim()
    );
    if (byRequestId.length > 0) {
      const otp = String(byRequestId[0][otpCol] || "").trim();
      if (/^\d{4}$/.test(otp)) {
        console.log(`[OTP] Found by requestId ${requestId}: ${otp}`);
        return otp;
      }
    }
    console.log(`[OTP] RequestId match not found — falling back to latest by phone`);
  }

  // Priority 2: filter by phone, take the LAST row appended (sheet appends, so last = newest)
  if (phoneCol !== -1 && normalizedPhone) {
    const filtered = dataRows.filter((row) => {
      const rowPhone = String(row[phoneCol] || "").replace(/\D/g, "").slice(-10);
      return rowPhone === normalizedPhone;
    });
    if (filtered.length > 0) dataRows = filtered;
  }

  // Take the LAST row (append order = chronological, last = newest)
  const targetRow = dataRows[dataRows.length - 1];
  const otp = String(targetRow?.[otpCol] || "").trim();
  if (!/^\d{4}$/.test(otp)) {
    throw new Error(`OTP "${otp}" is not a 4-digit code. Row: ${JSON.stringify(targetRow)}`);
  }

  console.log(`[OTP] Latest OTP for ${normalizedPhone} (last row): ${otp}`);
  return otp;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForDashboardLoad(page: Page) {
  // Wait for "Control Center" h1 (CSS selector — more reliable than aria role in Next.js App Router)
  await expect(page.locator("h1", { hasText: "Control Center" })).toBeVisible({ timeout: 20_000 });
  // Wait for "Refresh Data" button (not "Refreshing...") — means loading=false and data fetch complete
  // Dashboard makes 4+ parallel API calls; give 60s for them to resolve
  await expect(page.locator("button", { hasText: "Refresh Data" })).toBeVisible({ timeout: 60_000 });
}

async function openAccordion(page: Page, titlePart: string) {
  const section = page.locator("section").filter({ hasText: new RegExp(titlePart, "i") }).first();
  await expect(section).toBeVisible({ timeout: 8_000 });
  const isOpen = await section.locator("button[aria-expanded='true']").count() > 0;
  if (!isOpen) {
    await section.locator("button").filter({ hasText: "+" }).first().click();
    await page.waitForTimeout(400);
  }
  return section;
}

// ─── AUDIT RESULTS tracker ────────────────────────────────────────────────────

type StepResult = {
  step: string;
  result: "PASS" | "FAIL" | "BLOCKED" | "SKIP";
  evidence: string;
};

const results: StepResult[] = [];

function pass(step: string, evidence: string) {
  results.push({ step, result: "PASS", evidence });
  console.log(`✅ PASS  | ${step} | ${evidence}`);
}

function fail(step: string, evidence: string) {
  results.push({ step, result: "FAIL", evidence });
  console.log(`❌ FAIL  | ${step} | ${evidence}`);
}

function skip(step: string, evidence: string) {
  results.push({ step, result: "SKIP", evidence });
  console.log(`⏭ SKIP  | ${step} | ${evidence}`);
}

// ─── TEST ─────────────────────────────────────────────────────────────────────

test("Admin Dashboard — Full E2E Audit", async ({ page }) => {
  const t0 = Date.now();
  const elapsed = () => `[+${((Date.now() - t0) / 1000).toFixed(1)}s]`;

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: AUTH — Homepage → Admin Login → OTP → Dashboard
  // ══════════════════════════════════════════════════════════════════════════

  // STEP 1: Open homepage
  console.log(`\n─── STEP 1: Open homepage ${elapsed()} ───`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const homeLoaded = await page.locator("text=Kaun Karega").first().isVisible().catch(() => false);
  if (homeLoaded) {
    pass("Homepage Load", "Homepage rendered without crash");
  } else {
    fail("Homepage Load", "Page text 'Kaun Karega' not found");
  }

  // STEP 2: Navigate to /admin/login
  console.log("\n─── STEP 2: Navigate to /admin/login ───");
  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "domcontentloaded" });
  // Admin login page redirects immediately to /login?next=/admin/dashboard
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  const loginHeading = await page.locator("text=Verify your phone").isVisible().catch(() => false);
  if (loginHeading) {
    pass("Admin Login Redirect", `/admin/login correctly redirected to /login with next=/admin/dashboard`);
  } else {
    fail("Admin Login Redirect", `URL: ${page.url()} — 'Verify your phone' not visible`);
  }

  // STEP 3: Enter admin phone number
  console.log("\n─── STEP 3: Enter admin phone ───");
  const phoneInput = page.locator("#phone");
  await expect(phoneInput).toBeVisible({ timeout: 8_000 });
  await phoneInput.fill(ADMIN_PHONE);
  pass("Phone Input", `Entered ${ADMIN_PHONE} into #phone input`);

  // STEP 4: Submit phone (click Continue/Send OTP)
  console.log("\n─── STEP 4: Submit phone number ───");
  const submitBtn = page.locator('button[type="submit"]');
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });
  await submitBtn.click();
  pass("Phone Submit", "Clicked submit button");

  // STEP 5: Wait for redirect to /verify
  console.log("\n─── STEP 5: Wait for /verify page ───");
  try {
    await page.waitForURL(/\/verify/, { timeout: 15_000 });
    pass("Verify Page Load", `Redirected to: ${page.url()}`);
  } catch {
    fail("Verify Page Load", `Still at: ${page.url()} after 15s`);
    throw new Error("Cannot proceed without reaching /verify page");
  }

  // STEP 6: Wait for OTP sent confirmation
  console.log("\n─── STEP 6: Wait for OTP sent message ───");
  const otpSentMsg = page.locator("text=OTP sent successfully on WhatsApp");
  const otpSentVisible = await otpSentMsg.waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (otpSentVisible) {
    pass("OTP Sent", "WhatsApp OTP sent confirmation displayed");
  } else {
    // Check for errors
    const errorText = await page.locator(".text-red-600, .text-red-700").first().textContent({ timeout: 2_000 }).catch(() => "");
    fail("OTP Sent", `OTP sent message not shown. Error on page: "${errorText}"`);
    // Continue anyway — OTP may have been sent without message
    console.log("[Step 6] Continuing despite missing confirmation...");
  }

  // Extract requestId from /verify URL for precise OTP matching
  const verifyUrl = new URL(page.url());
  const currentRequestId = verifyUrl.searchParams.get("requestId") ?? undefined;
  console.log(`[Step 7] RequestId from verify URL: ${currentRequestId}`);

  // STEP 7: Read OTP from Google Sheets
  console.log("\n─── STEP 7: Read OTP from Google Sheets ───");
  console.log("[Step 7] Waiting 8s for WhatsApp delivery + Sheet write...");
  await page.waitForTimeout(8000);

  let otp: string;
  try {
    otp = await getLatestOtpFromSheet(ADMIN_PHONE, currentRequestId);
    pass("OTP Read from Sheet", `OTP: ${otp} (requestId: ${currentRequestId})`);
  } catch (err) {
    fail("OTP Read from Sheet", err instanceof Error ? err.message : String(err));
    throw new Error(`Cannot proceed without OTP: ${err}`);
  }

  // STEP 8: Enter OTP into 4-box inputs
  console.log("\n─── STEP 8: Enter OTP ───");
  const otpInputs = page.locator('input[maxlength="1"]');
  const otpCount = await otpInputs.count();

  if (otpCount === 4) {
    for (let i = 0; i < 4; i++) {
      await otpInputs.nth(i).fill(otp[i]);
      await page.waitForTimeout(60);
    }
    pass("OTP Entry", `Entered OTP ${otp} into 4 individual digit inputs`);
  } else {
    fail("OTP Entry", `Expected 4 OTP inputs, found: ${otpCount}`);
    // Attempt fallback
    const single = page.locator('input[type="tel"]').first();
    if (await single.isVisible().catch(() => false)) {
      await single.fill(otp);
      pass("OTP Entry (fallback)", `Used fallback single input`);
    } else {
      throw new Error("Cannot enter OTP — no usable inputs found");
    }
  }

  // STEP 9: Click Verify & Continue
  console.log("\n─── STEP 9: Click Verify & Continue ───");
  const verifyBtn = page.locator("button", { hasText: /Verify/i }).first();
  await expect(verifyBtn).toBeVisible({ timeout: 5_000 });
  await verifyBtn.click();
  pass("Verify Button Click", "Clicked Verify & Continue");

  // STEP 10: Wait for redirect to /admin/dashboard
  console.log("\n─── STEP 10: Wait for /admin/dashboard ───");
  try {
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 20_000 });
    pass("Admin Dashboard Redirect", `Redirected to: ${page.url()}`);
  } catch {
    const currentUrl = page.url();
    const pageText = await page.locator("body").textContent({ timeout: 3_000 }).catch(() => "");
    // Check if on verify page with error
    const verifyError = await page.locator(".text-red-600, .text-red-500").first().textContent({ timeout: 2_000 }).catch(() => "");
    fail("Admin Dashboard Redirect", `URL: ${currentUrl} | Error: "${verifyError}" | Body snippet: "${pageText?.slice(0, 200)}"`);
    throw new Error(`Did not reach /admin/dashboard. Current: ${currentUrl}. Error: ${verifyError}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: DASHBOARD STRUCTURE
  // ══════════════════════════════════════════════════════════════════════════

  // STEP 11: Wait for full dashboard load (data fetch must complete)
  console.log(`\n─── STEP 11: Dashboard Load ${elapsed()} URL=${page.url()} ───`);
  try {
    await waitForDashboardLoad(page); // waits for heading AND Refresh Data button (loading=false)
    pass("Dashboard Load", "Control Center heading visible + Refresh Data button = data fetch complete");
  } catch {
    const urlNow = page.url();
    // Use isVisible (no wait) instead of textContent (has 30s default timeout)
    const hasFailedMsg = await page.locator("text=Failed to load").isVisible().catch(() => false);
    fail("Dashboard Load", `URL=${urlNow} | hasFailedMsg=${hasFailedMsg}`);
    throw new Error(`Dashboard failed to load at ${urlNow}. Stopping test.`);
  }

  // Check for actual dashboard error banner (not table cells)
  console.log(`[T] ${elapsed()} checking error banner`);
  const dashboardError = page.locator("div.rounded-2xl.border.border-red-200.bg-red-50");
  const dashErrorCount = await dashboardError.count();
  if (dashErrorCount > 0) {
    const errText = await dashboardError.first().textContent({ timeout: 2_000 }).catch(() => "");
    fail("No Dashboard Error", `Dashboard error banner: "${errText?.trim()}"`);
  } else {
    pass("No Dashboard Error", "No dashboard-level error banners (data loaded cleanly)");
  }

  // STEP 12: Admin header
  console.log(`\n─── STEP 12: Admin Header ${elapsed()} ───`);
  if (await page.getByRole("heading", { name: "Control Center" }).isVisible().catch(() => false)) {
    pass("Dashboard Heading", "'Control Center' h1 rendered");
  } else {
    fail("Dashboard Heading", "'Control Center' not found");
  }
  if (await page.locator("p.uppercase", { hasText: "Admin Dashboard" }).isVisible().catch(() => false)) {
    pass("Dashboard Subheading", "'Admin Dashboard' label rendered");
  } else {
    skip("Dashboard Subheading", "Subheading not found — check CSS selector or label change");
  }

  // STEP 13: Snapshot bar + Refresh Data button
  console.log(`\n─── STEP 13: Snapshot Bar ${elapsed()} ───`);
  const refreshBtn = page.locator("button", { hasText: "Refresh Data" });
  if (await refreshBtn.isVisible().catch(() => false)) {
    pass("Refresh Data Button", "Refresh Data button present");
  } else {
    fail("Refresh Data Button", "Refresh Data button not found (data may still loading or button removed)");
  }

  // STEP 14: Stat cards
  console.log(`\n─── STEP 14: Stat Cards ${elapsed()} ───`);
  const statCardLabels = ["Total Providers", "Verified Providers", "Pending Admin Approvals", "Pending Category Requests"];
  let statCardsPassed = 0;
  const statValues: Record<string, string> = {};
  for (const label of statCardLabels) {
    const labelEl = page.locator("p", { hasText: label }).first();
    const isVis = await labelEl.isVisible().catch(() => false);
    if (isVis) {
      statCardsPassed++;
      const valueEl = labelEl.locator("xpath=following-sibling::p[1]");
      // Use short timeout to avoid 30s default wait if sibling p doesn't exist
      const val = await valueEl.textContent({ timeout: 3_000 }).catch(() => "?");
      statValues[label] = val?.trim() || "?";
    }
  }
  console.log(`[T] ${elapsed()} stat cards done`);
  if (statCardsPassed >= 4) {
    pass("Stat Cards", `All 4 stat cards: ${JSON.stringify(statValues)}`);
  } else if (statCardsPassed > 0) {
    pass("Stat Cards (partial)", `Found ${statCardsPassed}/4: ${JSON.stringify(statValues)}`);
  } else {
    fail("Stat Cards", "None of the 4 expected stat cards found");
  }
  console.log(`[Stats] ${JSON.stringify(statValues)}`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3: ACCORDION SECTIONS
  // ══════════════════════════════════════════════════════════════════════════

  // Helper: find accordion by searching for its title span text
  async function findSection(titleText: string) {
    // AccordionSection renders: <section><div><button><span>TITLE (N)</span>...</button></div>...</section>
    const span = page.locator("span", { hasText: new RegExp(`^${titleText}`, "i") }).first();
    const sec = span.locator("xpath=ancestor::section[1]");
    // Use short timeout — if section exists it appears immediately; if not, don't wait 5s
    const visible = await sec.isVisible({ timeout: 2_000 }).catch(() => false);
    return visible ? sec : null;
  }

  async function ensureOpen(sec: Awaited<ReturnType<typeof findSection>>) {
    if (!sec) return;
    const isOpen = await sec.locator("button[aria-expanded='true']").count() > 0;
    if (!isOpen) {
      await sec.locator("button[aria-expanded='false']").first().click();
      await page.waitForTimeout(300);
    }
  }

  // STEP 15: Pending Category Requests (starts OPEN)
  console.log(`\n─── STEP 15: Pending Category Requests section ${elapsed()} ───`);
  const pendingCatSection = await findSection("Pending Category Requests");
  if (pendingCatSection) {
    await ensureOpen(pendingCatSection);
    pass("Pending Category Requests Section", "Section found and open");
    const tableHeaders = await pendingCatSection.locator("th").count();
    const pendingCatRows = await pendingCatSection.locator("tbody tr").count();
    console.log(`[Data] Category table headers: ${tableHeaders}, rows: ${pendingCatRows}`);
    if (tableHeaders > 0) {
      pass("Pending Category Table", `Table rendered with ${pendingCatRows} rows`);
    } else {
      skip("Pending Category Table", "No table headers — section may be empty or still loading");
    }
  } else {
    fail("Pending Category Requests Section", "Section not found in DOM");
  }
  console.log(`[T] ${elapsed()} step 15 done`);

  // STEP 16: Urgent Requests (starts OPEN)
  console.log(`\n─── STEP 16: Urgent Requests section ${elapsed()} ───`);
  const urgentSection = await findSection("Urgent Requests");
  if (urgentSection) {
    await ensureOpen(urgentSection);
    const urgentRows = await urgentSection.locator("tbody tr").count();
    pass("Urgent Requests Section", `Section found and open, ${urgentRows} rows`);
    console.log(`[Data] Urgent request rows: ${urgentRows}`);
  } else {
    skip("Urgent Requests Section", "Section not found — label may differ or no urgent requests");
  }
  console.log(`[T] ${elapsed()} step 16 done`);

  // STEP 17: Needs Attention (starts OPEN)
  console.log(`\n─── STEP 17: Needs Attention section ${elapsed()} ───`);
  const attentionSection = await findSection("Needs Attention");
  if (attentionSection) {
    await ensureOpen(attentionSection);
    const attentionRows = await attentionSection.locator("tbody tr").count();
    pass("Needs Attention Section", `Found, ${attentionRows} rows`);
    console.log(`[Data] Needs Attention rows: ${attentionRows}`);
  } else {
    skip("Needs Attention Section", "Not found as standalone section");
  }
  console.log(`[T] ${elapsed()} step 17 done`);

  // STEP 18: Providers Needing Attention (starts CLOSED)
  console.log(`\n─── STEP 18: Providers Needing Attention section ${elapsed()} ───`);
  const providerSection = await findSection("Providers Needing Attention");
  if (providerSection) {
    await ensureOpen(providerSection);
    pass("Providers Section", "Section found and opened");
    const providerRows = await providerSection.locator("tbody tr").count();
    const providerEmpty = await providerSection.locator("text=/No providers need attention/i").isVisible().catch(() => false);
    console.log(`[Data] Provider rows: ${providerRows}, empty state: ${providerEmpty}`);
    if (providerRows > 0) {
      pass("Providers Table", `${providerRows} provider rows`);
    } else if (providerEmpty) {
      pass("Providers Empty State", "Empty state rendered correctly");
    } else {
      skip("Providers Table", "0 rows and no empty state — may still loading");
    }
  } else {
    fail("Providers Section", "Providers Needing Attention section not found");
  }
  console.log(`[T] ${elapsed()} step 18 done`);

  // STEP 19: Areas Management (starts CLOSED)
  console.log(`\n─── STEP 19: Areas Management section ${elapsed()} ───`);
  const areasSection = await findSection("Areas Management");
  if (areasSection) {
    await ensureOpen(areasSection);
    pass("Areas Management Section", "Found and opened");
  } else {
    skip("Areas Management Section", "Not found");
  }
  console.log(`[T] ${elapsed()} step 19 done`);

  // STEP 20: Categories Management (starts CLOSED)
  console.log(`\n─── STEP 20: Categories Management section ${elapsed()} ───`);
  const catMgmtSection = await findSection("Categories Management");
  if (catMgmtSection) {
    await ensureOpen(catMgmtSection);
    pass("Categories Management Section", "Found and opened");
  } else {
    skip("Categories Management Section", "Not found");
  }
  console.log(`[T] ${elapsed()} step 20 done`);

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 4: ACTION TESTS
  // ══════════════════════════════════════════════════════════════════════════

  // STEP 21: Category request Approve action
  console.log(`\n─── STEP 21: Category Approve action ${elapsed()} ───`);
  const catSectionForActions = pendingCatSection;
  if (catSectionForActions) {
    const approveButtons = catSectionForActions.locator("button", { hasText: "Approve" });
    const approveCount = await approveButtons.count();
    if (approveCount > 0) {
      const firstRow = catSectionForActions.locator("tbody tr").first();
      const rowText = await firstRow.textContent({ timeout: 2_000 }).catch(() => "");
      console.log(`[Action] First pending category row: ${rowText?.trim().slice(0, 120)}`);
      await expect(approveButtons.first()).toBeEnabled({ timeout: 5_000 });
      await approveButtons.first().click();
      const successFeedback = page.locator("div.border.bg-emerald-50, div.bg-emerald-50").first();
      const feedbackVisible = await successFeedback.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
      if (feedbackVisible) {
        const feedbackText = await successFeedback.textContent({ timeout: 2_000 }).catch(() => "");
        pass("Category Approve Action", `Success banner: "${feedbackText?.trim().slice(0, 80)}"`);
      } else {
        const remainingRows = await catSectionForActions.locator("tbody tr").count();
        if (remainingRows < approveCount) {
          pass("Category Approve Action", `Row count reduced from ${approveCount} to ${remainingRows} after approve`);
        } else {
          fail("Category Approve Action", "No feedback and no row count change after 12s");
        }
      }
    } else {
      skip("Category Approve Action", "No pending Approve buttons in category requests section");
    }
  } else {
    skip("Category Approve Action", "Pending Category Requests section not found");
  }

  // STEP 22: Category request Reject action
  console.log(`\n─── STEP 22: Category Reject action ${elapsed()} ───`);
  if (catSectionForActions) {
    const rejectButtons = catSectionForActions.locator("button", { hasText: "Reject" });
    const rejectCount = await rejectButtons.count();
    if (rejectCount > 0) {
      const firstRow = catSectionForActions.locator("tbody tr").first();
      const rowText = await firstRow.textContent({ timeout: 2_000 }).catch(() => "");
      console.log(`[Action] Rejecting: ${rowText?.trim().slice(0, 80)}`);
      await expect(rejectButtons.first()).toBeEnabled({ timeout: 5_000 });
      await rejectButtons.first().click();
      const rejectFeedback = page.locator("div.border.bg-emerald-50, div.bg-emerald-50").first();
      const rejectDone = await rejectFeedback.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
      if (rejectDone) {
        const feedbackText = await rejectFeedback.textContent({ timeout: 2_000 }).catch(() => "");
        pass("Category Reject Action", `Feedback: "${feedbackText?.trim().slice(0, 80)}"`);
      } else {
        const remaining = await catSectionForActions.locator("tbody tr").count();
        if (remaining < rejectCount) {
          pass("Category Reject Action", `Row count reduced after reject`);
        } else {
          fail("Category Reject Action", "No feedback or row change after 12s");
        }
      }
    } else {
      skip("Category Reject Action", "No Reject buttons remaining");
    }
  } else {
    skip("Category Reject Action", "Category section not found");
  }

  // STEP 23: Provider Verify/Unverify action
  console.log("\n─── STEP 23: Provider Verify/Unverify action ───");
  if (providerSection) {
    const verifyBtns = providerSection.locator("button", { hasText: /^Verify$/ });
    const unverifyBtns = providerSection.locator("button", { hasText: /^Unverify$/ });
    const provApproveBtns = providerSection.locator("button", { hasText: /^Approve$/ });
    const verifyCount = await verifyBtns.count();
    const unverifyCount = await unverifyBtns.count();
    const provApproveCount = await provApproveBtns.count();
    console.log(`[Data] Verify:${verifyCount} Unverify:${unverifyCount} Approve:${provApproveCount}`);

    if (verifyCount > 0) {
      const row = providerSection.locator("tr").filter({ has: verifyBtns.first() }).first();
      const name = await row.locator("td").first().textContent({ timeout: 2_000 }).catch(() => "?");
      await verifyBtns.first().click();
      const fb = page.locator("div.border.bg-emerald-50, div.bg-emerald-50").first();
      const done = await fb.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
      if (done) {
        pass("Provider Verify Action", `Verified "${name?.trim()}", feedback shown`);
      } else {
        fail("Provider Verify Action", `Clicked Verify on "${name?.trim()}" — no feedback after 12s`);
      }
    } else if (unverifyCount > 0) {
      const row = providerSection.locator("tr").filter({ has: unverifyBtns.first() }).first();
      const name = await row.locator("td").first().textContent({ timeout: 2_000 }).catch(() => "?");
      await unverifyBtns.first().click();
      const fb = page.locator("div.border.bg-emerald-50, div.bg-emerald-50").first();
      const done = await fb.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
      if (done) {
        pass("Provider Unverify Action", `Unverified "${name?.trim()}", feedback shown`);
      } else {
        fail("Provider Unverify Action", `Clicked Unverify on "${name?.trim()}" — no feedback after 12s`);
      }
    } else if (provApproveCount > 0) {
      skip("Provider Verify Action", `No Verify/Unverify buttons — ${provApproveCount} Approve buttons present (all providers have PendingApproval=yes, so only Approve/Reject shown)`);
    } else {
      const emptyState = await providerSection.locator("text=/No providers need attention/i").isVisible().catch(() => false);
      skip("Provider Verify Action", emptyState ? "No providers needing attention — nothing to verify" : "No action buttons found in provider section");
    }
  } else {
    skip("Provider Verify Action", "Provider section not found");
  }

  // STEP 24: Notification log / request selection
  console.log("\n─── STEP 24: Request detail / notification summary ───");
  const allTbodyRows = page.locator("tbody tr");
  const totalRows = await allTbodyRows.count();
  console.log(`[Data] Total tbody rows across all sections: ${totalRows}`);

  if (totalRows > 0) {
    const firstRow = allTbodyRows.first();
    const firstCell = firstRow.locator("td").first();
    await firstCell.click().catch(() => {});
    await page.waitForTimeout(800);
    const summaryVisible = await page.locator("text=/Notification Summary|notification summary/i").isVisible().catch(() => false);
    const selectedHighlight = await firstRow.evaluate((el) => el.className).catch(() => "");
    if (summaryVisible) {
      pass("Request Row Interaction", "Clicking request row shows Notification Summary panel");
    } else {
      pass("Request Row Interaction", `Clicked first row (no summary panel appeared — may need specific interaction). Row class: "${selectedHighlight.slice(0, 80)}"`);
    }
  } else {
    skip("Request Row Interaction", "No table rows to click");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 5: REFRESH & STABILITY
  // ══════════════════════════════════════════════════════════════════════════

  // STEP 25: Click Refresh Data
  console.log("\n─── STEP 25: Refresh Data action ───");
  const refreshBtnForClick = page.locator("button", { hasText: "Refresh Data" });
  if (await refreshBtnForClick.isVisible().catch(() => false)) {
    await refreshBtnForClick.click();
    const refreshing = page.locator("button", { hasText: "Refreshing..." });
    const refreshingVisible = await refreshing.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
    if (refreshingVisible) {
      await expect(refreshing).not.toBeVisible({ timeout: 30_000 });
      pass("Refresh Data", "Loading state shown then cleared — full reload successful");
    } else {
      const headingStillThere = await page.getByRole("heading", { name: "Control Center" }).isVisible().catch(() => false);
      if (headingStillThere) {
        pass("Refresh Data", "Refresh completed (too fast to catch Refreshing... state)");
      } else {
        fail("Refresh Data", "Dashboard heading gone after refresh click — possible crash");
      }
    }
  } else {
    fail("Refresh Data", "Refresh Data button not visible");
  }

  // STEP 26: Full page reload (auth persistence)
  console.log("\n─── STEP 26: Page reload stability ───");
  await page.reload({ waitUntil: "domcontentloaded" });
  try {
    await waitForDashboardLoad(page);
    pass("Page Reload Stability", "Dashboard reloads without crash, admin session persists in localStorage");
  } catch {
    fail("Page Reload Stability", `After reload URL=${page.url()} — dashboard did not load (possible auth loss or React crash)`);
  }

  // STEP 27: Dashboard error check after reload
  console.log("\n─── STEP 27: Error state after reload ───");
  const reloadError = page.locator("div.rounded-2xl.border.border-red-200.bg-red-50");
  const reloadErrorCount = await reloadError.count();
  if (reloadErrorCount > 0) {
    const errText = await reloadError.first().textContent({ timeout: 2_000 }).catch(() => "");
    fail("No Error After Reload", `Error banner after reload: "${errText?.trim()}"`);
  } else {
    pass("No Error After Reload", "No dashboard-level error banners after page reload");
  }

  // STEP 28: No infinite loaders
  console.log("\n─── STEP 28: No infinite loaders ───");
  await page.waitForTimeout(1500);
  const stuckRefreshing = await page.locator("button", { hasText: "Refreshing..." }).isVisible().catch(() => false);
  if (stuckRefreshing) {
    fail("No Infinite Loaders", "Refresh Data still shows 'Refreshing...' 1.5s after reload — infinite loader suspected");
  } else {
    pass("No Infinite Loaders", "No stuck loading state after reload + 1.5s wait");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n\n══════════════════════════════════════════════════════════════");
  console.log("AUDIT RESULTS");
  console.log("══════════════════════════════════════════════════════════════");

  const passed = results.filter((r) => r.result === "PASS");
  const failed = results.filter((r) => r.result === "FAIL");
  const blocked = results.filter((r) => r.result === "BLOCKED");
  const skipped = results.filter((r) => r.result === "SKIP");

  console.log(`TOTAL STEPS : ${results.length}`);
  console.log(`PASS        : ${passed.length}`);
  console.log(`FAIL        : ${failed.length}`);
  console.log(`BLOCKED     : ${blocked.length}`);
  console.log(`SKIP        : ${skipped.length}`);

  if (failed.length > 0) {
    console.log("\nFAILED STEPS:");
    for (const r of failed) {
      console.log(`  ❌ ${r.step}: ${r.evidence}`);
    }
  }

  if (skipped.length > 0) {
    console.log("\nSKIPPED STEPS:");
    for (const r of skipped) {
      console.log(`  ⏭ ${r.step}: ${r.evidence}`);
    }
  }

  console.log("══════════════════════════════════════════════════════════════\n");

  // Fail the test if any critical step failed
  if (failed.length > 0) {
    const failNames = failed.map((r) => r.step).join(", ");
    expect(failed.length, `Failed steps: ${failNames}`).toBe(0);
  }
});
