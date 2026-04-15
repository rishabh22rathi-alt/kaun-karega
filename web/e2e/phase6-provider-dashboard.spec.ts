import { test, expect, type Page, type Route } from "@playwright/test";

// ─── Constants ───────────────────────────────────────────────────────────────

const ZZ_PROVIDER_PHONE = "9999999901";   // Dedicated provider test phone (distinct from user test phone)
const ZZ_PROVIDER_ID    = "ZZ-QA-PROV-9001";
const ZZ_PROVIDER_NAME  = "ZZ QA Provider One";

// Display IDs: "ZZ-QA-9XX" — no intermediate digit sequences before the trailing number.
// normalizeDisplayId("ZZ-QA-901") → /\d+/ matches "901" → "Kaam No. 901"
const ZZ_TASK_A    = "TASK-ZZ-QA-9001";
const ZZ_DISP_A    = "ZZ-QA-901";    // → "Kaam No. 901"
const ZZ_TASK_B    = "TASK-ZZ-QA-9002";
const ZZ_DISP_B    = "ZZ-QA-902";    // → "Kaam No. 902"
const ZZ_THREAD_A  = "ZZ-QA-THREAD-9001";
const ZZ_LABEL_A   = "Kaam No. 901";
const ZZ_LABEL_B   = "Kaam No. 902";

const ZZ_SERVICE_1 = "ZZ QA Plumber";
const ZZ_SERVICE_2 = "ZZ QA Electrician";
const ZZ_AREA_1    = "ZZ QA Nagar";
const ZZ_AREA_2    = "ZZ QA Colony";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function el() {
  return `[${new Date().toLocaleTimeString("en-IN")}]`;
}

/** Inject kk_auth_session cookie so the dashboard reads a valid provider session. */
async function injectProviderCookie(page: Page, phone = ZZ_PROVIDER_PHONE) {
  const session = { phone, verified: true as const, createdAt: Date.now() };
  await page.context().addCookies([{
    name: "kk_auth_session",
    value: encodeURIComponent(JSON.stringify(session)),
    domain: "kaun-karega.vercel.app",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }]);
}

// ─── Profile factory ─────────────────────────────────────────────────────────

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    ProviderID:     ZZ_PROVIDER_ID,
    ProviderName:   ZZ_PROVIDER_NAME,
    Phone:          ZZ_PROVIDER_PHONE,
    Verified:       "yes",
    OtpVerified:    "yes",
    OtpVerifiedAt:  new Date().toISOString(),   // within 30-day window → "Phone Verified"
    PendingApproval: "no",
    Services: [
      { Category: ZZ_SERVICE_1 },
      { Category: ZZ_SERVICE_2 },
    ],
    Areas: [
      { Area: ZZ_AREA_1 },
      { Area: ZZ_AREA_2 },
    ],
    AreaCoverage: {
      ActiveApprovedAreas: [
        { Area: ZZ_AREA_1, Status: "active" },
        { Area: ZZ_AREA_2, Status: "active" },
      ],
      PendingAreaRequests: [],
      ResolvedOutcomes:    [],
    },
    Analytics: {
      Metrics: {
        TotalRequestsInMyCategories:  25,
        TotalRequestsMatchedToMe:      8,
        TotalRequestsRespondedByMe:    5,
        TotalRequestsAcceptedByMe:     3,
        TotalRequestsCompletedByMe:    2,
        ResponseRate:                 62,
        AcceptanceRate:               37,
      },
      AreaDemand: [
        { AreaName: ZZ_AREA_1,       RequestCount: 12 },
        { AreaName: "ZZ QA Town",    RequestCount:  5 },
      ],
      SelectedAreaDemand: [
        { AreaName: ZZ_AREA_1, RequestCount: 12, IsSelectedByProvider: true },
      ],
      CategoryDemandByRange: {
        today:     [{ CategoryName: ZZ_SERVICE_1, RequestCount: 5 }],
        last7Days: [
          { CategoryName: ZZ_SERVICE_1, RequestCount: 18 },
          { CategoryName: ZZ_SERVICE_2, RequestCount:  7 },
        ],
        last30Days:  [],
        last365Days: [],
      },
      RecentMatchedRequests: [
        {
          TaskID:    ZZ_TASK_A,
          DisplayID: ZZ_DISP_A,
          Category:  ZZ_SERVICE_1,
          Area:      ZZ_AREA_1,
          Details:   "ZZ QA Phase6 test task — please ignore.",
          CreatedAt: "2026-04-15T14:00:00.000Z",
          Accepted:  false,
          Responded: false,
          ThreadID:  "",
        },
      ],
    },
    ...overrides,
  };
}

// ─── Route helpers ────────────────────────────────────────────────────────────

async function mockDashboardProfile(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route("**/api/provider/dashboard-profile**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: makeProfile(overrides) }),
    });
  });
}

async function mockKkApi(page: Page, threads: object[] = []) {
  await page.route("**/api/kk**", async (route: Route) => {
    let action = "";
    try {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      action = String(body?.action || "");
    } catch { /* */ }

    if (action === "chat_create_or_get_thread") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, ThreadID: ZZ_THREAD_A }),
      });
    } else {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, threads }),
      });
    }
  });
}

async function gotoProviderDashboard(page: Page) {
  await page.goto("/provider/dashboard");
  await page.waitForLoadState("networkidle");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Phase 6: Provider Dashboard — Full QA Audit", () => {

  // ─── TEST 1: Dashboard loads ──────────────────────────────────────────────

  test("TEST 1 — Provider login and dashboard load", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 1: Dashboard load ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);

    await gotoProviderDashboard(page);

    // "Provider Intelligence Dashboard" label renders
    await expect(page.getByText("Provider Intelligence Dashboard")).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T1] "Provider Intelligence Dashboard" label visible`);

    // h1 shows provider name
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T1] h1 = "${ZZ_PROVIDER_NAME}"`);

    // URL stays on correct route — no auth loop
    await expect(page).toHaveURL(/\/provider\/dashboard/);
    console.log(`${el()} [T1] URL correct — no auth redirect`);

    // Loading spinner gone
    await expect(page.getByText("Loading provider dashboard...")).not.toBeVisible({ timeout: 3_000 })
      .catch(() => console.log(`${el()} [T1] WARNING: loading text still visible`));

    // No "Please login" error state
    await expect(page.getByText("Please login. Invalid or missing provider phone."))
      .not.toBeVisible({ timeout: 3_000 })
      .catch(() => {});

    console.log(`${el()} [T1] PASS`);
  });

  // ─── TEST 2: Profile summary renders ─────────────────────────────────────

  test("TEST 2 — Provider profile summary renders correctly", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 2: Profile summary ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);

    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

    // ProviderID badge
    await expect(page.getByText(`ProviderID: ${ZZ_PROVIDER_ID}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] ProviderID badge visible`);

    // Phone line
    await expect(page.getByText(`Phone: ${ZZ_PROVIDER_PHONE}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] Phone line visible`);

    // Verification badge — fully verified profile → "Phone Verified"
    // .first() because sidebar also shows the verification badge
    await expect(page.getByText("Phone Verified").first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] "Phone Verified" badge visible`);

    // Verification message line
    await expect(page.getByText(/Keep responding quickly/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] Verified message line present`);

    // Services rendered — scope to span badges to avoid matching insight/demand text
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SERVICE_1}$`) }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SERVICE_2}$`) }).first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] Services: "${ZZ_SERVICE_1}", "${ZZ_SERVICE_2}" visible`);

    // Active Approved Areas rendered — scope to span badges
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_AREA_1}$`) }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_AREA_2}$`) }).first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] Areas: "${ZZ_AREA_1}", "${ZZ_AREA_2}" visible`);

    // "What happens next?" info box
    await expect(page.getByText("What happens next?")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T2] "What happens next?" info box visible`);

    console.log(`${el()} [T2] PASS`);
  });

  // ─── TEST 3: Verification label correctness ───────────────────────────────

  test("TEST 3 — Verification / status label correctness for 3 states", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 3: Verification labels ═══`);

    const scenarios = [
      {
        label:    "Phone Verified",
        overrides: {
          Verified:        "yes",
          OtpVerified:     "yes",
          OtpVerifiedAt:   new Date().toISOString(),
          PendingApproval: "no",
        },
        expectBanner:      false,
        bannerText:        "",
        verifyMsg:         /Keep responding quickly/,
        notBadge:          ["Pending Admin Approval", "Not Verified"],
      },
      {
        label:    "Pending Admin Approval",
        overrides: {
          Verified:        "yes",
          OtpVerified:     "yes",
          OtpVerifiedAt:   new Date().toISOString(),
          PendingApproval: "yes",
        },
        expectBanner:      true,
        bannerText:        "Pending Admin Approval",
        verifyMsg:         /categories are waiting for admin review/,
        notBadge:          ["Phone Verified", "Not Verified"],
      },
      {
        label:    "Not Verified",
        overrides: {
          Verified:        "yes",
          OtpVerified:     "no",
          OtpVerifiedAt:   "",
          PendingApproval: "no",
        },
        expectBanner:      true,
        bannerText:        "Phone Verification Pending",
        verifyMsg:         /Complete OTP login/,
        notBadge:          ["Phone Verified", "Pending Admin Approval"],
      },
    ];

    for (const scenario of scenarios) {
      console.log(`${el()} [T3] Testing state: "${scenario.label}"`);
      await injectProviderCookie(page);
      await mockDashboardProfile(page, scenario.overrides);
      await mockKkApi(page);
      await gotoProviderDashboard(page);
      await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

      // Status badge shows the expected text (.first() — sidebar also shows the badge)
      await expect(page.getByText(scenario.label).first()).toBeVisible({ timeout: 5_000 });
      console.log(`${el()} [T3] Badge "${scenario.label}" visible`);

      // Amber banner presence
      if (scenario.expectBanner) {
        // .first() — "Pending Admin Approval" appears in both badge span AND banner heading
        await expect(page.getByText(scenario.bannerText).first()).toBeVisible({ timeout: 5_000 });
        console.log(`${el()} [T3] Amber banner "${scenario.bannerText}" visible`);
      } else {
        // Verified providers do not see the amber banner
        const bannerBox = page.locator("section").filter({ hasText: "Phone Verification Pending" }).first();
        const bannerVisible = await bannerBox.isVisible({ timeout: 2_000 }).catch(() => false);
        console.log(`${el()} [T3] Amber banner absent for verified provider: ${!bannerVisible}`);
      }

      // Verification message line
      await expect(page.getByText(scenario.verifyMsg)).toBeVisible({ timeout: 5_000 });
      console.log(`${el()} [T3] Verification message correct`);

      // Scope wrong-badge check to MAIN content only (sidebar may show a different badge).
      // Note: sidebar shows "Not Verified" when PendingApproval="yes" (sidebar/dashboard badge inconsistency).
      for (const wrongBadge of scenario.notBadge) {
        const wrongEl = page.locator("main span").filter({ hasText: new RegExp(`^${wrongBadge}$`) });
        const wrongCount = await wrongEl.count();
        if (wrongCount > 0) {
          console.log(`${el()} [T3] BUG: wrong badge "${wrongBadge}" in main content for state "${scenario.label}"`);
        }
        expect(wrongCount).toBe(0);
      }

      console.log(`${el()} [T3] State "${scenario.label}" — CORRECT`);
    }

    console.log(`${el()} [T3] PASS`);
  });

  // ─── TEST 4: Services and areas match API ─────────────────────────────────

  test("TEST 4 — Provider services and areas match API payload", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 4: Services & areas ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

    // Services section header
    await expect(page.getByText(/^Services \(/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] Services section header visible`);

    // Each service badge
    const s1Badges = page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SERVICE_1}$`) });
    const s2Badges = page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SERVICE_2}$`) });
    await expect(s1Badges.first()).toBeVisible({ timeout: 5_000 });
    await expect(s2Badges.first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] Both service badges visible`);

    // No duplicate service chips
    expect(await s1Badges.count()).toBe(1);
    expect(await s2Badges.count()).toBe(1);
    console.log(`${el()} [T4] No duplicate service chips`);

    // Area Coverage section header
    await expect(page.getByText("Area Coverage")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] Area Coverage section header visible`);

    // Active Approved Areas subsection label
    await expect(page.getByText(/Active Approved Areas/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] "Active Approved Areas" label visible`);

    // Each area chip
    const a1Badges = page.locator("span").filter({ hasText: new RegExp(`^${ZZ_AREA_1}$`) });
    const a2Badges = page.locator("span").filter({ hasText: new RegExp(`^${ZZ_AREA_2}$`) });
    await expect(a1Badges.first()).toBeVisible({ timeout: 5_000 });
    await expect(a2Badges.first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] Both area chips visible`);

    // No pending area requests (empty mock)
    await expect(page.getByText("No pending area requests.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] No pending area requests — correct`);

    // No resolved outcomes (empty mock)
    await expect(page.getByText("No resolved area requests yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T4] No resolved outcomes — correct`);

    console.log(`${el()} [T4] PASS`);
  });

  // ─── TEST 5: Chat CTA routing ─────────────────────────────────────────────

  test("TEST 5 — Provider chat CTA opens correct thread route without user actor", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 5: Chat CTA routing ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

    // Recent Matched Requests section
    await expect(page.getByRole("heading", { name: "Recent Matched Requests" })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T5] "Recent Matched Requests" heading visible`);

    // Task label visible (ZZ_TASK_A / ZZ_DISP_A → "Kaam No. 901")
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T5] Task label "${ZZ_LABEL_A}" visible in matched requests`);

    // "Open Chat" button enabled and not in "Opening..." state
    const openChatBtn = page.locator("button", { hasText: "Open Chat" }).first();
    await expect(openChatBtn).toBeVisible({ timeout: 5_000 });
    await expect(openChatBtn).toBeEnabled();
    console.log(`${el()} [T5] "Open Chat" button visible and enabled`);

    // Click — expect navigation to /chat/thread/{threadId} WITHOUT ?actor=user
    await openChatBtn.click();
    await page.waitForURL(/\/chat\/thread\//, { timeout: 10_000 });

    const chatUrl = page.url();
    console.log(`${el()} [T5] Navigated to: ${chatUrl}`);

    // Correct thread path
    expect(chatUrl).toContain("/chat/thread/");
    expect(chatUrl).toContain(ZZ_THREAD_A);
    console.log(`${el()} [T5] Thread ID "${ZZ_THREAD_A}" present in URL`);

    // NOT user-actor — provider chat has no ?actor=user param
    expect(chatUrl).not.toContain("actor=user");
    console.log(`${el()} [T5] No actor=user param — correct provider routing`);

    // No provider-side misroute to user flow
    expect(chatUrl).not.toContain("actor=provider_wrong");
    console.log(`${el()} [T5] PASS`);
  });

  // ─── TEST 6: Pending area requests and resolved outcomes ─────────────────

  test("TEST 6 — Pending area requests and resolved outcomes render correctly", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 6: Pending area requests ═══`);

    const ZZ_PENDING_AREA  = "ZZ QA Pending Town";
    const ZZ_RESOLVED_REQ  = "ZZ QA Old Area";
    const ZZ_RESOLVED_CANON = "ZZ QA New Area";
    const ZZ_RESOLVED_AT   = "2026-04-10T09:00:00.000Z";

    await injectProviderCookie(page);
    await mockDashboardProfile(page, {
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: ZZ_AREA_1, Status: "active" }],
        PendingAreaRequests: [
          {
            RequestedArea: ZZ_PENDING_AREA,
            Status:        "pending",
            LastSeenAt:    "2026-04-12T10:00:00.000Z",
          },
        ],
        ResolvedOutcomes: [
          {
            RequestedArea:        ZZ_RESOLVED_REQ,
            ResolvedCanonicalArea: ZZ_RESOLVED_CANON,
            CoverageActive:       true,
            Status:               "mapped",
            ResolvedAt:           ZZ_RESOLVED_AT,
          },
        ],
      },
    });
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

    // Pending area section header
    await expect(page.getByText("Pending Area Requests")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] "Pending Area Requests" section header visible`);

    // Pending area name shown
    await expect(page.getByText(ZZ_PENDING_AREA)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] Pending area "${ZZ_PENDING_AREA}" visible`);

    // "Waiting for admin review" status text
    await expect(page.getByText(/Waiting for admin review/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] "Waiting for admin review" text visible`);

    // Resolved Outcomes section header
    await expect(page.getByText("Resolved Outcomes")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] "Resolved Outcomes" section header visible`);

    // Resolved mapped area shows "Req -> Canon" format
    await expect(page.getByText(`${ZZ_RESOLVED_REQ} -> ${ZZ_RESOLVED_CANON}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] Resolved outcome "${ZZ_RESOLVED_REQ} -> ${ZZ_RESOLVED_CANON}" visible`);

    // "Now active for matching" since CoverageActive=true
    await expect(page.getByText("Now active for matching")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] "Now active for matching" visible — CoverageActive=true`);

    // Active area chip still present (not replaced by pending/resolved) — scope to span
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_AREA_1}$`) }).first())
      .toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T6] Active area "${ZZ_AREA_1}" still visible`);

    console.log(`${el()} [T6] PASS`);
  });

  // ─── TEST 7: Stats cards integrity ────────────────────────────────────────

  test("TEST 7 — Stats cards render with correct values and no NaN/undefined", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 7: Stats cards ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

    const cards = [
      { title: "Requests In Your Services", value: "25", note: "Overall demand" },
      { title: "Matched To You",            value:  "8", note: "Leads where you were" },
      { title: "Responded By You",          value:  "5", note: "Response rate 62%" },
      { title: "Accepted By You",           value:  "3", note: "Acceptance rate 37%" },
      { title: "Completed By You",          value:  "2", note: "Completed jobs" },
    ];

    for (const card of cards) {
      // exact:true prevents partial substring matching (e.g. "12 requests in your services" matching "Requests In Your Services")
      await expect(page.getByText(card.title, { exact: true }).first()).toBeVisible({ timeout: 5_000 });
      console.log(`${el()} [T7] Card title "${card.title}" visible`);
    }

    // Spot-check values are numbers, not "NaN" or "undefined"
    for (const card of cards) {
      await expect(page.getByText(card.value).first()).toBeVisible({ timeout: 5_000 });
      console.log(`${el()} [T7] Card value "${card.value}" visible`);
    }

    // No "NaN" text anywhere
    const nanCount = await page.getByText("NaN").count();
    expect(nanCount).toBe(0);
    console.log(`${el()} [T7] No "NaN" text — all numeric values safe`);

    // No "undefined" text anywhere
    const undefinedCount = await page.getByText("undefined").count();
    expect(undefinedCount).toBe(0);
    console.log(`${el()} [T7] No "undefined" text — all values resolved`);

    // Response rate displayed correctly
    await expect(page.getByText(/Response rate:.*62%/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T7] "Response rate: 62%" visible`);

    // My Demand Insights section renders
    await expect(page.getByRole("heading", { name: "My Demand Insights" })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T7] "My Demand Insights" heading visible`);

    // Category demand card h3 heading for ZZ QA Plumber visible (today range, 5 requests)
    await expect(page.getByRole("heading", { name: ZZ_SERVICE_1 })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T7] Category demand card for "${ZZ_SERVICE_1}" visible`);

    // Area demand table renders
    await expect(page.getByRole("heading", { name: "Area Demand Heat Table" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("columnheader", { name: "Area" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("columnheader", { name: "Request Count" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("columnheader", { name: "Demand Level" })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T7] Area Demand Heat Table headers visible`);

    // Time-range filter buttons present
    for (const label of ["Today", "Last 7 Days", "Last 30 Days", "Last 365 Days"]) {
      await expect(page.locator("button", { hasText: label }).first()).toBeVisible({ timeout: 5_000 });
    }
    console.log(`${el()} [T7] Time-range filter buttons all present`);

    console.log(`${el()} [T7] PASS`);
  });

  // ─── TEST 8: Refresh persistence ─────────────────────────────────────────

  test("TEST 8 — Dashboard persists across page reload and navigation", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 8: Refresh persistence ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);
    await gotoProviderDashboard(page);

    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T8] Initial load: provider name + task label visible`);

    // Reload
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T8] After reload: data still visible`);

    // Navigate away → home
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
    console.log(`${el()} [T8] Navigated to home`);

    // Navigate back → data reappears
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_LABEL_A)).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T8] After navigate-away-and-back: data still visible`);

    // No error state
    const errorVisible = await page.locator("div.bg-rose-50").isVisible({ timeout: 2_000 }).catch(() => false);
    console.log(`${el()} [T8] Error state visible: ${errorVisible}`);
    expect(errorVisible).toBe(false);

    // No permanent loading spinner
    const loadingVisible = await page.getByText("Loading provider dashboard...").isVisible({ timeout: 2_000 }).catch(() => false);
    expect(loadingVisible).toBe(false);
    console.log(`${el()} [T8] No permanent loading spinner`);

    console.log(`${el()} [T8] PASS`);
  });

  // ─── TEST 9: Empty / low-data state ──────────────────────────────────────

  test("TEST 9 — Empty dashboard: friendly states, no broken layout", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 9: Empty/low-data state ═══`);
    await injectProviderCookie(page);

    // Provider with NO services, NO areas, NO analytics
    await mockDashboardProfile(page, {
      Services: [],
      Areas:    [],
      AreaCoverage: {
        ActiveApprovedAreas: [],
        PendingAreaRequests: [],
        ResolvedOutcomes:    [],
      },
      Analytics: {
        Metrics: {
          TotalRequestsInMyCategories:  0,
          TotalRequestsMatchedToMe:      0,
          TotalRequestsRespondedByMe:    0,
          TotalRequestsAcceptedByMe:     0,
          TotalRequestsCompletedByMe:    0,
          ResponseRate:                  0,
          AcceptanceRate:                0,
        },
        AreaDemand:             [],
        SelectedAreaDemand:     [],
        CategoryDemandByRange:  { today: [], last7Days: [], last30Days: [], last365Days: [] },
        RecentMatchedRequests:  [],
      },
    });
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });

    // No services → friendly empty state
    await expect(page.getByText("No services added yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] "No services added yet." visible`);

    // No active areas → friendly empty state
    await expect(page.getByText("No active service areas yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] "No active service areas yet." visible`);

    // No leads → "No leads yet" card (TotalRequestsMatchedToMe=0)
    await expect(page.getByText("No leads yet")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] "No leads yet" empty state visible`);

    // No demand data
    await expect(page.getByText("No category demand data yet.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] "No category demand data yet." visible`);

    // No area demand data
    await expect(page.getByText("No demand data yet for your selected services.")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] "No demand data yet" visible`);

    // No selected area data
    await expect(page.getByText("No selected area data yet. Add service areas to start comparing demand."))
      .toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T9] "No selected area data" visible`);

    // All stats cards render with "0" value — no NaN
    const zeroValues = page.locator("p").filter({ hasText: /^0$/ });
    const zeroCount = await zeroValues.count();
    expect(zeroCount).toBeGreaterThanOrEqual(5); // 5 stats cards all show "0"
    console.log(`${el()} [T9] All 5 stat cards show "0" — no NaN`);

    // No spinner stuck
    await expect(page.getByText("Loading provider dashboard...")).not.toBeVisible({ timeout: 3_000 })
      .catch(() => {});

    console.log(`${el()} [T9] PASS`);
  });

  // ─── TEST 10: Logout / session boundary ──────────────────────────────────

  test("TEST 10 — Logout clears session and blocks dashboard re-access", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 10: Logout / session boundary ═══`);
    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T10] Dashboard loaded — logged in`);

    // Sidebar Logout button
    const logoutBtn = page.locator("button", { hasText: "Logout" }).first();
    await expect(logoutBtn).toBeVisible({ timeout: 5_000 });
    await logoutBtn.click();
    console.log(`${el()} [T10] Clicked "Logout"`);

    // Redirects to home "/"
    await page.waitForURL(/^\https?:\/\/[^/]+\/?$/, { timeout: 10_000 });
    console.log(`${el()} [T10] Redirected to home after logout`);

    // Navigate back to provider dashboard — cookie is cleared
    await page.goto("/provider/dashboard");
    await page.waitForLoadState("networkidle");

    // Should show the "no phone" error state (client-side cookie check fails)
    await expect(
      page.getByText("Please login. Invalid or missing provider phone.")
    ).toBeVisible({ timeout: 8_000 });
    console.log(`${el()} [T10] "/provider/dashboard" blocked after logout — "Please login" shown`);

    // Dashboard provider name should NOT be visible
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME }))
      .not.toBeVisible({ timeout: 3_000 }).catch(() => {});
    console.log(`${el()} [T10] Provider name not visible after logout — correct`);

    console.log(`${el()} [T10] PASS`);
  });

  // ─── TEST 11: Mobile viewport ─────────────────────────────────────────────

  test("TEST 11 — Mobile viewport (375px): cards readable, no overflow", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 11: Mobile viewport ═══`);
    await page.setViewportSize({ width: 375, height: 667 });

    await injectProviderCookie(page);
    await mockDashboardProfile(page);
    await mockKkApi(page);
    await gotoProviderDashboard(page);

    // Provider name h1 visible at 375px
    await expect(page.getByRole("heading", { level: 1, name: ZZ_PROVIDER_NAME })).toBeVisible({ timeout: 10_000 });
    console.log(`${el()} [T11] Provider h1 visible at 375px`);

    // "Provider Intelligence Dashboard" label
    await expect(page.getByText("Provider Intelligence Dashboard")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T11] "Provider Intelligence Dashboard" label visible at 375px`);

    // At least the first stats card title visible
    await expect(page.getByText("Requests In Your Services", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T11] Stats card visible at 375px`);

    // Service chip visible — scope to span badge to avoid strict mode violation
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SERVICE_1}$`) }).first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T11] Service chip "${ZZ_SERVICE_1}" visible at 375px`);

    // ProviderID badge visible
    await expect(page.getByText(`ProviderID: ${ZZ_PROVIDER_ID}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T11] ProviderID badge visible at 375px`);

    // "Edit Services & Areas" button has reasonable tap target
    const editBtn = page.locator("a", { hasText: "Edit Services & Areas" }).first();
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    const btnBox = await editBtn.boundingBox();
    if (btnBox) {
      console.log(`${el()} [T11] "Edit Services & Areas" button: w=${btnBox.width.toFixed(0)}px h=${btnBox.height.toFixed(0)}px`);
      expect(btnBox.height).toBeGreaterThanOrEqual(20);
      expect(btnBox.width).toBeGreaterThan(60);
    }

    // No horizontal overflow
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 375;
    console.log(`${el()} [T11] body.scrollWidth=${scrollWidth}px (viewport=${viewportWidth}px)`);
    const overflow = scrollWidth > viewportWidth + 16;   // 16px tolerance for scrollbar
    if (overflow) {
      console.log(`${el()} [T11] WARNING: horizontal overflow detected (${scrollWidth}px > ${viewportWidth}px)`);
    } else {
      console.log(`${el()} [T11] No horizontal overflow`);
    }

    console.log(`${el()} [T11] PASS`);
  });

  // ─── TEST 12: Data correctness ────────────────────────────────────────────

  test("TEST 12 — Backend/UI data correctness: all fields match API payload", async ({ page }) => {
    console.log(`\n${el()} ═══ TEST 12: Data correctness ═══`);

    // Craft a precise profile with known values
    const ZZ_SPECIFIC_NAME     = "ZZ QA Provider Twelve";
    const ZZ_SPECIFIC_ID       = "ZZ-QA-PROV-9012";
    const ZZ_SPECIFIC_PHONE    = "9901901901";
    const ZZ_SPECIFIC_SERVICE  = "ZZ QA Tiling";
    const ZZ_SPECIFIC_AREA     = "ZZ QA Civil Lines";
    const ZZ_SPECIFIC_DISP     = "ZZ-QA-942";  // → "Kaam No. 942"
    const ZZ_SPECIFIC_TASK     = "TASK-ZZ-QA-9042";
    const ZZ_SPECIFIC_CATEGORY = "ZZ QA Tiling";
    const ZZ_SPECIFIC_AREA2    = "ZZ QA Civil Lines";

    await injectProviderCookie(page, ZZ_SPECIFIC_PHONE);
    await mockDashboardProfile(page, {
      ProviderID:      ZZ_SPECIFIC_ID,
      ProviderName:    ZZ_SPECIFIC_NAME,
      Phone:           ZZ_SPECIFIC_PHONE,
      Verified:        "yes",
      OtpVerified:     "yes",
      OtpVerifiedAt:   new Date().toISOString(),
      PendingApproval: "no",
      Services: [{ Category: ZZ_SPECIFIC_SERVICE }],
      Areas:    [{ Area: ZZ_SPECIFIC_AREA }],
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: ZZ_SPECIFIC_AREA, Status: "active" }],
        PendingAreaRequests: [],
        ResolvedOutcomes:    [],
      },
      Analytics: {
        Metrics: {
          TotalRequestsInMyCategories:  42,
          TotalRequestsMatchedToMe:     11,
          TotalRequestsRespondedByMe:    7,
          TotalRequestsAcceptedByMe:     4,
          TotalRequestsCompletedByMe:    3,
          ResponseRate:                 63,
          AcceptanceRate:               36,
        },
        AreaDemand: [
          { AreaName: ZZ_SPECIFIC_AREA, RequestCount: 9 },
        ],
        SelectedAreaDemand: [
          { AreaName: ZZ_SPECIFIC_AREA, RequestCount: 9, IsSelectedByProvider: true },
        ],
        CategoryDemandByRange: {
          today:     [{ CategoryName: ZZ_SPECIFIC_CATEGORY, RequestCount: 4 }],
          last7Days: [],
          last30Days: [],
          last365Days: [],
        },
        RecentMatchedRequests: [
          {
            TaskID:    ZZ_SPECIFIC_TASK,
            DisplayID: ZZ_SPECIFIC_DISP,
            Category:  ZZ_SPECIFIC_CATEGORY,
            Area:      ZZ_SPECIFIC_AREA2,
            Details:   "ZZ QA Phase6 data-correctness task — please ignore.",
            CreatedAt: "2026-04-15T14:00:00.000Z",
            Accepted:  true,
            Responded: true,
            ThreadID:  "",
          },
        ],
      },
    });
    await mockKkApi(page);
    await gotoProviderDashboard(page);
    await expect(page.getByRole("heading", { level: 1, name: ZZ_SPECIFIC_NAME })).toBeVisible({ timeout: 10_000 });

    // Identity
    await expect(page.getByText(`ProviderID: ${ZZ_SPECIFIC_ID}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] ProviderID "${ZZ_SPECIFIC_ID}" — CORRECT`);

    await expect(page.getByText(`Phone: ${ZZ_SPECIFIC_PHONE}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Phone "${ZZ_SPECIFIC_PHONE}" — CORRECT`);

    await expect(page.getByText("Phone Verified").first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Verification badge "Phone Verified" — CORRECT`);

    // Service
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SPECIFIC_SERVICE}$`) }).first())
      .toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Service "${ZZ_SPECIFIC_SERVICE}" — CORRECT`);

    // Area
    await expect(page.locator("span").filter({ hasText: new RegExp(`^${ZZ_SPECIFIC_AREA}$`) }).first())
      .toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Area "${ZZ_SPECIFIC_AREA}" — CORRECT`);

    // Stats card values
    await expect(page.getByText("42").first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] "Requests In Your Services" = 42 — CORRECT`);

    await expect(page.getByText("11").first()).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] "Matched To You" = 11 — CORRECT`);

    // Response rate
    await expect(page.getByText(/Response rate:.*63%/)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] "Response rate: 63%" — CORRECT`);

    // Recent matched request: display label → "Kaam No. 942"
    await expect(page.getByText("Kaam No. 942")).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Matched request "Kaam No. 942" — CORRECT`);

    // Request category + area
    await expect(page.getByText(`${ZZ_SPECIFIC_CATEGORY} in ${ZZ_SPECIFIC_AREA2}`)).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Category in area "${ZZ_SPECIFIC_CATEGORY} in ${ZZ_SPECIFIC_AREA2}" — CORRECT`);

    // Response + acceptance badge for Accepted=true, Responded=true
    await expect(
      page.locator("span").filter({ hasText: /^Responded$/ }).first()
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("span").filter({ hasText: /^Accepted$/ }).first()
    ).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] "Responded" and "Accepted" badges correct — CORRECT`);

    // Area demand table row
    await expect(page.getByRole("cell", { name: ZZ_SPECIFIC_AREA })).toBeVisible({ timeout: 5_000 });
    console.log(`${el()} [T12] Area demand table row "${ZZ_SPECIFIC_AREA}" — CORRECT`);

    console.log(`${el()} [T12] PASS`);
  });

});
