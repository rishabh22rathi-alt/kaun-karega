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
        amount: 3100,
        currency: "INR",
      })
    );

    await gotoPath(page, "/provider/dashboard");
    await expect(
      page.getByTestId("provider-plan-payments-disabled")
    ).toHaveCount(0);

    const upgrade = page.getByTestId("provider-plan-upgrade-regions-5");
    await expect(upgrade).toBeVisible();
    await upgrade.click();

    // Once Razorpay modal "opens", both buttons stay disabled.
    await expect(upgrade).toBeDisabled();
    await expect(
      page.getByTestId("provider-plan-upgrade-all-jodhpur")
    ).toBeDisabled();
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

    // Razorpay modal stub is now "open". Simulate the success callback.
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
