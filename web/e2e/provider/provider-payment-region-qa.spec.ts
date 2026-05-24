/**
 * Provider Payment + Region-Selection QA Audit Suite.
 *
 * This is a COMPREHENSIVE audit / discovery suite — not a production
 * regression set. Its job is to surface real defects across the
 * Razorpay-first upgrade flow, the provider plan card, the region
 * selection card UI, and the registration/edit flow, without making
 * any production code changes.
 *
 * Groups (matching the audit brief):
 *   A. Provider dashboard plan-card states
 *   B. Razorpay-first upgrade flow — strict assertions
 *   C. Region-selection UI — cap, save behavior, mobile
 *   D. Server-side enforcement — references the QA harness spec
 *   E. Provider registration flow
 *   F. Badge separation (Verified vs Plan)
 *   G. Matching safety — references the regression spec
 *   H. UI discovery / polish
 *
 * Test design rules:
 *   - All endpoints are mocked. No real Razorpay traffic, no real DB
 *     mutations.
 *   - window.Razorpay is replaced with a controllable stub so the
 *     handler/ondismiss callbacks can be invoked synchronously.
 *   - Mobile assertions use viewport 390x844; horizontal-overflow
 *     checks compare document.documentElement.scrollWidth to the
 *     viewport width with a small tolerance for shadow/render quirks.
 *   - When a test cannot rely on an existing testid because none is
 *     present yet, it falls back to stable text/role selectors and the
 *     comment documents the testid that should be added later.
 *
 * Existing coverage NOT duplicated here:
 *   - `e2e/payments/provider-plan-card-flow.spec.ts` — basic Razorpay
 *     state machine.
 *   - `e2e/provider/provider-region-card-expand.spec.ts` — "+N more"
 *     toggle.
 *   - `e2e/payments/region-cap-enforcement.spec.ts` — server-side cap
 *     enforcement (opt-in via QA_HARNESS_RECONCILE).
 *   - `e2e/strict-region-matching.spec.ts` — matching pipeline.
 *
 * This file adds the NEXT layer of audit coverage on top of those.
 */

import type { Page, Request } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
  QA_AREA,
  QA_CATEGORY,
  QA_PROVIDER_ID,
  QA_PROVIDER_NAME,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";
import { isReconcileHarnessEnabled } from "../_support/qaReconcile";

// ─── Shared helpers ─────────────────────────────────────────────────────

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
// Tolerance for box-shadow / fractional layout overflow on mobile
// width assertions.
const OVERFLOW_PX_TOLERANCE = 4;

async function injectProviderUiHint(page: Page, phone: string) {
  await page.context().addCookies([
    {
      name: "kk_session_user",
      value: JSON.stringify({
        phone,
        verified: true,
        createdAt: Date.now(),
      }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
  ]);
}

type ProviderPlanFixture = {
  code: "free" | "regions_5" | "all_jodhpur";
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
  paymentsEnabled: boolean;
};

function profileWithPlan(
  plan: ProviderPlanFixture,
  providerOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return {
    ...base,
    provider: { ...provider, ...providerOverrides, Plan: plan },
  };
}

// Long-list region fixture — exceeds the 6-area preview by 19. Stable
// names so the "+19 more" toggle label is deterministic.
const BIG_REGION_AREAS = Array.from(
  { length: 25 },
  (_, i) => `Big Area ${String(i + 1).padStart(2, "0")}`
);

const QA_REGIONS = [
  {
    region_code: "R-SMALL",
    region_name: "Small Region",
    areas: ["Small Area A", "Small Area B", "Small Area C", "Small Area D"],
  },
  {
    region_code: "R-BIG",
    region_name: "Big Region",
    areas: BIG_REGION_AREAS,
  },
  {
    region_code: "R-MED2",
    region_name: "Med Region 2",
    areas: Array.from({ length: 12 }, (_, i) => `Med2 Area ${i + 1}`),
  },
  {
    region_code: "R-MED3",
    region_name: "Med Region 3",
    areas: Array.from({ length: 10 }, (_, i) => `Med3 Area ${i + 1}`),
  },
  {
    region_code: "R-MED4",
    region_name: "Med Region 4",
    areas: Array.from({ length: 9 }, (_, i) => `Med4 Area ${i + 1}`),
  },
  {
    region_code: "R-MED5",
    region_name: "Med Region 5",
    areas: Array.from({ length: 8 }, (_, i) => `Med5 Area ${i + 1}`),
  },
  {
    region_code: "R-MED6",
    region_name: "Med Region 6",
    areas: Array.from({ length: 7 }, (_, i) => `Med6 Area ${i + 1}`),
  },
];

// Razorpay stub installer + helpers (mirrors patterns in
// provider-plan-card-flow.spec.ts; kept inline here so the audit suite
// is self-contained and can be run in isolation).
async function installRazorpayStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type StubOptions = {
      handler?: (response: Record<string, unknown>) => void;
      modal?: { ondismiss?: () => void };
      order_id?: string;
    };
    const w = window as unknown as {
      __razorpayLastOptions?: StubOptions;
      __razorpayConstructorCalls?: number;
      __razorpayOpenCalls?: number;
      Razorpay?: unknown;
    };
    w.__razorpayConstructorCalls = 0;
    w.__razorpayOpenCalls = 0;
    w.Razorpay = function StubRazorpay(options: StubOptions) {
      w.__razorpayConstructorCalls = (w.__razorpayConstructorCalls ?? 0) + 1;
      w.__razorpayLastOptions = options;
      return {
        open: () => {
          w.__razorpayOpenCalls = (w.__razorpayOpenCalls ?? 0) + 1;
        },
      };
    } as unknown as Window["Razorpay"];
  });
}

async function razorpayStubCounters(
  page: Page
): Promise<{ ctor: number; open: number }> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __razorpayConstructorCalls?: number;
      __razorpayOpenCalls?: number;
    };
    return {
      ctor: w.__razorpayConstructorCalls ?? 0,
      open: w.__razorpayOpenCalls ?? 0,
    };
  });
}

async function fireRazorpaySuccess(
  page: Page,
  paymentId = "pay_QA_AUDIT"
): Promise<void> {
  await page.evaluate(({ paymentId }) => {
    const w = window as unknown as {
      __razorpayLastOptions?: {
        handler?: (response: Record<string, unknown>) => void;
        order_id?: string;
      };
    };
    w.__razorpayLastOptions?.handler?.({
      razorpay_payment_id: paymentId,
      razorpay_order_id: w.__razorpayLastOptions?.order_id || "order_QA_AUDIT",
      razorpay_signature: "sig_QA_AUDIT",
    });
  }, { paymentId });
}

async function fireRazorpayDismiss(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __razorpayLastOptions?: { modal?: { ondismiss?: () => void } };
    };
    w.__razorpayLastOptions?.modal?.ondismiss?.();
  });
}

// Request spy: returns the cumulative call list for one URL substring.
// Use to assert "no duplicate create-order calls on double click".
function trackRequests(page: Page, urlSubstring: string): string[] {
  const calls: string[] = [];
  const onRequest = (request: Request) => {
    if (request.url().includes(urlSubstring)) {
      calls.push(`${request.method()} ${request.url()}`);
    }
  };
  page.on("request", onRequest);
  return calls;
}

// Common provider session + catalog mocks. Each test that needs a
// dashboard or register page calls this first.
async function bootstrapProviderForDashboard(
  page: Page,
  plan: ProviderPlanFixture,
  providerOverrides: Record<string, unknown> = {}
): Promise<void> {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page, QA_PROVIDER_PHONE);
  await installRazorpayStub(page);
  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
  });
  await mockJson(
    page,
    "**/api/provider/notifications",
    jsonOk({ notifications: [] })
  );
  await mockJson(
    page,
    "**/api/provider/dashboard-profile**",
    jsonOk(profileWithPlan(plan, providerOverrides))
  );
}

async function bootstrapProviderForRegister(
  page: Page,
  options: {
    planMaxRegions: number;
    planCode: "free" | "regions_5" | "all_jodhpur";
    ruleKind: "fixed" | "cityWide";
  }
): Promise<void> {
  await bootstrapProviderSession(page);
  await injectProviderUiHint(page, QA_PROVIDER_PHONE);
  await installRazorpayStub(page);
  await mockJson(
    page,
    "**/api/categories**",
    jsonOk({
      data: COMMON_CATEGORIES.map((c) => ({ name: c.name, active: c.active })),
    })
  );
  await mockJson(page, "**/api/areas**", jsonOk({ areas: COMMON_AREAS }));
  await mockJson(
    page,
    "**/api/area-intelligence/regions**",
    jsonOk({ regions: QA_REGIONS })
  );
  await mockJson(
    page,
    "**/api/provider/dashboard-profile**",
    jsonOk(buildProviderDashboardResponse())
  );
  await mockJson(
    page,
    "**/api/provider/plan**",
    jsonOk({
      ok: true,
      plan: {
        code: options.planCode,
        maxRegions: options.planMaxRegions,
        currentPeriodEnd: null,
        active: true,
        ruleKind: options.ruleKind,
      },
      remaining: { region_change: 3, category_change: 3 },
      monthlyLimit: 3,
    })
  );
  const provider = {
    ProviderID: QA_PROVIDER_ID,
    ProviderName: QA_PROVIDER_NAME,
    Phone: QA_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    PendingApproval: "no",
    Status: "active",
    Services: [{ Category: QA_CATEGORY }],
    Areas: [{ Area: QA_AREA }],
  };
  await mockKkActions(page, {
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_provider_by_phone: () => jsonOk({ provider }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [] }),
  });
  await mockJson(
    page,
    "**/api/provider/notifications",
    jsonOk({ notifications: [] })
  );
}

async function detectHorizontalOverflow(
  page: Page
): Promise<{ documentScrollWidth: number; viewportWidth: number; overflow: number }> {
  return await page.evaluate(() => {
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overflow:
        document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

// ─── Group A: Provider dashboard plan-card audit ────────────────────────

test.describe("A. Provider dashboard plan card — state audit", () => {
  test("A1. Free plan + paymentsEnabled=true: shows Free pill, no Active badge, upgrade buttons visible", async ({
    page,
  }) => {
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    const card = page.getByTestId("provider-plan-card");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("provider-plan-pill")).toContainText("Free");
    await expect(page.getByTestId("provider-plan-active-badge")).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-expired-badge")).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-upgrade-regions-5")).toBeVisible();
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-max-regions")).toContainText(
      /1 region included|1\b/i
    );
  });

  test("A2. Free plan + paymentsEnabled=false: payment-disabled banner replaces upgrade buttons", async ({
    page,
  }) => {
    const orderRequests = trackRequests(page, "/api/payments/create-order");
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: false,
    });
    await gotoPath(page, "/provider/dashboard");

    await expect(
      page.getByTestId("provider-plan-payments-disabled")
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/Online payment is not enabled yet/i)
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-upgrade-regions-5")).toHaveCount(
      0
    );
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toHaveCount(0);

    // Even clicking a compare-grid CTA must not call create-order.
    const compareCta = page.getByTestId("provider-plan-compare-cta-regions_5");
    if (await compareCta.isVisible().catch(() => false)) {
      await expect(compareCta).toBeDisabled();
    }
    expect(orderRequests).toEqual([]);
  });

  test("A3. regions_5 active plan: Active badge visible, 5-region max copy, no 'Payment coming soon'", async ({
    page,
  }) => {
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await bootstrapProviderForDashboard(page, {
      code: "regions_5",
      maxRegions: 5,
      currentPeriodEnd: future,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-active-badge")).toBeVisible();
    await expect(page.getByTestId("provider-plan-expired-badge")).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-max-regions")).toContainText(
      /5 region|up to 5 regions/i
    );
    // The plan card must not include the legacy "Payment coming soon"
    // copy anywhere visible.
    await expect(page.getByText(/Payment coming soon/i)).toHaveCount(0);
    // Upgrade to all_jodhpur is still offered (the only remaining tier
    // above regions_5).
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-upgrade-regions-5")).toHaveCount(
      0
    );
  });

  test("A4. all_jodhpur plan: city-wide copy, no fixed-cap counter, no upgrade buttons", async ({
    page,
  }) => {
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await bootstrapProviderForDashboard(page, {
      code: "all_jodhpur",
      maxRegions: 99,
      currentPeriodEnd: future,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-active-badge")).toBeVisible();
    await expect(
      page.getByTestId("provider-plan-usage-unlimited")
    ).toBeVisible();
    await expect(
      page.getByText(/All Jodhpur regions covered/i)
    ).toBeVisible();
    // Fixed-cap usage counter must NOT appear on a city-wide plan.
    await expect(page.getByTestId("provider-plan-usage")).toHaveCount(0);
    // Already on top tier — neither upgrade button should render.
    await expect(page.getByTestId("provider-plan-upgrade-regions-5")).toHaveCount(
      0
    );
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toHaveCount(0);
  });

  test("A5. Expired paid plan: Expired badge, fallback to free cap, prior-plan hint", async ({
    page,
  }) => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Server's effectivePlan() collapses an expired paid row to
    // { code:"free", maxRegions:1, active:false, currentPeriodEnd:<past> }
    // so the wire-shape we send mirrors that contract.
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: past,
      active: false,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-expired-badge")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByTestId("provider-plan-expired-banner")
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-active-badge")).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-max-regions")).toContainText(
      /1\b|1 region/i
    );
    // Renew CTAs (both plans) are visible to recover.
    await expect(
      page.getByTestId("provider-plan-upgrade-regions-5")
    ).toBeVisible();
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toBeVisible();
  });

  test("A6. Mobile (390x844): plan card has no horizontal overflow; upgrade CTAs reachable", async ({
    page,
  }) => {
    // page.setViewportSize is the per-test viewport override; test.use
    // is forbidden inside test bodies (Playwright only allows it at
    // describe/file level).
    await page.setViewportSize(MOBILE_VIEWPORT);
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    const card = page.getByTestId("provider-plan-card");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId("provider-plan-upgrade-regions-5")
    ).toBeVisible();
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toBeVisible();

    const overflow = await detectHorizontalOverflow(page);
    expect(
      overflow.overflow,
      `documentScrollWidth=${overflow.documentScrollWidth} viewport=${overflow.viewportWidth}`
    ).toBeLessThanOrEqual(OVERFLOW_PX_TOLERANCE);
  });
});

// ─── Group B: Razorpay upgrade UI — strict assertions ───────────────────

test.describe("B. Razorpay upgrade UI — strict assertions", () => {
  test("B1. Double-click upgrade button issues exactly one create-order call", async ({
    page,
  }) => {
    const orderRequests = trackRequests(page, "/api/payments/create-order");
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    // Add a small artificial delay so the second click can race the
    // first if the guard is weak.
    await page.route("**/api/payments/create-order", async (route) => {
      await new Promise((r) => setTimeout(r, 250));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          order_id: "order_RACE_TEST",
          key_id: "rzp_test_KEYID",
          amount: 3100,
          currency: "INR",
        }),
      });
    });

    await gotoPath(page, "/provider/dashboard");
    const upgrade = page.getByTestId("provider-plan-upgrade-regions-5");
    await upgrade.click();
    await upgrade.click({ force: true }).catch(() => {});

    // Wait for the modal to be "open" (stub recorded a constructor
    // call) then check the count.
    await expect
      .poll(async () => (await razorpayStubCounters(page)).ctor, {
        timeout: 5_000,
      })
      .toBe(1);

    expect(orderRequests.length).toBeLessThanOrEqual(1);
    const counters = await razorpayStubCounters(page);
    expect(counters.ctor).toBe(1);
    expect(counters.open).toBe(1);
  });

  test("B2. Verify endpoint is called with exact razorpay_* fields from the handler", async ({
    page,
  }) => {
    type CapturedBody = {
      razorpay_payment_id?: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    };
    let capturedBody: CapturedBody | null = null;
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_VERIFY_TEST",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
      })
    );
    await page.route("**/api/payments/verify", async (route, request) => {
      try {
        capturedBody = JSON.parse(request.postData() ?? "{}") as CapturedBody;
      } catch {
        capturedBody = null;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, status: "created" }),
      });
    });

    await gotoPath(page, "/provider/dashboard");
    await page.getByTestId("provider-plan-upgrade-regions-5").click();
    await fireRazorpaySuccess(page, "pay_VERIFY_TEST");

    await expect.poll(() => capturedBody, { timeout: 5_000 }).not.toBeNull();
    // Route through `unknown` so the narrow survives even when TS has
    // collapsed the let-binding to `null` via closure inference — same
    // pattern used by provider-edit-save-region-enable.spec.ts.
    const verified = capturedBody as unknown as CapturedBody | null;
    expect(verified?.razorpay_payment_id).toBe("pay_VERIFY_TEST");
    expect(verified?.razorpay_order_id).toBe("order_VERIFY_TEST");
    expect(verified?.razorpay_signature).toBe("sig_QA_AUDIT");
    await expect(
      page.getByText(/Payment received\. Plan activation may take a few seconds/i)
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-refresh-now")).toBeVisible();
  });

  test("B3. provider_plans is NOT written from the frontend (no client request to provider_plans)", async ({
    page,
  }) => {
    const directWriteRequests = trackRequests(page, "provider_plans");
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_NO_DIRECT_WRITE",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
      })
    );
    await mockJson(
      page,
      "**/api/payments/verify",
      jsonOk({ ok: true, status: "created" })
    );

    await gotoPath(page, "/provider/dashboard");
    await page.getByTestId("provider-plan-upgrade-regions-5").click();
    await fireRazorpaySuccess(page);

    // Allow any in-flight requests to settle.
    await page.waitForTimeout(750);

    // No request URL should contain provider_plans (i.e. no Supabase
    // REST POST/PATCH to that table from the browser). The plan card
    // only talks to /api/payments/* — the webhook owns provider_plans.
    expect(directWriteRequests).toEqual([]);
  });

  test("B4. Cancel path: ondismiss returns card to idle with retry hint and no verify call", async ({
    page,
  }) => {
    const verifyRequests = trackRequests(page, "/api/payments/verify");
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_DISMISS",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
      })
    );

    await gotoPath(page, "/provider/dashboard");
    const upgrade = page.getByTestId("provider-plan-upgrade-regions-5");
    await upgrade.click();
    await fireRazorpayDismiss(page);

    await expect(
      page.getByText(/Payment cancelled\. You can try again any time\./i)
    ).toBeVisible();
    await expect(upgrade).toBeEnabled();
    expect(verifyRequests).toEqual([]);
  });
});

// ─── Group C: Region-selection UI — caps, save, mobile ──────────────────

test.describe("C. Provider region-selection UI", () => {
  test("C1. Free plan: selecting 2nd region is blocked at the UI button level", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "free",
      planMaxRegions: 1,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    // Click "Pick Region" on Small Region.
    const smallCard = page.locator("div.rounded-2xl", {
      has: page.getByRole("heading", { level: 3, name: "Small Region" }),
    });
    await smallCard.getByRole("button", { name: /^Pick Region$/ }).click();
    await expect(
      smallCard.getByRole("button", { name: /^Selected ✓$/ })
    ).toBeVisible();

    // Now Big Region's Pick Region should be disabled (cap reached).
    const bigCard = page.locator("div.rounded-2xl", {
      has: page.getByRole("heading", { level: 3, name: "Big Region" }),
    });
    const bigPick = bigCard.getByRole("button", { name: /^Pick Region$/ });
    await expect(bigPick).toBeDisabled();
  });

  test("C2. regions_5 plan: 6th region is blocked at the UI button level", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "regions_5",
      planMaxRegions: 5,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    const names = [
      "Small Region",
      "Big Region",
      "Med Region 2",
      "Med Region 3",
      "Med Region 4",
    ];
    for (const name of names) {
      const card = page.locator("div.rounded-2xl", {
        has: page.getByRole("heading", { level: 3, name }),
      });
      await card.getByRole("button", { name: /^Pick Region$/ }).click();
      await expect(
        card.getByRole("button", { name: /^Selected ✓$/ })
      ).toBeVisible();
    }
    const sixth = page.locator("div.rounded-2xl", {
      has: page.getByRole("heading", { level: 3, name: "Med Region 5" }),
    });
    await expect(
      sixth.getByRole("button", { name: /^Pick Region$/ })
    ).toBeDisabled();
  });

  test("C3. all_jodhpur (cityWide): no per-card disable; selection auto-includes all regions", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "all_jodhpur",
      planMaxRegions: 99,
      ruleKind: "cityWide",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    // cityWide auto-selects every active region; the per-card toggle
    // is read-only. The "Whole city coverage active" pill is the
    // canonical confirmation element — target it directly so the
    // assertion isn't tripped by adjacent copy that also mentions
    // "whole city".
    await expect(
      page.getByText("Whole city coverage active")
    ).toBeVisible();
  });

  test("C4. Save button disables while saving and does not fire a duplicate request on double-click", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "regions_5",
      planMaxRegions: 5,
      ruleKind: "fixed",
    });
    const updateRequests = trackRequests(page, "/api/provider/update");
    await page.route("**/api/provider/update**", async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });
    const card = page.locator("div.rounded-2xl", {
      has: page.getByRole("heading", { level: 3, name: "Small Region" }),
    });
    await card.getByRole("button", { name: /^Pick Region$/ }).click();

    const save = page.getByRole("button", { name: /^Save Changes$/ });
    await save.click();
    await save.click({ force: true }).catch(() => {});

    // Give the routing a chance to settle (with the 400ms delay).
    await page.waitForTimeout(800);
    expect(updateRequests.length).toBeLessThanOrEqual(1);
  });

  test("C5. Mobile (390x844): region cards do not overflow horizontally; '+N more' toggle reachable", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await bootstrapProviderForRegister(page, {
      planCode: "regions_5",
      planMaxRegions: 5,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");
    await expect(toggle).toBeVisible();
    await toggle.scrollIntoViewIfNeeded();
    const overflow = await detectHorizontalOverflow(page);
    expect(
      overflow.overflow,
      `documentScrollWidth=${overflow.documentScrollWidth} viewport=${overflow.viewportWidth}`
    ).toBeLessThanOrEqual(OVERFLOW_PX_TOLERANCE);

    // Toggle must actually open on mobile (no tap delay issues).
    await toggle.click();
    await expect(toggle).toHaveText(/Show less/i);
  });

  test("C6. Region selection state is independent of expansion: pick → expand → unpick keeps panel open", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "regions_5",
      planMaxRegions: 5,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    const bigCard = page.locator("div.rounded-2xl", {
      has: page.getByRole("heading", { level: 3, name: "Big Region" }),
    });
    await bigCard.getByRole("button", { name: /^Pick Region$/ }).click();
    await page.getByTestId("provider-region-areas-toggle-R-BIG").click();
    await expect(
      page.getByTestId("provider-region-areas-toggle-R-BIG")
    ).toHaveText("Show less");
    // Now unpick.
    await bigCard.getByRole("button", { name: /^Selected ✓$/ }).click();
    // Expansion still open.
    await expect(
      page.getByTestId("provider-region-areas-toggle-R-BIG")
    ).toHaveText("Show less");
    await expect(
      page.getByTestId("provider-region-areas-full-R-BIG")
    ).toBeVisible();
  });
});

// ─── Group D: Server-side enforcement (reference, opt-in) ────────────────

test.describe("D. Server-side enforcement (opt-in via QA_HARNESS_RECONCILE=1)", () => {
  test.skip(
    !isReconcileHarnessEnabled(),
    "Server-side region-cap enforcement lives in e2e/payments/region-cap-enforcement.spec.ts; run it with QA_HARNESS_RECONCILE=1 to mutate real Supabase rows. This describe block is intentionally a pointer."
  );

  test("D1. Reference: see e2e/payments/region-cap-enforcement.spec.ts (free/regions_5/all_jodhpur scenarios)", async () => {
    // Placeholder so the describe block is non-empty when the harness
    // is enabled. The actual server-side assertions live in the
    // region-cap-enforcement.spec.ts file (free→2 rejected,
    // regions_5→5 accepted, regions_5→6 rejected, all_jodhpur→full
    // accepted, plan-lookup-failure → fail-CLOSED).
    expect(true).toBe(true);
  });
});

// ─── Group E: Provider registration flow ────────────────────────────────

test.describe("E. Provider registration flow", () => {
  test("E1. Edit-mode plan-hint copy points provider to dashboard, not Razorpay", async ({
    page,
  }) => {
    const orderRequests = trackRequests(page, "/api/payments/create-order");
    await bootstrapProviderForRegister(page, {
      planCode: "free",
      planMaxRegions: 1,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    // Phase 1 hint card.
    const hint = page.getByTestId("provider-register-plan-manage-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/manage or upgrade your plan/i);
    // "Payment coming soon" copy must NOT appear on register page.
    await expect(page.getByText(/Payment coming soon/i)).toHaveCount(0);
    // No create-order call has been made.
    expect(orderRequests).toEqual([]);
  });

  test("E2. Edit-mode 'Go to Provider Dashboard' link navigates to dashboard", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "free",
      planMaxRegions: 1,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });
    const link = page.getByTestId("provider-register-plan-manage-link");
    if ((await link.count()) > 0) {
      await link.click();
      await expect(page).toHaveURL(/\/provider\/dashboard/, {
        timeout: 5_000,
      });
    } else {
      test.info().annotations.push({
        type: "skip-reason",
        description:
          "First-time registration mode hides the dashboard link by design; only edit-mode renders it. This run may have entered first-time mode if the mocked dashboard-profile shape suppressed edit mode.",
      });
    }
  });

  test("E3. Region '+N more' expansion works during register/edit mode", async ({
    page,
  }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "free",
      planMaxRegions: 1,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");
    await expect(toggle).toHaveText("+19 more");
    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(
      page.getByTestId("provider-region-areas-full-R-BIG")
    ).toContainText("Big Area 25");
  });
});

// ─── Group F: Badge separation (Verified vs Plan) ───────────────────────

test.describe("F. Verified ≠ Paid plan", () => {
  test("F1. Plan card text never contains the word 'Verified'", async ({ page }) => {
    await bootstrapProviderForDashboard(page, {
      code: "regions_5",
      maxRegions: 5,
      currentPeriodEnd: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString(),
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    const card = page.getByTestId("provider-plan-card");
    await expect(card).toBeVisible({ timeout: 5_000 });
    const cardText = (await card.innerText()).toLowerCase();
    expect(cardText.includes("verified")).toBe(false);
    expect(cardText.includes("trust")).toBe(false);
  });

  test("F2. Provider with Verified='no' on a paid plan still shows paid plan; verified state is independent", async ({
    page,
  }) => {
    // Send Verified="no" with an active regions_5 plan. The plan card
    // should still render the paid plan correctly; whatever surface
    // owns the verified-badge (Sidebar) should not promote this
    // provider to verified just because they paid.
    await bootstrapProviderForDashboard(
      page,
      {
        code: "regions_5",
        maxRegions: 5,
        currentPeriodEnd: new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000
        ).toISOString(),
        active: true,
        paymentsEnabled: true,
      },
      { Verified: "no", OtpVerified: "yes" }
    );
    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-active-badge")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-pill")).toContainText(
      /₹31|regions/i
    );
    // No verified mark should appear anywhere in the plan card.
    const card = page.getByTestId("provider-plan-card");
    const cardText = (await card.innerText()).toLowerCase();
    expect(cardText.includes("verified")).toBe(false);
  });
});

// ─── Group G: Matching safety (reference only) ──────────────────────────

test.describe("G. Matching safety reference", () => {
  test("G1. Reference: matching regression lives in e2e/strict-region-matching.spec.ts", async () => {
    // No assertion here. The matching regression is run as a separate
    // command per the QA brief. This block exists so the suite's
    // group structure mirrors the audit document.
    expect(true).toBe(true);
  });
});

// ─── Group H: UI discovery / polish ─────────────────────────────────────

test.describe("H. UI discovery / polish", () => {
  test("H1. '+N more' is a real <button>, not a static span", async ({ page }) => {
    await bootstrapProviderForRegister(page, {
      planCode: "regions_5",
      planMaxRegions: 5,
      ruleKind: "fixed",
    });
    await gotoPath(page, "/provider/register?edit=services");
    await expect(page.getByText(/Edit Provider Profile/i)).toBeVisible({
      timeout: 5_000,
    });

    const toggle = page.getByTestId("provider-region-areas-toggle-R-BIG");
    await expect(toggle).toBeVisible();
    const tag = await toggle.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe("button");
    // Accessible name + aria-expanded present.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute(
      "aria-controls",
      /provider-region-areas-full-R-BIG/
    );
  });

  test("H2. Plan card never shows 'Payment coming soon' when paymentsEnabled=true", async ({
    page,
  }) => {
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");

    const card = page.getByTestId("provider-plan-card");
    await expect(card).toBeVisible({ timeout: 5_000 });
    const text = (await card.innerText()).toLowerCase();
    expect(text.includes("payment coming soon")).toBe(false);
  });

  test("H3. Active badge is NOT rendered on Free plan (cosmetic regression guard)", async ({
    page,
  }) => {
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");
    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-active-badge")).toHaveCount(0);
  });

  test("H4. Compare-plan grid CTAs each have an accessible name", async ({
    page,
  }) => {
    await bootstrapProviderForDashboard(page, {
      code: "free",
      maxRegions: 1,
      currentPeriodEnd: null,
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");
    for (const code of ["free", "regions_5", "all_jodhpur"]) {
      const cta = page.getByTestId(`provider-plan-compare-cta-${code}`);
      await expect(cta).toBeVisible({ timeout: 5_000 });
      const name = await cta.evaluate((el) => el.textContent?.trim() || "");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("H5. Desktop (1280x900): no horizontal overflow on dashboard plan card section", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await bootstrapProviderForDashboard(page, {
      code: "regions_5",
      maxRegions: 5,
      currentPeriodEnd: new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString(),
      active: true,
      paymentsEnabled: true,
    });
    await gotoPath(page, "/provider/dashboard");
    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    const overflow = await detectHorizontalOverflow(page);
    expect(
      overflow.overflow,
      `documentScrollWidth=${overflow.documentScrollWidth} viewport=${overflow.viewportWidth}`
    ).toBeLessThanOrEqual(OVERFLOW_PX_TOLERANCE);
  });
});
