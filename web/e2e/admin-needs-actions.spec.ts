/**
 * E2E VALIDATION: Admin Needs Actions
 *
 * Scope: /admin/needs — hide, unhide, close, rank (4 native /api/kk actions).
 *
 * Architecture notes (read from web/app/admin/needs/page.tsx):
 *  - All 4 actions POST to /api/kk. State updates are LOCAL after each action.
 *  - "Hidden" badge rendered when need.isHidden === true (separate from status).
 *  - normalizeNeedStatus("hidden") → "active" — isHidden field drives the badge.
 *  - "Close" button disabled when need.status !== "active" (canClose guard).
 *  - Rank committed on blur from input[title="Priority rank"].
 *  - Error shown in rose banner (div.text-rose-700).
 *  - Server middleware guards /admin/* — no admin cookies → redirect to /login.
 *
 * TC-01: No admin session → redirect to /login
 * TC-02: Page loads with mock needs
 * TC-03: admin_hide_need — Hide → Hidden badge + Unhide button
 * TC-04: admin_unhide_need — Unhide → Hidden badge gone + Hide button
 * TC-05: admin_close_need — Close → status "closed" + Close disabled
 * TC-06: admin_set_need_rank — rank blur → rank input updates
 * TC-07: admin_hide_need backend failure → error banner, state unchanged
 * TC-08: admin_close_need on hidden need → Close goes disabled after success
 * TC-09: get_needs public listing excludes hidden needs (API contract)
 * TC-10: admin_hide_need without session → real API returns 401
 *
 * Run: npx playwright test e2e/admin-needs-actions.spec.ts --reporter=line
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── QA fixtures ──────────────────────────────────────────────────────────────

const ZZ_NEED_ID_ACTIVE = "ND-ZZ-001";
const ZZ_NEED_TITLE_ACTIVE = "ZZ QA Active Need One";
const ZZ_NEED_ID_HIDDEN = "ND-ZZ-002";
const ZZ_NEED_TITLE_HIDDEN = "ZZ QA Hidden Need Two";
const ZZ_USER_LABEL = "ZZ QA User";
const ZZ_USER_PHONE = "9777700099";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

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
  await page.addInitScript(() => {
    localStorage.setItem(
      "kk_admin_session",
      JSON.stringify({ isAdmin: true, name: "QA Admin", role: "admin", permissions: [] })
    );
  });
}

// ─── In-memory mock state ─────────────────────────────────────────────────────

type MockNeed = {
  NeedID: string;
  Title: string;
  Category: string;
  Area: string;
  PosterLabel: string;
  UserPhone: string;
  CurrentStatus: string;
  CreatedAt: string;
  ExpiresAt: string;
  PriorityRank: number;
  IsHidden: boolean;
};

const mockState = {
  needs: [] as MockNeed[],

  reset() {
    this.needs = [
      {
        NeedID: ZZ_NEED_ID_ACTIVE,
        Title: ZZ_NEED_TITLE_ACTIVE,
        Category: "Other",
        Area: "Sardarpura",
        PosterLabel: ZZ_USER_LABEL,
        UserPhone: ZZ_USER_PHONE,
        CurrentStatus: "active",
        CreatedAt: "01/04/2026 10:00:00",
        ExpiresAt: "08/05/2026 10:00:00",
        PriorityRank: 0,
        IsHidden: false,
      },
      {
        NeedID: ZZ_NEED_ID_HIDDEN,
        Title: ZZ_NEED_TITLE_HIDDEN,
        Category: "Other",
        Area: "Sardarpura",
        PosterLabel: ZZ_USER_LABEL,
        UserPhone: ZZ_USER_PHONE,
        CurrentStatus: "hidden",
        CreatedAt: "01/04/2026 10:00:00",
        ExpiresAt: "08/05/2026 10:00:00",
        PriorityRank: 0,
        IsHidden: true,
      },
    ];
  },

  hideNeed(needId: string) {
    const need = this.needs.find((n) => n.NeedID === needId);
    if (need) { need.IsHidden = true; need.CurrentStatus = "hidden"; }
  },

  unhideNeed(needId: string) {
    const need = this.needs.find((n) => n.NeedID === needId);
    if (need) { need.IsHidden = false; need.CurrentStatus = "active"; }
  },

  closeNeed(needId: string) {
    const need = this.needs.find((n) => n.NeedID === needId);
    if (need) need.CurrentStatus = "closed";
  },

  setRank(needId: string, rank: number) {
    const need = this.needs.find((n) => n.NeedID === needId);
    if (need) need.PriorityRank = rank;
  },
};

// ─── Route helpers ────────────────────────────────────────────────────────────

let kkCallBodies: Array<Record<string, unknown>> = [];

function resetCaptures() {
  kkCallBodies = [];
}

async function setupNeedsRoutes(
  page: Page,
  opts: { kkActionOverrides?: Record<string, object> } = {}
) {
  const { kkActionOverrides = {} } = opts;

  await page.route("**/api/kk**", async (route: Route) => {
    let body: Record<string, unknown> = {};
    try {
      const parsed = route.request().postDataJSON();
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!body.action) {
      const qAction = new URL(route.request().url()).searchParams.get("action") ?? "";
      if (qAction) body = { action: qAction };
    }
    kkCallBodies.push(body);

    const action = String(body.action || "");

    if (kkActionOverrides[action]) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kkActionOverrides[action]),
      });
      return;
    }

    switch (action) {
      case "admin_get_needs":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, needs: mockState.needs }),
        });
        break;

      case "admin_hide_need": {
        const needId = String(body.NeedID || "");
        mockState.hideNeed(needId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, status: "success", NeedID: needId, message: "Need hidden" }),
        });
        break;
      }

      case "admin_unhide_need": {
        const needId = String(body.NeedID || "");
        mockState.unhideNeed(needId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, status: "success", NeedID: needId, message: "Need unhidden" }),
        });
        break;
      }

      case "admin_close_need": {
        const needId = String(body.NeedID || "");
        mockState.closeNeed(needId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, status: "success", NeedID: needId, message: "Need closed" }),
        });
        break;
      }

      case "admin_set_need_rank": {
        const needId = String(body.NeedID || "");
        const rank = Number(body.PriorityRank) || 0;
        mockState.setRank(needId, rank);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, status: "success", NeedID: needId, message: "Need rank updated" }),
        });
        break;
      }

      case "get_needs":
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            needs: mockState.needs.filter((n) => !n.IsHidden && n.CurrentStatus === "active"),
          }),
        });
        break;

      default:
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
    }
  });
}

async function gotoAndWaitNeeds(page: Page) {
  await page.goto("/admin/needs");
  await page.waitForLoadState("networkidle");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Admin Needs Actions — Native /api/kk Validation", () => {
  test.beforeEach(() => {
    resetCaptures();
    mockState.reset();
  });

  // ── TC-01: Auth guard ─────────────────────────────────────────────────────
  test("TC-01: No admin session → server middleware redirects to /login", async ({ page }) => {
    await page.goto("/admin/needs");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  // ── TC-02: Page loads ─────────────────────────────────────────────────────
  test("TC-02: Valid admin session → needs page renders with mock needs", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    await expect(page.getByText(ZZ_NEED_TITLE_ACTIVE).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ZZ_NEED_TITLE_HIDDEN).first()).toBeVisible({ timeout: 5_000 });
    // "Showing N needs" counter
    await expect(page.getByText("Showing")).toBeVisible();
    // API was called with admin_get_needs
    const call = kkCallBodies.find((b) => b.action === "admin_get_needs");
    expect(call).toBeDefined();
  });

  // ── TC-03: admin_hide_need ────────────────────────────────────────────────
  test("TC-03: Hide button → posts admin_hide_need → Hidden badge appears, Unhide button shown", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    const activeRow = page.locator("tr").filter({ hasText: ZZ_NEED_ID_ACTIVE });
    await expect(activeRow).toBeVisible({ timeout: 10_000 });

    // Active need: Hide button present, no Hidden badge
    const hideBtn = activeRow.getByRole("button", { name: "Hide", exact: true });
    await expect(hideBtn).toBeVisible();
    await expect(activeRow.getByText("Hidden", { exact: true })).not.toBeVisible();
    await hideBtn.click();

    // Local state update: Hidden badge appears, button flips to Unhide
    await expect(activeRow.getByText("Hidden", { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(activeRow.getByRole("button", { name: "Unhide", exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(activeRow.getByRole("button", { name: "Hide", exact: true })).not.toBeVisible();

    // API contract
    const call = kkCallBodies.find((b) => b.action === "admin_hide_need");
    expect(call).toBeDefined();
    expect(call?.NeedID).toBe(ZZ_NEED_ID_ACTIVE);
  });

  // ── TC-04: admin_unhide_need ──────────────────────────────────────────────
  test("TC-04: Unhide button → posts admin_unhide_need → Hidden badge gone, Hide button returns", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    // ND-ZZ-002 starts hidden in mock
    const hiddenRow = page.locator("tr").filter({ hasText: ZZ_NEED_ID_HIDDEN });
    await expect(hiddenRow).toBeVisible({ timeout: 10_000 });

    // Verify initial state: Unhide button + Hidden badge
    const unhideBtn = hiddenRow.getByRole("button", { name: "Unhide", exact: true });
    await expect(unhideBtn).toBeVisible();
    await expect(hiddenRow.getByText("Hidden", { exact: true })).toBeVisible();
    await unhideBtn.click();

    // Local state update: Hidden badge gone, Hide button back
    await expect(hiddenRow.getByText("Hidden", { exact: true })).not.toBeVisible({ timeout: 8_000 });
    await expect(hiddenRow.getByRole("button", { name: "Hide", exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(hiddenRow.getByRole("button", { name: "Unhide", exact: true })).not.toBeVisible();

    // API contract
    const call = kkCallBodies.find((b) => b.action === "admin_unhide_need");
    expect(call).toBeDefined();
    expect(call?.NeedID).toBe(ZZ_NEED_ID_HIDDEN);
  });

  // ── TC-05: admin_close_need ───────────────────────────────────────────────
  test("TC-05: Close button → posts admin_close_need → status badge shows closed, Close button disabled", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    const activeRow = page.locator("tr").filter({ hasText: ZZ_NEED_ID_ACTIVE });
    await expect(activeRow).toBeVisible({ timeout: 10_000 });

    const closeBtn = activeRow.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeEnabled();
    await closeBtn.click();

    // Local state: status → "closed", Close button disabled (canClose = false)
    await expect(activeRow.getByText("closed")).toBeVisible({ timeout: 8_000 });
    await expect(closeBtn).toBeDisabled({ timeout: 5_000 });

    // API contract
    const call = kkCallBodies.find((b) => b.action === "admin_close_need");
    expect(call).toBeDefined();
    expect(call?.NeedID).toBe(ZZ_NEED_ID_ACTIVE);
  });

  // ── TC-06: admin_set_need_rank ────────────────────────────────────────────
  test("TC-06: Rank input blur → posts admin_set_need_rank → rank input reflects new value", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    const activeRow = page.locator("tr").filter({ hasText: ZZ_NEED_ID_ACTIVE });
    await expect(activeRow).toBeVisible({ timeout: 10_000 });

    const rankInput = activeRow.locator("input[title='Priority rank']");
    await expect(rankInput).toBeVisible();
    await expect(rankInput).toHaveValue("0");

    // Change value and blur to trigger handleRankCommit
    await rankInput.click();
    await rankInput.fill("7");
    await rankInput.press("Tab");

    // Local state: rankInputs updated to "7"
    await expect(rankInput).toHaveValue("7", { timeout: 8_000 });

    // API contract
    const call = kkCallBodies.find((b) => b.action === "admin_set_need_rank");
    expect(call).toBeDefined();
    expect(call?.NeedID).toBe(ZZ_NEED_ID_ACTIVE);
    expect(call?.PriorityRank).toBe(7);
  });

  // ── TC-07: admin_hide_need backend failure ────────────────────────────────
  test("TC-07: admin_hide_need {ok:false} → error banner shown, button stays Hide, no Hidden badge", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page, {
      kkActionOverrides: {
        admin_hide_need: { ok: false, error: "ZZ QA simulated hide error" },
      },
    });
    await gotoAndWaitNeeds(page);

    const activeRow = page.locator("tr").filter({ hasText: ZZ_NEED_ID_ACTIVE });
    await expect(activeRow.getByRole("button", { name: "Hide", exact: true })).toBeVisible({ timeout: 10_000 });
    await activeRow.getByRole("button", { name: "Hide", exact: true }).click();

    // Error banner in rose div
    await expect(page.getByText("ZZ QA simulated hide error")).toBeVisible({ timeout: 8_000 });

    // State unchanged: Hide button still present, no Hidden badge
    await expect(activeRow.getByRole("button", { name: "Hide", exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(activeRow.getByText("Hidden", { exact: true })).not.toBeVisible();
  });

  // ── TC-08: admin_close_need on hidden need ────────────────────────────────
  test("TC-08: Hidden need (status maps to active) → Close enabled → after close, Close disabled", async ({ page }) => {
    // normalizeNeedStatus("hidden") → "active" → canClose = true initially
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    const hiddenRow = page.locator("tr").filter({ hasText: ZZ_NEED_ID_HIDDEN });
    await expect(hiddenRow).toBeVisible({ timeout: 10_000 });

    const closeBtn = hiddenRow.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeEnabled();
    await closeBtn.click();

    // After close: Close disabled (status → "closed" → canClose = false)
    await expect(closeBtn).toBeDisabled({ timeout: 8_000 });

    const call = kkCallBodies.find((b) => b.action === "admin_close_need");
    expect(call?.NeedID).toBe(ZZ_NEED_ID_HIDDEN);
  });

  // ── TC-09: Public get_needs excludes hidden needs ─────────────────────────
  test("TC-09: get_needs public contract excludes hidden need, includes active need", async ({ page }) => {
    await injectAdminCookies(page);
    await setupNeedsRoutes(page);
    await gotoAndWaitNeeds(page);

    // Invoke get_needs from within the page context (mock route intercepts it)
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_needs" }),
      });
      return response.json() as Promise<{ ok: boolean; needs: Array<{ NeedID: string }> }>;
    });

    expect(result.ok).toBe(true);
    const ids = result.needs.map((n) => n.NeedID);
    expect(ids).toContain(ZZ_NEED_ID_ACTIVE);     // active, not hidden → included
    expect(ids).not.toContain(ZZ_NEED_ID_HIDDEN);  // hidden → excluded
  });

  // ── TC-10: Real API auth gate ─────────────────────────────────────────────
  test("TC-10: admin_hide_need without admin session → real API returns 401 Unauthorized", async ({ page }) => {
    // No admin cookies — calls the real production API without mocks
    // This validates the actual auth gate in /api/kk, not the UI layer
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin_hide_need", NeedID: "ND-ZZ-001" }),
      });
      return { status: response.status, body: await response.json() as { ok: boolean; error: string } };
    });

    expect(result.status).toBe(401);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toBe("Unauthorized");
  });
});
