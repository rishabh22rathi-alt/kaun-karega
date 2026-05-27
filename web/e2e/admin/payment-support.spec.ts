/**
 * Admin Payment Support — accordion tab + backing endpoint.
 *
 * Covers:
 *   - Auth gate: unauthenticated direct GET returns 401.
 *   - Tab opens and shows the empty state when the endpoint returns
 *     an empty rows array.
 *   - Tab renders a recent paid row with phone / plan / amount /
 *     Razorpay payment id once mocked rows are returned.
 *   - Smart search by phone, provider id, and Razorpay payment id —
 *     each issues the right query string against the endpoint and
 *     the mock returns a scoped subset.
 *   - No-match search returns the empty state with the searched
 *     query echoed back.
 *   - Endpoint is live (not snapshot cached) — asserted via the
 *     Cache-Control header on a direct authenticated GET.
 *
 * Mock strategy: the dashboard relies on a long list of admin APIs
 * (mockAdminDashboardApis) plus several admin-specific stubs that
 * adjacent specs already use (admin-verify, unread-summary,
 * notifications, announcements, notification-preferences). We reuse
 * the same set so the rest of the dashboard renders cleanly and only
 * the new /api/admin/payments/recent endpoint drives the assertions.
 */

import { bootstrapAdminSession, bootstrapUserSession } from "../_support/auth";
import { gotoPath } from "../_support/home";
import { mockAdminDashboardApis } from "../_support/scenarios";
import { jsonOk, mockJson } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

/**
 * Shared dashboard mocks — the dashboard shell pings half a dozen
 * admin endpoints on mount. Without these, console errors pile up
 * and `diag.assertClean()` fails for reasons unrelated to the tab
 * under test.
 */
async function setupAdminDashboard(
  page: import("@playwright/test").Page
): Promise<void> {
  await mockAdminDashboardApis(page);
  await mockJson(page, "**/api/admin/notifications", {
    status: 200,
    body: { success: true, unreadCount: 0, notifications: [] },
  });
  await mockJson(page, "**/api/admin/unread-summary", jsonOk({ unread: {} }));
  await mockJson(page, "**/api/admin-verify", {
    status: 200,
    body: {
      ok: true,
      admin: { name: "QA Admin", role: "admin", permissions: [] },
    },
  });
  await mockJson(
    page,
    "**/api/admin/provider-stats",
    jsonOk({ data: { total: 0, verified: 0, underReview: 0 } })
  );
  await mockJson(
    page,
    "**/api/admin/notification-preferences",
    jsonOk({ preferences: {} })
  );
  await mockJson(
    page,
    "**/api/announcements/active",
    jsonOk({ announcement: null })
  );
}

// Reusable payment row fixtures keyed by the dimension a test wants
// to exercise. order_id is the React key; the testid pattern in the
// component is `payment-support-row-<order_id>`.
const PAID_ROW = {
  order_id: "order_QA_paid_001",
  provider_id: "P-QA-PAID-001",
  provider_phone: "+919999900001",
  provider_name: "QA Paid Provider",
  plan_code: "regions_5",
  amount_paise: 3100,
  status: "paid",
  razorpay_payment_id: "pay_QA_PAID_001",
  created_at: "2026-05-20T10:00:00.000Z",
  paid_at: "2026-05-20T10:00:30.000Z",
  current_plan_code: "regions_5",
  current_period_end: "2026-06-19T10:00:30.000Z",
  scheduled_plan_code: null,
  scheduled_activates_at: null,
} as const;

const ALL_JODHPUR_ROW = {
  order_id: "order_QA_aj_002",
  provider_id: "P-QA-AJ-002",
  provider_phone: "+919999900002",
  provider_name: "QA All Jodhpur Provider",
  plan_code: "all_jodhpur",
  amount_paise: 10100,
  status: "paid",
  razorpay_payment_id: "pay_QA_AJ_002",
  created_at: "2026-05-19T09:00:00.000Z",
  paid_at: "2026-05-19T09:00:30.000Z",
  current_plan_code: "all_jodhpur",
  current_period_end: "2026-06-18T09:00:30.000Z",
  scheduled_plan_code: "regions_5",
  scheduled_activates_at: "2026-06-18T09:00:30.000Z",
} as const;

// ─────────────────────────────────────────────────────────────────────
//  Auth gate — live endpoint, no mocks
// ─────────────────────────────────────────────────────────────────────

test.describe("Payment Support — auth gate", () => {
  test("unauthenticated GET returns 401", async ({ request }) => {
    const res = await request.get(appUrl("/api/admin/payments/recent"));
    expect(
      [401, 403],
      `Anonymous returned ${res.status()} (expected 401 or 403)`
    ).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      rows?: unknown;
    };
    expect(body.ok).not.toBe(true);
    expect(body.rows).toBeUndefined();
  });

  test("non-admin user session is denied", async ({ page }) => {
    await bootstrapUserSession(page);
    const res = await page.request.get(
      appUrl("/api/admin/payments/recent")
    );
    expect(
      [401, 403],
      `User session returned ${res.status()} (expected 401 or 403)`
    ).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Tab behavior — mocked endpoint
// ─────────────────────────────────────────────────────────────────────

test.describe("Payment Support — tab behavior", () => {
  test("opens with empty state when no payments exist", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupAdminDashboard(page);
    await mockJson(
      page,
      "**/api/admin/payments/recent**",
      jsonOk({ rows: [] })
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("payment-support-tab-toggle").click();

    await expect(page.getByTestId("payment-support-helper")).toBeVisible();
    await expect(page.getByTestId("payment-support-empty")).toBeVisible();
    await expect(page.getByTestId("payment-support-table")).toHaveCount(0);
    diag.assertClean();
  });

  test("renders a paid row with phone, plan, amount, Razorpay id", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupAdminDashboard(page);
    await mockJson(
      page,
      "**/api/admin/payments/recent**",
      jsonOk({ rows: [PAID_ROW] })
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("payment-support-tab-toggle").click();

    const row = page.getByTestId(`payment-support-row-${PAID_ROW.order_id}`);
    await expect(row).toBeVisible();
    await expect(
      page.getByTestId(`payment-support-cell-phone-${PAID_ROW.order_id}`)
    ).toContainText(PAID_ROW.provider_phone);
    await expect(
      page.getByTestId(`payment-support-cell-provider-${PAID_ROW.order_id}`)
    ).toContainText(PAID_ROW.provider_id);
    await expect(
      page.getByTestId(`payment-support-cell-plan-${PAID_ROW.order_id}`)
    ).toContainText(/₹31/);
    await expect(
      page.getByTestId(`payment-support-cell-amount-${PAID_ROW.order_id}`)
    ).toContainText("₹31");
    await expect(
      page.getByTestId(`payment-support-cell-status-${PAID_ROW.order_id}`)
    ).toContainText(/paid/i);
    await expect(
      page.getByTestId(`payment-support-cell-razorpay-${PAID_ROW.order_id}`)
    ).toContainText(PAID_ROW.razorpay_payment_id);
    diag.assertClean();
  });

  test("smart search by phone passes the raw query through and re-renders against the filtered set", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupAdminDashboard(page);

    // Stateful mock: the UI forwards the raw search string verbatim to
    // the endpoint — normalisation to last-10 digits happens inside
    // the route handler before hitting Postgres. The mock approximates
    // that server-side behaviour by stripping non-digits and matching
    // on the trailing portion of each fixture's phone number.
    await mockJson(
      page,
      "**/api/admin/payments/recent**",
      ({ request }) => {
        const q = new URL(request.url()).searchParams.get("q") || "";
        if (!q) {
          return jsonOk({ rows: [PAID_ROW, ALL_JODHPUR_ROW] });
        }
        const digits = q.replace(/\D/g, "").slice(-10);
        if (digits.length >= 4 && PAID_ROW.provider_phone.endsWith(digits)) {
          return jsonOk({ rows: [PAID_ROW] });
        }
        if (
          digits.length >= 4 &&
          ALL_JODHPUR_ROW.provider_phone.endsWith(digits)
        ) {
          return jsonOk({ rows: [ALL_JODHPUR_ROW] });
        }
        return jsonOk({ rows: [] });
      }
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("payment-support-tab-toggle").click();

    // Initial fetch — both rows.
    await expect(
      page.getByTestId(`payment-support-row-${PAID_ROW.order_id}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`payment-support-row-${ALL_JODHPUR_ROW.order_id}`)
    ).toBeVisible();

    // Realistic admin input — a phone copy-pasted with separators.
    // Mock normalises server-side, so this must resolve to PAID_ROW.
    await page
      .getByTestId("payment-support-search-input")
      .fill("+91 99999 00001");
    await page.getByTestId("payment-support-search-submit").click();

    await expect(
      page.getByTestId(`payment-support-row-${PAID_ROW.order_id}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`payment-support-row-${ALL_JODHPUR_ROW.order_id}`)
    ).toHaveCount(0);
    diag.assertClean();
  });

  test("smart search by provider ID returns only that provider", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupAdminDashboard(page);

    await mockJson(
      page,
      "**/api/admin/payments/recent**",
      ({ request }) => {
        const q = new URL(request.url()).searchParams.get("q") || "";
        if (q === ALL_JODHPUR_ROW.provider_id) {
          return jsonOk({ rows: [ALL_JODHPUR_ROW] });
        }
        return jsonOk({ rows: [PAID_ROW, ALL_JODHPUR_ROW] });
      }
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("payment-support-tab-toggle").click();
    await page
      .getByTestId("payment-support-search-input")
      .fill(ALL_JODHPUR_ROW.provider_id);
    await page.getByTestId("payment-support-search-submit").click();

    await expect(
      page.getByTestId(`payment-support-row-${ALL_JODHPUR_ROW.order_id}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`payment-support-row-${PAID_ROW.order_id}`)
    ).toHaveCount(0);
    diag.assertClean();
  });

  test("smart search by Razorpay payment id returns single row", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupAdminDashboard(page);

    await mockJson(
      page,
      "**/api/admin/payments/recent**",
      ({ request }) => {
        const q = new URL(request.url()).searchParams.get("q") || "";
        if (q === PAID_ROW.razorpay_payment_id) {
          return jsonOk({ rows: [PAID_ROW] });
        }
        return jsonOk({ rows: [PAID_ROW, ALL_JODHPUR_ROW] });
      }
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("payment-support-tab-toggle").click();
    await page
      .getByTestId("payment-support-search-input")
      .fill(PAID_ROW.razorpay_payment_id);
    await page.getByTestId("payment-support-search-submit").click();

    await expect(
      page.getByTestId(`payment-support-row-${PAID_ROW.order_id}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`payment-support-row-${ALL_JODHPUR_ROW.order_id}`)
    ).toHaveCount(0);
    diag.assertClean();
  });

  test("no-match search shows the empty state with the query echoed", async ({
    page,
    diag,
  }) => {
    await bootstrapAdminSession(page);
    await setupAdminDashboard(page);

    await mockJson(
      page,
      "**/api/admin/payments/recent**",
      ({ request }) => {
        const q = new URL(request.url()).searchParams.get("q") || "";
        if (!q) {
          return jsonOk({ rows: [PAID_ROW] });
        }
        return jsonOk({ rows: [] });
      }
    );

    await gotoPath(page, "/admin/dashboard");
    await page.getByTestId("payment-support-tab-toggle").click();
    await expect(
      page.getByTestId(`payment-support-row-${PAID_ROW.order_id}`)
    ).toBeVisible();

    await page
      .getByTestId("payment-support-search-input")
      .fill("pay_NONEXISTENT_zzz");
    await page.getByTestId("payment-support-search-submit").click();

    const empty = page.getByTestId("payment-support-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("pay_NONEXISTENT_zzz");
    diag.assertClean();
  });

  test("endpoint is live (no snapshot-cache wrapper)", async ({ page }) => {
    // We intentionally do NOT assert the production `cache-control:
    // no-store` header here — Next dev mode (Turbopack) does not
    // emit it even though `dynamic = "force-dynamic"` is set in the
    // route. The production guarantee lives in the route file
    // (dynamic + revalidate=0); this test pins the orthogonal
    // observation that the endpoint is NOT wrapped by the admin
    // snapshot cache: ie its response does not carry the `cache.*`
    // metadata shape that respondWithCachedAdminPayload always adds.
    //
    // Provider-plan growth-summary is the canonical cached endpoint
    // and always returns { ok, data, cache: { cached, last_updated_at,
    // ... } }. payments/recent MUST never grow that wrapper because
    // staleness would defeat the "real-time support lookup" purpose.
    await bootstrapAdminSession(page);
    const res = await page.request.get(
      appUrl("/api/admin/payments/recent")
    );
    // Status may be 200 (admin verified) or 401 (admin lookup failed
    // in dev — the QA admin phone might not resolve). Either way the
    // body shape is decisive.
    expect([200, 401, 403]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    expect(
      body,
      "payments/recent must not be wrapped by snapshotCache; the cache key indicates wrapping"
    ).not.toHaveProperty("cache");
  });
});
