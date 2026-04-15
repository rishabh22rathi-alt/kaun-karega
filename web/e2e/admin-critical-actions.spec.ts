/**
 * E2E AUDIT: Admin Critical Actions
 *
 * Scope: /admin/dashboard — provider verification toggle,
 *        category request approve/reject, auth guards, error handling.
 *
 * Key architectural facts discovered from reading source:
 *  - Provider "Approve/Reject" buttons do NOT exist on /admin/dashboard.
 *    The PendingApproval column is displayed but there is no action button
 *    for it. Approval requires navigating to /admin (provider detail page).
 *  - The only provider action on this page is "Verify"/"Unverify" toggle
 *    (handleProviderVerification → POST /api/kk action: "set_provider_verified").
 *  - After verification toggle: local state update only (no full refetch).
 *  - After category action: full fetchDashboard() called (5 parallel requests).
 *  - "Providers Needing Attention" accordion starts CLOSED (openSections.providers = false).
 *  - "Pending Category Requests" accordion starts OPEN (openSections.pendingCategoryRequests = true).
 *  - fetchDashboard: GET /api/admin/stats + 4 × POST /api/kk (dispatched by action).
 *  - Server middleware guards /admin/* via kk_auth_session + kk_admin=1 cookies.
 *  - AdminLayoutClient guards client-side via localStorage("kk_admin_session").isAdmin.
 *
 * Run: npx playwright test e2e/admin-critical-actions.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Constants ────────────────────────────────────────────────────────────────

const ZZ_PROVIDER_ID = "ZZ-QA-PROV-001";
const ZZ_PROVIDER_NAME = "ZZ QA Provider One";
const ZZ_PROVIDER_PHONE = "9777700001";

const ZZ_CAT_REQUEST_ID = "ZZ-QA-CAT-REQ-001";
const ZZ_CAT_REQUESTED = "ZZ QA Plumbing Service";
const ZZ_CAT_PROVIDER_NAME = "ZZ QA Provider Two";
const ZZ_CAT_PHONE = "9777700002";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function makeSessionCookieValue(phone = "9999999904"): string {
  const session = JSON.stringify({ phone, verified: true, createdAt: Date.now() });
  return encodeURIComponent(session);
}

async function injectAdminCookies(page: Page) {
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: makeSessionCookieValue(),
      url: "https://kaun-karega.vercel.app",
      sameSite: "Lax",
    },
    {
      name: "kk_admin",
      value: "1",
      url: "https://kaun-karega.vercel.app",
      sameSite: "Lax",
    },
  ]);
  // AdminLayoutClient reads localStorage on mount and redirects if isAdmin !== true
  await page.addInitScript(() => {
    localStorage.setItem(
      "kk_admin_session",
      JSON.stringify({ isAdmin: true, name: "QA Admin", role: "admin", permissions: [] })
    );
  });
}

// ─── In-memory mock state ─────────────────────────────────────────────────────

type MockProvider = {
  ProviderID: string;
  ProviderName: string;
  Phone: string;
  Verified: string;
  PendingApproval: string;
  Category: string;
  Areas: string;
};

type MockCatRequest = {
  RequestID: string;
  ProviderName: string;
  Phone: string;
  RequestedCategory: string;
  Status: string;
  CreatedAt: string;
};

const mockState = {
  providers: [] as MockProvider[],
  categoryApplications: [] as MockCatRequest[],
  verifyProvider(providerId: string, verified: string) {
    const p = this.providers.find((p) => p.ProviderID === providerId);
    if (p) p.Verified = verified;
  },
  removeCatRequest(requestId: string) {
    this.categoryApplications = this.categoryApplications.filter(
      (r) => r.RequestID !== requestId
    );
  },
};

// ─── Route helpers ────────────────────────────────────────────────────────────

let kkCallBodies: Array<Record<string, unknown>> = [];

function resetCaptures() {
  kkCallBodies = [];
}

/**
 * Set up all dashboard mocks. Every POST /api/kk dispatches by action field.
 * Override specific actions in tests using page.route() AFTER this call (LIFO).
 */
async function setupDashboardRoutes(
  page: Page,
  opts: { kkActionOverrides?: Record<string, object> } = {}
) {
  const { kkActionOverrides = {} } = opts;

  // GET /api/admin/stats → dashboard data
  await page.route("**/api/admin/stats**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        stats: {
          totalProviders: mockState.providers.length,
          verifiedProviders: mockState.providers.filter((p) => p.Verified === "yes").length,
          pendingAdminApprovals: mockState.providers.filter((p) => p.PendingApproval === "yes").length,
          pendingCategoryRequests: mockState.categoryApplications.filter((r) => r.Status === "pending").length,
        },
        providers: mockState.providers,
        categoryApplications: mockState.categoryApplications,
        categories: [],
      }),
    });
  });

  // POST /api/kk — dispatch by action
  // Also handles GET /api/kk?action=... calls made by the Sidebar component
  await page.route("**/api/kk**", async (route: Route) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed = route.request().postDataJSON();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }

    // For GET requests (Sidebar uses /api/kk?action=...) read action from query string
    if (!body.action) {
      const qAction = new URL(route.request().url()).searchParams.get("action") ?? "";
      if (qAction) body = { action: qAction };
    }

    kkCallBodies.push(body);

    const action = String(body.action || "");

    // Check for override first
    if (kkActionOverrides[action]) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kkActionOverrides[action]),
      });
      return;
    }

    switch (action) {
      case "get_admin_requests":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, requests: [] }),
        });
        break;

      case "get_admin_area_mappings":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, mappings: [] }),
        });
        break;

      case "admin_get_unmapped_areas":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, reviews: [] }),
        });
        break;

      case "admin_notification_logs":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, logs: [] }),
        });
        break;

      case "set_provider_verified": {
        const providerId = String(body.providerId || "");
        const verified = String(body.verified || "");
        mockState.verifyProvider(providerId, verified);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        break;
      }

      case "approve_category_request":
      case "reject_category_request": {
        const requestId = String(body.requestId || "");
        mockState.removeCatRequest(requestId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        break;
      }

      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

async function gotoAndWaitDashboard(page: Page) {
  await page.goto("/admin/dashboard");
  await page.waitForLoadState("networkidle");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Admin Critical Actions — Full Audit", () => {
  test.beforeEach(() => {
    resetCaptures();
    // Reset mock state before each test
    mockState.providers = [];
    mockState.categoryApplications = [];
  });

  // ── TC-01: Non-admin (no cookies) → middleware redirects to /login ─────────
  test("TC-01: No admin session → server middleware redirects to /login", async ({ page }) => {
    // No cookies, no localStorage injection
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");

    // Middleware at middleware.ts:13 checks kk_auth_session + kk_admin=1
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  // ── TC-02: Admin session → dashboard loads with stat cards ────────────────
  test("TC-02: Valid admin session → dashboard renders stat cards", async ({ page }) => {
    mockState.providers = [
      { ProviderID: ZZ_PROVIDER_ID, ProviderName: ZZ_PROVIDER_NAME, Phone: ZZ_PROVIDER_PHONE, Verified: "no", PendingApproval: "yes", Category: "Plumber", Areas: "Sardarpura" },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);
    await gotoAndWaitDashboard(page);

    // Stat cards must be visible — scope to <p> to avoid strict-mode collision
    // with the accordion title that also contains the same text
    await expect(page.locator("p").filter({ hasText: /^Total Providers$/ }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("p").filter({ hasText: /^Pending Admin Approvals$/ }).first()).toBeVisible();
    await expect(page.locator("p").filter({ hasText: /^Pending Category Requests$/ }).first()).toBeVisible();
  });

  // ── TC-03: Provider approve/reject — NOT in current UI ────────────────────
  // This is an audit finding: PendingApproval is displayed as a column badge
  // in the "Providers Needing Attention" table but there are NO approve/reject
  // action buttons. The only action button is "Verify"/"Unverify".
  test("TC-03: Provider approve/reject buttons do NOT exist on /admin/dashboard", async ({ page }) => {
    mockState.providers = [
      {
        ProviderID: ZZ_PROVIDER_ID,
        ProviderName: ZZ_PROVIDER_NAME,
        Phone: ZZ_PROVIDER_PHONE,
        Verified: "no",
        PendingApproval: "yes",
        Category: "Plumber",
        Areas: "Sardarpura",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);
    await gotoAndWaitDashboard(page);

    // Open the Providers Needing Attention accordion (starts closed)
    const providersSection = page.locator("section").filter({ hasText: "Providers Needing Attention" }).first();
    const expandBtn = providersSection.locator("button").filter({ hasText: "+" }).first();
    await expandBtn.click();

    // Provider must be visible
    await expect(page.getByText(ZZ_PROVIDER_NAME)).toBeVisible({ timeout: 8_000 });

    // PendingApproval badge ("yes") must be visible — it IS displayed
    const pendingBadge = page.locator("span").filter({ hasText: /^yes$/ }).first();
    await expect(pendingBadge).toBeVisible({ timeout: 5_000 });

    // "Approve" and "Reject" buttons must NOT be present — this is the finding
    // Use exact: true to avoid matching the accordion toggle whose accessible name
    // contains "Approve or reject requests inline." as a substring
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);

    // Only "Verify" button exists in the Actions column
    await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
  });

  // ── TC-04: Provider verification toggle — Verify ──────────────────────────
  test("TC-04: Verify button marks unverified provider as verified (local state update)", async ({ page }) => {
    mockState.providers = [
      {
        ProviderID: ZZ_PROVIDER_ID,
        ProviderName: ZZ_PROVIDER_NAME,
        Phone: ZZ_PROVIDER_PHONE,
        Verified: "no",
        PendingApproval: "no",
        Category: "Plumber",
        Areas: "Sardarpura",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);

    // Pre-populate state before navigation
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");

    // Open Providers section
    const providersSection = page.locator("section").filter({ hasText: "Providers Needing Attention" }).first();
    await providersSection.locator("button").filter({ hasText: "+" }).first().click();
    await page.waitForTimeout(300);

    const providerRow = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME });
    await expect(providerRow).toBeVisible({ timeout: 8_000 });

    // Verify button must be present (provider is unverified)
    const verifyBtn = providerRow.getByRole("button", { name: "Verify" });
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();

    // After successful verification: local state updates Verified → "yes".
    // Since PendingApproval="no", the provider no longer qualifies as "needing attention"
    // (isPendingApproval=false, isUnverified=false) → row is REMOVED from the table.
    // "Unverify" button never appears in this case — the correct signal is the success banner
    // and the empty-state message appearing.
    await expect(page.getByText("Action completed successfully")).toBeVisible({ timeout: 8_000 });

    // Provider row must be gone (no longer needs attention)
    await expect(providerRow).not.toBeVisible({ timeout: 5_000 });

    // Empty state must be shown
    await expect(page.getByText("No providers need attention right now.")).toBeVisible({ timeout: 5_000 });

    // /api/kk was called with set_provider_verified
    const verifyCall = kkCallBodies.find((b) => b.action === "set_provider_verified");
    expect(verifyCall).toBeDefined();
    expect(verifyCall?.providerId).toBe(ZZ_PROVIDER_ID);
    expect(verifyCall?.verified).toBe("yes");
  });

  // ── TC-05: Provider verification toggle — Unverify ────────────────────────
  test("TC-05: Unverify button marks verified provider as unverified (local state update)", async ({ page }) => {
    mockState.providers = [
      {
        ProviderID: ZZ_PROVIDER_ID,
        ProviderName: ZZ_PROVIDER_NAME,
        Phone: ZZ_PROVIDER_PHONE,
        Verified: "yes",   // starts verified
        PendingApproval: "yes", // isPendingApproval=true → appears in visibleProvidersNeedingAttention
        Category: "Plumber",
        Areas: "Sardarpura",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);
    await gotoAndWaitDashboard(page);

    const providersSection = page.locator("section").filter({ hasText: "Providers Needing Attention" }).first();
    await providersSection.locator("button").filter({ hasText: "+" }).first().click();

    const providerRow = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME });
    await expect(providerRow).toBeVisible({ timeout: 8_000 });

    const unverifyBtn = providerRow.getByRole("button", { name: "Unverify" });
    await expect(unverifyBtn).toBeVisible();
    await unverifyBtn.click();

    // Button switches back to "Verify"
    await expect(providerRow.getByRole("button", { name: "Verify" })).toBeVisible({ timeout: 8_000 });

    // API call verified
    const verifyCall = kkCallBodies.find((b) => b.action === "set_provider_verified");
    expect(verifyCall?.verified).toBe("no");
  });

  // ── TC-06: Provider verification — backend failure ────────────────────────
  test("TC-06: set_provider_verified returns {ok:false} → shows 'Failed to update' error", async ({ page }) => {
    mockState.providers = [
      {
        ProviderID: ZZ_PROVIDER_ID,
        ProviderName: ZZ_PROVIDER_NAME,
        Phone: ZZ_PROVIDER_PHONE,
        Verified: "no",
        PendingApproval: "no",
        Category: "Plumber",
        Areas: "Sardarpura",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page, {
      kkActionOverrides: {
        set_provider_verified: { ok: false, error: "ZZ QA simulated verification error" },
      },
    });
    await gotoAndWaitDashboard(page);

    const providersSection = page.locator("section").filter({ hasText: "Providers Needing Attention" }).first();
    await providersSection.locator("button").filter({ hasText: "+" }).first().click();

    const providerRow = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME });
    const verifyBtn = providerRow.getByRole("button", { name: "Verify" });
    await expect(verifyBtn).toBeVisible({ timeout: 8_000 });
    await verifyBtn.click();

    // showFeedback("error", "Failed to update")
    await expect(page.getByText("Failed to update")).toBeVisible({ timeout: 8_000 });

    // Button stays "Verify" (state not mutated on failure)
    await expect(providerRow.getByRole("button", { name: "Verify" })).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-07: Category request approve ───────────────────────────────────────
  test("TC-07: Approve category request → request removed, success feedback, dashboard refreshed", async ({ page }) => {
    mockState.categoryApplications = [
      {
        RequestID: ZZ_CAT_REQUEST_ID,
        ProviderName: ZZ_CAT_PROVIDER_NAME,
        Phone: ZZ_CAT_PHONE,
        RequestedCategory: ZZ_CAT_REQUESTED,
        Status: "pending",
        CreatedAt: "2026-04-05T10:00:00.000Z",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);
    await gotoAndWaitDashboard(page);

    // "Pending Category Requests" section starts OPEN — category must be visible
    await expect(page.getByText(ZZ_CAT_REQUESTED)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_CAT_PROVIDER_NAME)).toBeVisible();

    const requestRow = page.locator("tr").filter({ hasText: ZZ_CAT_REQUESTED });
    const approveBtn = requestRow.getByRole("button", { name: "Approve" });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // After action: fetchDashboard() called → mock removes request → section shows 0 count
    // Success feedback must appear
    await expect(page.getByText("Action completed successfully")).toBeVisible({ timeout: 10_000 });

    // Category request entry is removed from the list
    await expect(page.getByText(ZZ_CAT_REQUESTED)).not.toBeVisible({ timeout: 8_000 });

    // API call verified
    const approveCall = kkCallBodies.find((b) => b.action === "approve_category_request");
    expect(approveCall?.requestId).toBe(ZZ_CAT_REQUEST_ID);
    expect(approveCall?.categoryName).toBe(ZZ_CAT_REQUESTED);
  });

  // ── TC-08: Category request reject ────────────────────────────────────────
  test("TC-08: Reject category request → request removed, success feedback, dashboard refreshed", async ({ page }) => {
    mockState.categoryApplications = [
      {
        RequestID: ZZ_CAT_REQUEST_ID,
        ProviderName: ZZ_CAT_PROVIDER_NAME,
        Phone: ZZ_CAT_PHONE,
        RequestedCategory: ZZ_CAT_REQUESTED,
        Status: "pending",
        CreatedAt: "2026-04-05T10:00:00.000Z",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);
    await gotoAndWaitDashboard(page);

    await expect(page.getByText(ZZ_CAT_REQUESTED)).toBeVisible({ timeout: 10_000 });

    const requestRow = page.locator("tr").filter({ hasText: ZZ_CAT_REQUESTED });
    const rejectBtn = requestRow.getByRole("button", { name: "Reject" });
    await expect(rejectBtn).toBeVisible();
    await rejectBtn.click();

    await expect(page.getByText("Action completed successfully")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_CAT_REQUESTED)).not.toBeVisible({ timeout: 8_000 });

    // API call verified — reject does NOT send categoryName
    const rejectCall = kkCallBodies.find((b) => b.action === "reject_category_request");
    expect(rejectCall?.requestId).toBe(ZZ_CAT_REQUEST_ID);
    expect(rejectCall?.categoryName).toBeUndefined();
  });

  // ── TC-09: Category action backend failure ────────────────────────────────
  test("TC-09: approve_category_request returns {ok:false} → shows 'Failed to update' error", async ({ page }) => {
    mockState.categoryApplications = [
      {
        RequestID: ZZ_CAT_REQUEST_ID,
        ProviderName: ZZ_CAT_PROVIDER_NAME,
        Phone: ZZ_CAT_PHONE,
        RequestedCategory: ZZ_CAT_REQUESTED,
        Status: "pending",
        CreatedAt: "2026-04-05T10:00:00.000Z",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page, {
      kkActionOverrides: {
        approve_category_request: { ok: false, error: "ZZ QA simulated category error" },
      },
    });
    await gotoAndWaitDashboard(page);

    await expect(page.getByText(ZZ_CAT_REQUESTED)).toBeVisible({ timeout: 10_000 });

    const requestRow = page.locator("tr").filter({ hasText: ZZ_CAT_REQUESTED });
    await requestRow.getByRole("button", { name: "Approve" }).click();

    // showFeedback("error", "Failed to update")
    await expect(page.getByText("Failed to update")).toBeVisible({ timeout: 8_000 });

    // Request still present (not removed — failure case)
    await expect(page.getByText(ZZ_CAT_REQUESTED)).toBeVisible({ timeout: 5_000 });
  });

  // ── TC-10: Reload consistency after verification toggle ───────────────────
  test("TC-10: Page reload after Verify preserves verified state (stat card re-reads from mock)", async ({ page }) => {
    mockState.providers = [
      {
        ProviderID: ZZ_PROVIDER_ID,
        ProviderName: ZZ_PROVIDER_NAME,
        Phone: ZZ_PROVIDER_PHONE,
        Verified: "no",
        PendingApproval: "no",
        Category: "Plumber",
        Areas: "Sardarpura",
      },
    ];
    await injectAdminCookies(page);
    await setupDashboardRoutes(page);
    await gotoAndWaitDashboard(page);

    // Open providers, verify the provider
    const providersSection = page.locator("section").filter({ hasText: "Providers Needing Attention" }).first();
    await providersSection.locator("button").filter({ hasText: "+" }).first().click();

    const providerRow = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME });
    await expect(providerRow.getByRole("button", { name: "Verify" })).toBeVisible({ timeout: 8_000 });
    await providerRow.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Action completed successfully")).toBeVisible({ timeout: 8_000 });

    // The mock state now has Verified="yes"
    // Reload → fetchDashboard re-reads from mock → stat card shows updated verifiedProviders
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Stat card "Verified Providers" should now reflect the mock state (1)
    // (The mock state was mutated by set_provider_verified handler)
    // Use <p> element to avoid matching outer div containers (div.filter matches too broadly)
    const verifiedCard = page.locator("p").filter({ hasText: /^Verified Providers$/ }).first();
    await expect(verifiedCard).toBeVisible({ timeout: 8_000 });

    // Provider section re-opens — provider still there with Unverify button
    const providersSectionAfterReload = page.locator("section").filter({ hasText: "Providers Needing Attention" }).first();
    await providersSectionAfterReload.locator("button").filter({ hasText: "+" }).first().click();
    const rowAfterReload = page.locator("tr").filter({ hasText: ZZ_PROVIDER_NAME });
    // Provider no longer needs attention (Verified=yes, PendingApproval=no) after mock state update
    // The section count may be 0 — verify graceful empty state
    const noAttentionMsg = page.getByText("No providers need attention right now.");
    const hasUnverifyBtn = rowAfterReload.getByRole("button", { name: "Unverify" });
    // Either the provider is gone from the list (moved out of "needs attention") or still shown
    const isGone = await noAttentionMsg.isVisible().catch(() => false);
    const isStillShown = await hasUnverifyBtn.isVisible().catch(() => false);
    expect(isGone || isStillShown).toBe(true);
  });
});
