/**
 * Verification — Admin Dashboard Users tab.
 *
 * Why this file is mock-driven, not live-OTP:
 *   - The repo already uses the mock pattern in web/e2e/admin/dashboard.spec.ts
 *     (bootstrapAdminSession + mockAdminDashboardApis + mockJson on
 *     `/api/admin/...`). That pattern proves wiring without depending on
 *     Supabase, Google Sheets OTP, or WhatsApp delivery.
 *   - Live OTP is only used by `admin-dashboard-audit.spec.ts`, which runs
 *     against the production deployment with service-account credentials.
 *     That harness is intentionally not extended here — this verification
 *     should pass on a clean local checkout.
 *
 * What the stateful `/api/admin/users` mock simulates:
 *   PHASE 1 (initial)        — 2 users, several tasks each.
 *   PHASE 2 (new user login) — a third "fresh" user with 0 tasks appears,
 *                              totalUsers becomes 3.
 *   PHASE 3 (request created)— same fresh user now has totalRequests=1
 *                              with a latestRequestAt timestamp.
 *
 * Between phases the test reloads the dashboard so the UsersTab refetches
 * — this is exactly the contract the production component honours (it
 * lazy-loads on accordion open).
 */

import { bootstrapAdminSession } from "./_support/auth";
import { gotoPath } from "./_support/home";
import { mockAdminDashboardApis } from "./_support/scenarios";
import { mockJson } from "./_support/routes";
import { test, expect } from "./_support/test";

type UserRow = {
  phone: string;
  name: string | null;
  created_at: string | null;
  totalRequests: number;
  latestRequestAt: string | null;
};

type Snapshot = {
  totalUsers: number;
  users: UserRow[];
};

const FRESH_PHONE = "9988776655";
const FRESH_PHONE_PARTIAL = "998877";
const NO_MATCH_PHONE = "1234567890";

const BASELINE: Snapshot = {
  totalUsers: 2,
  users: [
    {
      phone: "9999999901",
      name: "Existing User A",
      created_at: "2026-04-22T09:00:00.000Z",
      totalRequests: 3,
      latestRequestAt: "2026-05-10T12:00:00.000Z",
    },
    {
      phone: "9999999903",
      name: null,
      created_at: "2026-04-20T09:00:00.000Z",
      totalRequests: 1,
      latestRequestAt: "2026-05-09T08:00:00.000Z",
    },
  ],
};

const AFTER_LOGIN: Snapshot = {
  totalUsers: 3,
  users: [
    ...BASELINE.users,
    // New row, no tasks yet — created_at sorts last (oldest) but the
    // sort prefers latestRequestAt desc, so a 0-task row ends up below
    // anything with tasks. That ordering doesn't matter to assertions
    // here; we look for the row by phone.
    {
      phone: FRESH_PHONE,
      name: null,
      created_at: "2026-05-13T10:00:00.000Z",
      totalRequests: 0,
      latestRequestAt: null,
    },
  ],
};

const AFTER_REQUEST: Snapshot = {
  totalUsers: 3,
  users: [
    ...BASELINE.users,
    {
      phone: FRESH_PHONE,
      name: null,
      created_at: "2026-05-13T10:00:00.000Z",
      totalRequests: 1,
      latestRequestAt: "2026-05-13T10:05:00.000Z",
    },
  ],
};

test.describe("Admin: Users tab auto-updates and search", () => {
  test("Users tab reflects new user, request count, and search across reloads", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await mockAdminDashboardApis(page);

    // AdminTopbar now mounts an AdminNotificationBell that fetches
    // /api/admin/notifications on every page mount. Mock it so the
    // request completes cleanly — otherwise navigations during the
    // test abort the in-flight fetch and diag.assertClean() flags it.
    await mockJson(page, "**/api/admin/notifications", {
      status: 200,
      body: {
        success: true,
        unreadCount: 0,
        notifications: [],
      } as Record<string, unknown>,
    });

    // Stateful /api/admin/users mock — flips the snapshot returned to
    // the next page-load. The UsersTab refetches on accordion open after
    // every reload, so this is enough to verify auto-update behaviour
    // without a real Supabase round-trip.
    let phase: "baseline" | "after-login" | "after-request" = "baseline";
    const snapshotFor = (current: typeof phase): Snapshot => {
      if (current === "after-login") return AFTER_LOGIN;
      if (current === "after-request") return AFTER_REQUEST;
      return BASELINE;
    };
    let usersCalls = 0;
    await mockJson(page, "**/api/admin/users**", () => {
      usersCalls += 1;
      const snap = snapshotFor(phase);
      // /api/admin/users returns { success: true, totalUsers, users } —
      // note this is *not* the `ok` envelope; UsersTab gates on
      // `json.success`, so build the body directly.
      return {
        status: 200,
        body: {
          success: true,
          totalUsers: snap.totalUsers,
          users: snap.users,
        } as Record<string, unknown>,
      };
    });

    // Convenience locators — `users-tab-body` is the id the production
    // component sets on the accordion content, so this selector survives
    // copy changes to the visible label.
    const usersToggle = page.locator(
      'button[aria-controls="users-tab-body"]'
    );
    const usersBody = page.locator("#users-tab-body");
    const summaryLine = usersBody.getByText(/^Registered Users:/);
    const tableRows = usersBody.locator("tbody tr");

    const openUsersAccordion = async (label: string): Promise<void> => {
      // The accordion may auto-render closed after each reload. Click
      // until aria-expanded flips to true.
      const expanded = await usersToggle.getAttribute("aria-expanded");
      if (expanded !== "true") {
        await usersToggle.click();
      }
      await expect(
        usersBody,
        `${label}: accordion body should be visible`
      ).toBeVisible();
      // Wait for the fetch to land — the loading placeholder disappears
      // once the response is parsed and state is updated.
      await expect(
        usersBody.getByText("Loading users…"),
        `${label}: loading placeholder should clear`
      ).toHaveCount(0, { timeout: 5_000 });
    };

    // ───────────────────────────────────────────────────────────────────
    // PHASE 1 — Baseline
    // ───────────────────────────────────────────────────────────────────
    console.log("[PHASE 1] Baseline — opening Users accordion");
    await gotoPath(page, "/admin/dashboard");
    await openUsersAccordion("Phase 1");

    await expect(summaryLine).toContainText(
      String(BASELINE.totalUsers)
    );
    await expect(tableRows).toHaveCount(BASELINE.users.length);
    for (const u of BASELINE.users) {
      await expect(
        usersBody.locator("tbody tr", { hasText: u.phone })
      ).toBeVisible();
    }
    const baselineCalls = usersCalls;
    console.log(
      `[PHASE 1] PASS — totalUsers=${BASELINE.totalUsers}, rows=${BASELINE.users.length}, fetches=${baselineCalls}`
    );

    // ───────────────────────────────────────────────────────────────────
    // PHASE 2 — New user "logs in" → reload → row + count update
    // ───────────────────────────────────────────────────────────────────
    console.log("[PHASE 2] Simulating new user login + page reload");
    phase = "after-login";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openUsersAccordion("Phase 2");

    // Either signal of an update is acceptable per the spec:
    //   - Registered Users count increased, OR
    //   - New phone appears in the table.
    // We assert both, which is the stronger guarantee.
    await expect(summaryLine).toContainText(
      String(AFTER_LOGIN.totalUsers)
    );
    const freshRow = usersBody.locator("tbody tr", {
      hasText: FRESH_PHONE,
    });
    await expect(freshRow).toBeVisible();
    // Brand-new user has 0 requests and no latest timestamp ("—" cell).
    await expect(freshRow).toContainText("0");
    await expect(freshRow).toContainText("—");
    expect(
      usersCalls,
      "Phase 2: a new /api/admin/users fetch should have fired after reload"
    ).toBeGreaterThan(baselineCalls);
    const afterLoginCalls = usersCalls;
    console.log(
      `[PHASE 2] PASS — totalUsers=${AFTER_LOGIN.totalUsers}, new phone ${FRESH_PHONE} visible with 0 requests, fetches=${afterLoginCalls}`
    );

    // ───────────────────────────────────────────────────────────────────
    // PHASE 3 — Same user creates a request → reload → counts update
    // ───────────────────────────────────────────────────────────────────
    console.log(
      "[PHASE 3] Simulating request creation by the new user + page reload"
    );
    phase = "after-request";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openUsersAccordion("Phase 3");

    const freshRowAfter = usersBody.locator("tbody tr", {
      hasText: FRESH_PHONE,
    });
    await expect(freshRowAfter).toBeVisible();
    // Requests Generated column — the cell is right-aligned tabular-nums;
    // we just confirm the row now carries a "1" cell.
    await expect(freshRowAfter).toContainText("1");
    // Latest Request — formatDate() renders the timestamp as a localised
    // date string. The year "2026" is stable across locales, so anchor
    // on that rather than a brittle exact match.
    await expect(freshRowAfter).toContainText("2026");
    expect(
      usersCalls,
      "Phase 3: another fetch should have fired after reload"
    ).toBeGreaterThan(afterLoginCalls);
    console.log(
      `[PHASE 3] PASS — ${FRESH_PHONE} totalRequests=1, latestRequest stamped, fetches=${usersCalls}`
    );

    // ───────────────────────────────────────────────────────────────────
    // PHASE 4 — Search verification
    // ───────────────────────────────────────────────────────────────────
    console.log("[PHASE 4] Verifying search behaviour");
    const searchInput = usersBody.getByPlaceholder("Search phone number...");
    await expect(searchInput).toBeVisible();

    // Empty state baseline — all 3 rows visible.
    await expect(tableRows).toHaveCount(AFTER_REQUEST.users.length);

    // 4a. Partial digit search → exactly 1 match.
    console.log(
      `[PHASE 4a] Partial digit search "${FRESH_PHONE_PARTIAL}"`
    );
    await searchInput.fill(FRESH_PHONE_PARTIAL);
    await expect(
      usersBody.getByText(
        new RegExp(`Showing 1 of ${AFTER_REQUEST.users.length} users`)
      )
    ).toBeVisible();
    await expect(tableRows).toHaveCount(1);
    await expect(tableRows.first()).toContainText(FRESH_PHONE);
    console.log("[PHASE 4a] PASS — partial search filtered to fresh user");

    // 4b. Full-phone search → still exactly 1 match.
    console.log(`[PHASE 4b] Full-phone search "${FRESH_PHONE}"`);
    await searchInput.fill(FRESH_PHONE);
    await expect(tableRows).toHaveCount(1);
    await expect(tableRows.first()).toContainText(FRESH_PHONE);
    console.log("[PHASE 4b] PASS — full phone search filtered to fresh user");

    // 4c. Non-matching number → empty-state banner.
    console.log(`[PHASE 4c] Non-matching search "${NO_MATCH_PHONE}"`);
    await searchInput.fill(NO_MATCH_PHONE);
    await expect(
      usersBody.getByText("No users found for this phone number.")
    ).toBeVisible();
    await expect(tableRows).toHaveCount(0);
    console.log("[PHASE 4c] PASS — no-match empty state shown");

    // 4d. Clear button restores the full list.
    console.log("[PHASE 4d] Clear button restores full list");
    const clearButton = usersBody.getByRole("button", {
      name: "Clear search",
    });
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    await expect(searchInput).toHaveValue("");
    await expect(tableRows).toHaveCount(AFTER_REQUEST.users.length);
    console.log("[PHASE 4d] PASS — clear restored all rows");

    // 4e. Non-digit input is normalised — typing "998-877" must still
    // match. Confirms the searchDigits normaliser strips dashes before
    // substring-matching. Note: typing the "+91" country-code prefix
    // produces a 12-digit string that is NOT a substring of any stored
    // 10-digit user phone, so that input correctly returns no matches.
    console.log('[PHASE 4e] Dash-formatted input "998-877" normalises');
    await searchInput.fill("998-877");
    await expect(tableRows).toHaveCount(1);
    await expect(tableRows.first()).toContainText(FRESH_PHONE);
    await searchInput.fill("");
    console.log("[PHASE 4e] PASS — dashes stripped before match");

    diag.assertClean();
  });
});
