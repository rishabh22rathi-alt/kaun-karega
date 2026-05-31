/**
 * ProviderPlanCard — Razorpay-first upgrade flow.
 *
 * Covers the state-machine the card walks through on an upgrade click:
 *
 *   click → creating-order → checkout-open → verifying → verified-waiting
 *
 * Each scenario mocks the relevant endpoints and stubs out
 * window.Razorpay before navigation, so no real Razorpay script is
 * loaded and no real network call hits Razorpay. The webhook is not
 * exercised here — by design, the card only confirms signature verify;
 * plan activation is the webhook's job, tested separately.
 *
 * Plus: PAYMENT_ENABLED=false (via Plan.paymentsEnabled=false in the
 * mocked dashboard payload) hides the upgrade buttons behind a clear
 * "Online payment is not enabled yet" banner.
 */

import type { Page } from "@playwright/test";

import { bootstrapProviderSession } from "../_support/auth";
import {
  COMMON_AREAS,
  QA_PROVIDER_PHONE,
  buildProviderDashboardResponse,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { jsonOk, mockJson, mockKkActions } from "../_support/routes";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

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

function profileWithPlan(plan: {
  code: string;
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
  paymentsEnabled: boolean;
}): Record<string, unknown> {
  const base = buildProviderDashboardResponse();
  const provider = base.provider as Record<string, unknown>;
  return {
    ...base,
    provider: { ...provider, Plan: plan },
  };
}

// Replaces window.Razorpay with a controllable stub. The stub records
// the handler/ondismiss callbacks so test scenarios can synchronously
// invoke either to simulate Razorpay's modal lifecycle.
async function installRazorpayStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type StubOptions = {
      handler?: (response: Record<string, unknown>) => void;
      modal?: { ondismiss?: () => void };
      order_id?: string;
      webview_intent?: boolean;
    };
    const w = window as unknown as {
      __razorpayLastOptions?: StubOptions;
      Razorpay?: unknown;
    };
    w.Razorpay = function StubRazorpay(options: StubOptions) {
      w.__razorpayLastOptions = options;
      return {
        open: () => {
          // Modal is "open" — tests invoke fireRazorpaySuccess /
          // fireRazorpayDismiss from page.evaluate when ready.
        },
      };
    } as unknown as Window["Razorpay"];
  });
}

// Razorpay's stub captures its options object on construction inside
// runCreateOrder, which happens after the create-order POST resolves
// and the script loader returns. Firing the success/dismiss handler
// before that point silently no-ops against an undefined callback —
// the test then races and asserts on stale UI. This helper blocks
// until the stub has actually received options with the required
// handler, mirroring the expect.poll pattern used by the
// "free + paymentsEnabled=true" test for the same reason.
async function waitForRazorpayStubReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const w = window as unknown as {
            __razorpayLastOptions?: { handler?: unknown };
          };
          return Boolean(w.__razorpayLastOptions?.handler);
        }),
      { timeout: 5_000 }
    )
    .toBe(true);
}

async function fireRazorpaySuccess(
  page: Page,
  paymentId = "pay_TEST_PAYMENT_ID"
): Promise<void> {
  await page.evaluate(
    ({ paymentId }) => {
      const w = window as unknown as {
        __razorpayLastOptions?: {
          handler?: (response: Record<string, unknown>) => void;
          order_id?: string;
        };
      };
      const opts = w.__razorpayLastOptions;
      if (!opts?.handler) return;
      opts.handler({
        razorpay_payment_id: paymentId,
        razorpay_order_id: opts.order_id || "order_TEST_FALLBACK",
        razorpay_signature: "sig_TEST",
      });
    },
    { paymentId }
  );
}

async function fireRazorpayDismiss(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __razorpayLastOptions?: { modal?: { ondismiss?: () => void } };
    };
    w.__razorpayLastOptions?.modal?.ondismiss?.();
  });
}

async function getRazorpayCheckoutOptions(
  page: Page
): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __razorpayLastOptions?: Record<string, unknown>;
    };
    return w.__razorpayLastOptions;
  });
}

// Phase 2: every paid purchase opens a terms-confirmation modal before
// the create-order POST. Tests that previously clicked the upgrade
// button and asserted directly on Razorpay state must now click
// through the terms modal first.
async function confirmPaymentTerms(page: Page): Promise<void> {
  const modal = page.getByTestId("payment-terms-modal");
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("payment-terms-checkbox").check();
  await page.getByTestId("payment-terms-continue").click();
}

test.describe("ProviderPlanCard — Razorpay-first upgrade flow", () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapProviderSession(page);
    await injectProviderUiHint(page, QA_PROVIDER_PHONE);
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
    await installRazorpayStub(page);
  });

  test("all_jodhpur current plan: Full Jodhpur is emphasized and 5-region popular badge is hidden", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "all_jodhpur",
          maxRegions: 9999,
          currentPeriodEnd: "2026-06-30T00:00:00.000Z",
          active: true,
          paymentsEnabled: true,
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("provider-plan-pill")).toHaveText(/101 Plan/);
    await expect(page.getByTestId("provider-plan-active-badge")).toHaveText("Active");
    await expect(page.getByTestId("provider-plan-max-regions")).toHaveText(
      "Get business from whole city"
    );
    await expect(page.getByTestId("provider-plan-usage-unlimited")).toHaveText(
      "All Jodhpur regions covered"
    );

    const fullJodhpur = page.getByTestId("provider-plan-compare-all_jodhpur");
    const fiveRegions = page.getByTestId("provider-plan-compare-regions_5");
    await expect(fullJodhpur).toHaveAttribute("data-current", "true");
    await expect(fullJodhpur).toHaveAttribute("data-visual-emphasis", "strong");
    await expect(
      page.getByTestId("provider-plan-compare-current-badge-all_jodhpur")
    ).toHaveText(/Your plan/i);
    await expect(
      page.getByTestId("provider-plan-compare-title-all_jodhpur")
    ).toHaveClass(/text-base/);
    await expect(fullJodhpur.getByText("Maximum city-wide reach")).toHaveClass(
      /font-semibold/
    );
    await expect(
      fiveRegions.getByTestId("provider-plan-compare-popular-badge")
    ).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-compare-cta-regions_5")).toHaveText(
      /Pay and choose this plan/i
    );
    await expect(page.getByTestId("provider-plan-compare-cta-regions_5")).not.toHaveText(
      /downgrade/i
    );
    await expect(page.getByTestId("provider-plan-compare-cta-all_jodhpur")).toHaveText(
      "Your plan"
    );
    await expect(page.getByTestId("provider-plan-compare-cta-all_jodhpur")).toBeDisabled();
  });

  test("free current plan: 5-region plan keeps popular badge and upgrade CTAs", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const fiveRegions = page.getByTestId("provider-plan-compare-regions_5");
    await expect(
      fiveRegions.getByTestId("provider-plan-compare-popular-badge")
    ).toHaveText(/Most Popular/i);
    await expect(page.getByTestId("provider-plan-compare-cta-regions_5")).toHaveText(
      /Pay and choose this plan/i
    );
    await expect(page.getByTestId("provider-plan-compare-cta-all_jodhpur")).toHaveText(
      /Pay and choose this plan/i
    );
  });

  test("regions_5 current plan: 5-region card shows Your plan without duplicate popular badge", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "regions_5",
          maxRegions: 5,
          currentPeriodEnd: "2026-06-30T00:00:00.000Z",
          active: true,
          paymentsEnabled: true,
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    const fiveRegions = page.getByTestId("provider-plan-compare-regions_5");
    await expect(fiveRegions).toHaveAttribute("data-current", "true");
    await expect(
      page.getByTestId("provider-plan-compare-current-badge-regions_5")
    ).toHaveText(/Your plan/i);
    await expect(
      fiveRegions.getByTestId("provider-plan-compare-popular-badge")
    ).toHaveCount(0);
    await expect(page.getByTestId("provider-plan-compare-cta-regions_5")).toHaveText(
      "Your plan"
    );
    await expect(page.getByTestId("provider-plan-compare-cta-all_jodhpur")).toHaveText(
      /Pay and choose this plan/i
    );
  });

  test("free + paymentsEnabled=false: upgrade buttons hidden behind a clear banner", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: false,
        })
      )
    );

    await gotoPath(page, "/provider/dashboard");

    await expect(page.getByTestId("provider-plan-card")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByTestId("provider-plan-payments-disabled")
    ).toBeVisible();
    await expect(
      page.getByText(/Online payment is not enabled yet/i)
    ).toBeVisible();
    await expect(
      page.getByTestId("provider-plan-upgrade-regions-5")
    ).toHaveCount(0);
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toHaveCount(0);
  });

  test("free + paymentsEnabled=true: upgrade buttons render and disable while checkout is in flight", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_TEST_REGIONS5",
        key_id: "rzp_test_KEYID",
        amount: 3658,
        currency: "INR",
        // Server-resolved authenticated provider phone (drives prefill.contact).
        provider_phone: "9509597100",
      })
    );

    await gotoPath(page, "/provider/dashboard");
    await expect(
      page.getByTestId("provider-plan-payments-disabled")
    ).toHaveCount(0);

    const upgrade = page.getByTestId("provider-plan-upgrade-regions-5");
    await expect(upgrade).toBeVisible();
    await upgrade.click();
    await confirmPaymentTerms(page);

    // Once Razorpay modal "opens", both buttons stay disabled.
    await expect
      .poll(async () => {
        const options = await getRazorpayCheckoutOptions(page);
        return options?.webview_intent;
      })
      .toBe(true);
    await expect(upgrade).toBeDisabled();
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toBeDisabled();

    // Prefill is server-authoritative: contact = the resolved provider
    // phone (never a device-cached value), name is set, email is omitted.
    const options = await getRazorpayCheckoutOptions(page);
    const prefill = options?.prefill as
      | { name?: string; contact?: string; email?: string }
      | undefined;
    expect(prefill?.contact).toBe("9509597100");
    expect(prefill?.name).toBeTruthy();
    expect(prefill ? "email" in prefill : false).toBe(false);
  });

  test("happy path: create-order → handler → verify → verified-waiting with Refresh-now button", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_TEST_REGIONS5",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
      })
    );
    await mockJson(
      page,
      "**/api/payments/verify",
      jsonOk({
        ok: true,
        status: "created",
        message: "Signature verified.",
      })
    );

    await gotoPath(page, "/provider/dashboard");
    await page.getByTestId("provider-plan-upgrade-regions-5").click();
    await confirmPaymentTerms(page);

    // Razorpay modal stub is now "open". Simulate the success callback.
    await waitForRazorpayStubReady(page);
    await fireRazorpaySuccess(page);

    // Verify roundtrip succeeded → verified-waiting banner.
    await expect(
      page.getByText(
        /Payment received\. Plan activation may take a few seconds/i
      )
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("provider-plan-refresh-now")).toBeVisible();
    // Status banner uses the info kind.
    await expect(page.getByTestId("provider-plan-status")).toHaveAttribute(
      "data-status-kind",
      "info"
    );
  });

  test("dismiss path: modal closed without payment resets to idle with retry hint", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_TEST_REGIONS5",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
      })
    );

    await gotoPath(page, "/provider/dashboard");
    const upgrade = page.getByTestId("provider-plan-upgrade-regions-5");
    await upgrade.click();
    await expect(upgrade).toBeDisabled();
    await confirmPaymentTerms(page);

    await waitForRazorpayStubReady(page);
    await fireRazorpayDismiss(page);

    await expect(
      page.getByText(/Payment cancelled\. You can try again any time\./i)
    ).toBeVisible();
    await expect(upgrade).toBeEnabled();
  });

  test("create-order returns 503 → user sees clear payments-disabled error and can retry", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          // The dashboard reported enabled (cache from before the env
          // flip); the route is what actually decides.
          paymentsEnabled: true,
        })
      )
    );
    await mockJson(page, "**/api/payments/create-order", {
      status: 503,
      body: { ok: false, error: "PAYMENTS_DISABLED" },
    });

    await gotoPath(page, "/provider/dashboard");
    const upgrade = page.getByTestId("provider-plan-upgrade-regions-5");
    await upgrade.click();
    await confirmPaymentTerms(page);

    await expect(
      page.getByText(/Online payment is not enabled yet/i)
    ).toBeVisible();
    await expect(page.getByTestId("provider-plan-status")).toHaveAttribute(
      "data-status-kind",
      "error"
    );
    // Button reactivates after the error so the provider can retry.
    await expect(upgrade).toBeEnabled();
  });

  test("scheduled_paid_lower: polling clears Processing and reveals scheduled banner once scheduledPlan appears", async ({
    page,
  }) => {
    // Provider currently on all_jodhpur, scheduling down to regions_5.
    // The dashboard-profile mock returns the base plan first; from the
    // second call onward (the post-verify silent refetch poll) it returns
    // the same row enriched with scheduledPlan.code = "regions_5" — i.e.
    // we simulate the webhook landing between attempts. The card's
    // bounded poll must observe the change and resetToIdle so the CTA
    // exits "Processing…" automatically.
    const FUTURE_END = "2026-08-30T00:00:00.000Z";
    const basePlan = {
      code: "all_jodhpur",
      maxRegions: 99,
      currentPeriodEnd: FUTURE_END,
      active: true,
      paymentsEnabled: true,
    };
    const scheduledPlan = {
      code: "regions_5",
      maxRegions: 5,
      activatesAt: FUTURE_END,
      paymentOrderId: "order_TEST_REGIONS5",
    };

    let profileCallCount = 0;
    await mockJson(page, "**/api/provider/dashboard-profile**", () => {
      profileCallCount += 1;
      const planForCall =
        profileCallCount <= 1
          ? basePlan
          : { ...basePlan, scheduledPlan };
      return jsonOk(profileWithPlan(planForCall));
    });

    // Picker requires the regions catalogue. Five regions so the picker
    // can satisfy the requiredCount=5 cap exactly.
    await mockJson(
      page,
      "**/api/area-intelligence/regions**",
      jsonOk({
        regions: [
          { region_code: "R-A", region_name: "Region A", areas: [] },
          { region_code: "R-B", region_name: "Region B", areas: [] },
          { region_code: "R-C", region_name: "Region C", areas: [] },
          { region_code: "R-D", region_name: "Region D", areas: [] },
          { region_code: "R-E", region_name: "Region E", areas: [] },
        ],
      })
    );

    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_TEST_REGIONS5",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
        plan_change_mode: "scheduled_paid_lower",
      })
    );
    await mockJson(
      page,
      "**/api/payments/verify",
      jsonOk({ ok: true, status: "created" })
    );

    await gotoPath(page, "/provider/dashboard");

    // Open picker via the comparison-grid CTA (the top-level upgrade
    // button is only rendered when current code is "free").
    await page.getByTestId("provider-plan-compare-cta-regions_5").click();
    await expect(page.getByTestId("scheduled-region-picker")).toBeVisible({
      timeout: 5_000,
    });
    for (const code of ["R-A", "R-B", "R-C", "R-D", "R-E"]) {
      await page.getByTestId(`scheduled-region-option-${code}`).click();
    }
    await page.getByTestId("scheduled-region-picker-continue").click();
    await confirmPaymentTerms(page);

    await waitForRazorpayStubReady(page);
    await fireRazorpaySuccess(page);

    // The scheduled banner appears once the poll observes scheduledPlan
    // in the refetched profile. resetToIdle then flips the CTA out of
    // "Processing…" — the button reverts to its normal label.
    await expect(
      page.getByTestId("provider-plan-scheduled-banner")
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("provider-plan-compare-cta-regions_5")
    ).not.toHaveText(/Processing/i, { timeout: 15_000 });
  });

  test("scheduled_paid_lower: poll exhausts without scheduledPlan → Processing clears and 'Please refresh' fallback message remains", async ({
    page,
  }) => {
    // Same setup as the previous test, but the mock NEVER advertises a
    // scheduledPlan — simulates a webhook that hasn't landed within the
    // poll budget (≈7.5s). The card must still exit "Processing…" via
    // resetToIdle once the budget exhausts, and the status banner's
    // "Please refresh if it does not update." copy must remain visible
    // so the user has a manual recovery path.
    const FUTURE_END = "2026-08-30T00:00:00.000Z";
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "all_jodhpur",
          maxRegions: 99,
          currentPeriodEnd: FUTURE_END,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await mockJson(
      page,
      "**/api/area-intelligence/regions**",
      jsonOk({
        regions: [
          { region_code: "R-A", region_name: "Region A", areas: [] },
          { region_code: "R-B", region_name: "Region B", areas: [] },
          { region_code: "R-C", region_name: "Region C", areas: [] },
          { region_code: "R-D", region_name: "Region D", areas: [] },
          { region_code: "R-E", region_name: "Region E", areas: [] },
        ],
      })
    );
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_TEST_REGIONS5",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
        plan_change_mode: "scheduled_paid_lower",
      })
    );
    await mockJson(
      page,
      "**/api/payments/verify",
      jsonOk({ ok: true, status: "created" })
    );

    await gotoPath(page, "/provider/dashboard");

    await page.getByTestId("provider-plan-compare-cta-regions_5").click();
    await expect(page.getByTestId("scheduled-region-picker")).toBeVisible({
      timeout: 5_000,
    });
    for (const code of ["R-A", "R-B", "R-C", "R-D", "R-E"]) {
      await page.getByTestId(`scheduled-region-option-${code}`).click();
    }
    await page.getByTestId("scheduled-region-picker-continue").click();
    await confirmPaymentTerms(page);

    await waitForRazorpayStubReady(page);
    await fireRazorpaySuccess(page);

    // The "Payment received…" status arrives immediately on verify;
    // the bounded poll runs ~5 × 1.5s and then resetToIdle fires
    // regardless. Within ≈15s the CTA must no longer say "Processing…".
    await expect(
      page.getByText(/Payment received\. Plan activation may take a few seconds/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId("provider-plan-compare-cta-regions_5")
    ).not.toHaveText(/Processing/i, { timeout: 15_000 });
    // Scheduled banner must NOT appear — the mock never returned
    // scheduledPlan. The fallback message text remains so the user
    // can manually refresh.
    await expect(
      page.getByTestId("provider-plan-scheduled-banner")
    ).toHaveCount(0);
    await expect(
      page.getByText(/Please refresh if it does not update/i)
    ).toBeVisible();
  });

  test("verify rejects bad signature → error banner, no verified-waiting", async ({
    page,
  }) => {
    await mockJson(
      page,
      "**/api/provider/dashboard-profile**",
      jsonOk(
        profileWithPlan({
          code: "free",
          maxRegions: 1,
          currentPeriodEnd: null,
          active: true,
          paymentsEnabled: true,
        })
      )
    );
    await mockJson(
      page,
      "**/api/payments/create-order",
      jsonOk({
        ok: true,
        order_id: "order_TEST_REGIONS5",
        key_id: "rzp_test_KEYID",
        amount: 3100,
        currency: "INR",
      })
    );
    await mockJson(page, "**/api/payments/verify", {
      status: 400,
      body: { ok: false, error: "BAD_SIGNATURE" },
    });

    await gotoPath(page, "/provider/dashboard");
    await page.getByTestId("provider-plan-upgrade-regions-5").click();
    await confirmPaymentTerms(page);
    await waitForRazorpayStubReady(page);
    await fireRazorpaySuccess(page);

    await expect(
      page.getByText(/Verification failed/i)
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("provider-plan-status")).toHaveAttribute(
      "data-status-kind",
      "error"
    );
    await expect(page.getByTestId("provider-plan-refresh-now")).toHaveCount(0);
  });
});
