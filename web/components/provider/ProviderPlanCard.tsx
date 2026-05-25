"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";
import PaymentTermsModal from "@/components/provider/PaymentTermsModal";
import ScheduledRegionPicker from "@/components/provider/ScheduledRegionPicker";
import {
  classifyPlanChange,
  type PlanChangeMode,
} from "@/lib/payments/planRank";

/**
 * Stage 4A: Current Plan card for the provider dashboard.
 *
 * Reads its props from the existing /api/provider/dashboard-profile
 * response (provider.Plan + provider.Areas) — no new server APIs.
 * On Upgrade click, fetches /api/payments/create-order and opens the
 * Razorpay checkout. The webhook is the source of truth for plan
 * activation; this component only triggers the order and refreshes
 * the dashboard a few seconds later so the new plan state hydrates.
 *
 * Failure handling is generous: if payments are disabled or the
 * order request fails, we show a friendly inline message rather than
 * a stack trace. No new admin-facing logging — keeps the surface
 * minimal.
 */

const RAZORPAY_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

export type ProviderScheduledPlanShape = {
  code: string;
  maxRegions: number;
  activatesAt: string;
  paymentOrderId: string | null;
};

export type ProviderPlanShape = {
  code: string;
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
  // Additive — emitted by /api/provider/dashboard-profile in the same
  // commit that introduced this field. Absence (older payloads, tests
  // that pre-date the field) is treated as "payments disabled" so the
  // upgrade UI fails closed rather than offering a checkout that 503s.
  paymentsEnabled?: boolean;
  // Phase 1 read-only addition. Always null today — the dashboard
  // route emits it from effectivePlan().scheduled, which only becomes
  // non-null once Phase 2 writes the scheduled_* columns. Optional so
  // older mocked payloads (Playwright fixtures that pre-date this
  // commit) continue to type-check without explicit nulls.
  scheduledPlan?: ProviderScheduledPlanShape | null;
};

export type ProviderPlanCardProps = {
  plan: ProviderPlanShape | null | undefined;
  currentRegionsCount: number;
  providerName?: string;
};

type PlanCode = "free" | "regions_5" | "all_jodhpur";

type PlanCopy = {
  label: string;
  shortLabel: string;
  maxRegionsLabel: string;
};

// Business-friendly copy (per pricing/UX call). Internal plan_code
// values (free / regions_5 / all_jodhpur) are unchanged to minimise
// blast radius across schema, payment_orders, and the existing webhook
// handler.
const PLAN_COPY: Record<PlanCode, PlanCopy> = {
  free: {
    label: "Free",
    shortLabel: "Free",
    maxRegionsLabel: "1 region included",
  },
  regions_5: {
    label: "₹31 — Get business from major areas",
    shortLabel: "₹31 Plan",
    maxRegionsLabel: "Get business from major areas (up to 5 regions)",
  },
  all_jodhpur: {
    label: "₹101 — Get business from whole city",
    shortLabel: "₹101 Plan",
    maxRegionsLabel: "Get business from whole city",
  },
};

type PlanComparisonEntry = {
  code: PlanCode;
  title: string;
  subLabel: string;
  positioning: string;
  bullets: string[];
  popular?: boolean;
};

// Phase 1 wording rules (decided by product):
//   - active current plan      → "Your plan"
//   - paid renewal              → "Pay and renew this plan"
//   - paid select / upgrade /
//     future-lower placeholder  → "Pay and choose this plan"
//   - free plan (when not current)
//                               → "Choose this plan"
// The literal strings are constants here so the wording is changed in
// one place if product revises copy in a later phase. They are NOT
// inlined into JSX so a Playwright text-regex doesn't get
// accidentally drifted out of sync with the source of truth.
const CTA_LABEL_YOUR_PLAN = "Your plan";
const CTA_LABEL_PAID_RENEW = "Pay and renew this plan";
const CTA_LABEL_PAID_CHOOSE = "Pay and choose this plan";
const CTA_LABEL_FREE_CHOOSE = "Choose this plan";

const PLAN_COMPARISON: PlanComparisonEntry[] = [
  {
    code: "free",
    title: "Free",
    subLabel: "1 region included",
    positioning: "Perfect to get started",
    bullets: ["Receive leads for 1 region", "No expiry"],
  },
  {
    code: "regions_5",
    title: "₹31 / 5 Regions",
    subLabel: "5 regions · 30 days",
    positioning: "Best for active providers",
    bullets: ["Serve up to 5 regions", "30-day validity"],
    popular: true,
  },
  {
    code: "all_jodhpur",
    title: "₹101 / Full Jodhpur",
    subLabel: "All regions · 30 days",
    positioning: "Maximum city-wide reach",
    bullets: ["Every region in Jodhpur", "30-day validity"],
  },
];

function asKnownPlanCode(code: string | null | undefined): PlanCode {
  if (code === "regions_5" || code === "all_jodhpur") return code;
  return "free";
}

function formatExpiryDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

declare global {
  // Razorpay's hosted checkout attaches a constructor to window.Razorpay
  // when the script loads. Typed loosely — we only call .open().
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      close?: () => void;
    };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_URL}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

// Razorpay-first upgrade flow state machine. The card progresses through
// these phases on a single upgrade click. Buttons are disabled whenever
// phase !== "idle" so a second click cannot start a parallel order or
// re-open the checkout while one is in flight.
//   idle              → no in-flight upgrade
//   picking-regions   → ScheduledRegionPicker is open (scheduled_paid_lower only)
//   confirming-terms  → PaymentTermsModal is open
//   creating-order    → POST /api/payments/create-order in flight
//   checkout-open     → Razorpay modal is open (no inline banner)
//   verifying         → modal closed with success; POST /api/payments/verify in flight
//   verified-waiting  → signature verified; waiting for the webhook to
//                       flip provider_plans. Source of truth for plan
//                       activation is the webhook, NOT this state.
type UpgradePhase =
  | "idle"
  | "picking-regions"
  | "confirming-terms"
  | "creating-order"
  | "checkout-open"
  | "verifying"
  | "verified-waiting";

// Friendly labels for the terms modal + picker so the surrounding
// copy stays consistent with the plan card. Internal plan_codes
// (regions_5, all_jodhpur) are unchanged.
const PLAN_PRICE_LABEL: Record<Exclude<PlanCode, "free">, string> = {
  regions_5: "₹31",
  all_jodhpur: "₹101",
};
const PLAN_SHORT_LABEL: Record<Exclude<PlanCode, "free">, string> = {
  regions_5: "₹31 plan",
  all_jodhpur: "₹101 plan",
};
// Required region count for the scheduled-paid-lower picker. Mirrors
// PLAN_PRICING.{code}.maxRegions on the server. all_jodhpur is
// city-wide and never appears here (rank 2 is the top tier — there is
// no higher rank to schedule "down to" all_jodhpur from).
const PLAN_REQUIRED_REGIONS: Record<Exclude<PlanCode, "free">, number> = {
  regions_5: 5,
  all_jodhpur: 99,
};

type StatusKind = "info" | "success" | "error";
type StatusMessage = { kind: StatusKind; text: string } | null;

export default function ProviderPlanCard({
  plan,
  currentRegionsCount,
  providerName,
}: ProviderPlanCardProps) {
  const [phase, setPhase] = useState<UpgradePhase>("idle");
  const [busyPlan, setBusyPlan] = useState<PlanCode | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const statusClearTimeoutRef = useRef<number | null>(null);

  // PAYMENT_ENABLED kill switch surfaced through dashboard-profile.
  // Treat absence (older payloads, tests that didn't add the field) as
  // "disabled" so the card refuses to open a checkout that would 503
  // anyway. A future env flip is picked up on the next dashboard load.
  const paymentsEnabled = plan?.paymentsEnabled === true;

  const isUpgradeBusy = phase !== "idle";

  // Auto-clear info/success status messages after a few seconds so the
  // card returns to a calm rest state. Errors persist until the user
  // takes another action.
  const flashStatus = useCallback(
    (kind: StatusKind, text: string, autoClearMs: number | null = null) => {
      setStatusMessage({ kind, text });
      if (statusClearTimeoutRef.current !== null) {
        window.clearTimeout(statusClearTimeoutRef.current);
        statusClearTimeoutRef.current = null;
      }
      if (autoClearMs !== null) {
        statusClearTimeoutRef.current = window.setTimeout(() => {
          setStatusMessage(null);
          statusClearTimeoutRef.current = null;
        }, autoClearMs);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (statusClearTimeoutRef.current !== null) {
        window.clearTimeout(statusClearTimeoutRef.current);
      }
    };
  }, []);

  // Auto-detection of "plan activated" lived here previously but the
  // dashboard does not auto-poll, so the prop transition that would
  // trigger it only happens via a page reload — which remounts this
  // component into a fresh idle state anyway. The "Refresh now" button
  // surfaced in verified-waiting is the explicit user path; closure
  // (banner change) happens naturally on the next mount when the
  // dashboard-profile fetch returns the new plan. If we later add
  // dashboard auto-polling, the transition can be reintroduced via a
  // parent-driven callback rather than a prop-watching effect.

  // effectivePlan() in lib/payments/effectivePlan.ts already collapses
  // expired-paid into { active:false, code:"free", maxRegions:1 } and
  // keeps the original currentPeriodEnd so we can render the "expired"
  // hint here without re-deriving the rule.
  const code: PlanCode = asKnownPlanCode(plan?.code);
  const isActive = plan?.active !== false;
  const isExpired = plan?.active === false;
  const hasExpiryHint = Boolean(plan?.currentPeriodEnd);
  const expiryLabel = formatExpiryDate(plan?.currentPeriodEnd);
  const maxRegions = Math.max(1, plan?.maxRegions ?? 1);
  const usedRegions = Math.max(0, currentRegionsCount);
  const usageOverflow = usedRegions > maxRegions;
  const usageAtCap = !usageOverflow && usedRegions >= maxRegions;
  const usagePercent = Math.min(
    100,
    Math.max(0, (usedRegions / maxRegions) * 100)
  );
  // effectivePlan() already collapses expired-paid → code:"free", so this
  // is functionally `code` in production. Kept explicit so the comparison
  // grid's "current plan" highlight is correct even if a future API path
  // ever forwards a non-collapsed expired row.
  const effectiveCode: PlanCode = isExpired ? "free" : code;
  const isUnlimitedCoverage = effectiveCode === "all_jodhpur";
  const whyUpgradeCopy = isExpired
    ? "Renew below to start getting matched with customers again."
    : effectiveCode === "free"
      ? "Choose a paid plan to serve more regions and reach more customers."
      : effectiveCode === "regions_5"
        ? "Choose the ₹101 plan to cover all of Jodhpur."
        : "You're on the top plan — full city coverage is active.";

  // Dispatch the existing PROVIDER_PROFILE_UPDATED_EVENT so the Sidebar
  // re-hydrates its chip from localStorage. The provider dashboard
  // *page* does not listen to this event today — the user manually
  // refreshes per the inline message in verified-waiting state.
  const notifyProfileUpdated = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
    } catch {
      // Non-critical — the next page navigation will re-read state.
    }
  }, []);

  // Phase 2 state additions. `pendingTarget` is the plan the provider
  // clicked while a modal is open; `pendingRegionCodes` carries the
  // picker's selection forward into the terms modal → create-order
  // POST. `pendingMode` is the client-side classification used to
  // pick which modal to open; the SERVER re-classifies authoritatively.
  const [pendingTarget, setPendingTarget] = useState<
    Exclude<PlanCode, "free"> | null
  >(null);
  const [pendingMode, setPendingMode] = useState<PlanChangeMode | null>(null);
  const [pendingRegionCodes, setPendingRegionCodes] = useState<string[] | null>(
    null
  );

  const resetToIdle = useCallback(() => {
    setPhase("idle");
    setBusyPlan(null);
    setPendingTarget(null);
    setPendingMode(null);
    setPendingRegionCodes(null);
  }, []);

  // The POST → Razorpay portion of the flow. Split out of the click
  // handler in Phase 2 so the picker → terms modal sequence can call
  // it after consent without duplicating the network code. Body now
  // always carries `agreed_terms: true` (server enforces) and
  // optionally `scheduled_region_codes` for the scheduled_paid_lower
  // case.
  const runCreateOrder = useCallback(
    async (
      targetPlan: Exclude<PlanCode, "free">,
      scheduledRegionCodes: string[] | null
    ) => {
      setPhase("creating-order");
      flashStatus("info", "Creating order…");

      type CreateOrderPayload = {
        ok?: boolean;
        order_id?: string;
        key_id?: string;
        amount?: number;
        currency?: string;
        error?: string;
        plan_change_mode?: string;
      };
      let orderData: CreateOrderPayload | null = null;

      try {
        const orderRes = await fetch("/api/payments/create-order", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_code: targetPlan,
            agreed_terms: true,
            ...(scheduledRegionCodes
              ? { scheduled_region_codes: scheduledRegionCodes }
              : {}),
          }),
        });

        if (orderRes.status === 503) {
          flashStatus(
            "error",
            "Online payment is not enabled yet. Please try again later."
          );
          resetToIdle();
          return;
        }
        if (orderRes.status === 401) {
          flashStatus("error", "Please log in again to continue.");
          resetToIdle();
          return;
        }
        if (orderRes.status === 403) {
          flashStatus(
            "error",
            "Only registered providers can upgrade a plan."
          );
          resetToIdle();
          return;
        }

        orderData = (await orderRes.json().catch(
          () => null
        )) as CreateOrderPayload | null;

        if (
          !orderRes.ok ||
          !orderData?.ok ||
          !orderData.order_id ||
          !orderData.key_id
        ) {
          flashStatus(
            "error",
            orderData?.error
              ? `Unable to start checkout (${orderData.error}).`
              : "Unable to start checkout. Please try again."
          );
          resetToIdle();
          return;
        }
      } catch (err) {
        flashStatus(
          "error",
          err instanceof Error
            ? err.message
            : "Network error while starting checkout."
        );
        resetToIdle();
        return;
      }

      // Defensive narrowing for TS: the validation block above returns
      // on every shape that would leave orderData partial, so reaching
      // here implies all required fields are present. The explicit
      // assertion satisfies the type checker without losing safety.
      if (!orderData?.order_id || !orderData.key_id) {
        resetToIdle();
        return;
      }
      const validatedOrder = orderData as {
        order_id: string;
        key_id: string;
        amount?: number;
        currency?: string;
      };

      // Order created — load the checkout script and open the modal.
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        flashStatus(
          "error",
          "Could not load Razorpay. Check your connection and try again."
        );
        resetToIdle();
        return;
      }

      setPhase("checkout-open");
      flashStatus("info", "Payment window opened.");

      const verifyPayment = async (success: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        setPhase("verifying");
        flashStatus("info", "Verifying payment…");
        try {
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_payment_id: success.razorpay_payment_id,
              razorpay_order_id: success.razorpay_order_id,
              razorpay_signature: success.razorpay_signature,
            }),
          });
          const verifyData = (await verifyRes.json().catch(() => null)) as
            | { ok?: boolean; error?: string; status?: string }
            | null;

          if (!verifyRes.ok || !verifyData?.ok) {
            flashStatus(
              "error",
              verifyData?.error
                ? `Verification failed (${verifyData.error}). Contact support if your payment was deducted.`
                : "Verification failed. Contact support if your payment was deducted."
            );
            resetToIdle();
            return;
          }

          // Signature verified. Webhook is the source of truth for the
          // actual plan activation; we surface a clear waiting state.
          setPhase("verified-waiting");
          flashStatus(
            "info",
            "Payment received. Plan activation may take a few seconds. Please refresh if it does not update."
          );
          notifyProfileUpdated();
        } catch (err) {
          flashStatus(
            "error",
            err instanceof Error
              ? err.message
              : "Network error during verification."
          );
          resetToIdle();
        }
      };

      const rzp = new window.Razorpay({
        key: validatedOrder.key_id,
        amount: validatedOrder.amount,
        currency: validatedOrder.currency || "INR",
        order_id: validatedOrder.order_id,
        webview_intent: true,
        name: "Kaun Karega",
        description:
          targetPlan === "regions_5"
            ? "5 Regions plan — 30 days"
            : "Full Jodhpur plan — 30 days",
        prefill: providerName ? { name: providerName } : undefined,
        theme: { color: "#003d20" },
        handler: (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          void verifyPayment(response);
        },
        modal: {
          ondismiss: () => {
            // Modal closed without a successful payment. Reset to idle
            // ONLY if we're still in the pre-verify window — if handler
            // already fired and verifyPayment is mid-flight (phase has
            // advanced to verifying / verified-waiting), do not regress
            // the state machine. The phaseRef gives us the latest phase
            // value here (closure-captured `phase` would be stale).
            setPhase((current) => {
              if (current !== "checkout-open") return current;
              setBusyPlan(null);
              flashStatus(
                "info",
                "Payment cancelled. You can try again any time.",
                5_000
              );
              return "idle";
            });
          },
        },
      });
      rzp.open();
    },
    [providerName, flashStatus, resetToIdle, notifyProfileUpdated]
  );

  // Phase 2 entry-point. Replaces the direct create-order call.
  // Classifies the change client-side, then routes the provider
  // through the right confirmation surface:
  //   • scheduled_paid_lower → ScheduledRegionPicker first
  //   • upgrade / renew      → PaymentTermsModal directly
  // The actual Razorpay-order POST happens only after the
  // PaymentTermsModal's `Continue to payment` button. The server
  // re-classifies authoritatively — the client classification only
  // decides which modal to show.
  const initiatePurchase = useCallback(
    (targetPlan: Exclude<PlanCode, "free">) => {
      if (phase !== "idle") return;
      if (!paymentsEnabled) {
        flashStatus(
          "error",
          "Online payment is not enabled yet. Please try again later."
        );
        return;
      }
      // Block while a paid scheduled change is already queued. Server
      // enforces this with a 409 too; the client guard keeps the
      // popups from opening at all so the provider sees a clear
      // message immediately.
      if (
        plan?.scheduledPlan &&
        plan.scheduledPlan.code !== "free" &&
        plan.scheduledPlan.code !== targetPlan
      ) {
        flashStatus(
          "error",
          "A plan change is already scheduled. You can pick a new plan after it activates."
        );
        return;
      }

      const mode = classifyPlanChange({
        currentCode: code,
        targetCode: targetPlan,
        currentActive: isActive,
      });

      setBusyPlan(targetPlan);
      setPendingTarget(targetPlan);
      setPendingMode(mode);
      setPendingRegionCodes(null);

      if (mode === "scheduled_paid_lower") {
        setPhase("picking-regions");
      } else {
        // upgrade / renew → straight to terms modal. schedule_free is
        // not reachable here (the picker click handler never invokes
        // initiatePurchase for the free card in Phase 2).
        setPhase("confirming-terms");
      }
    },
    [phase, paymentsEnabled, plan, code, isActive, flashStatus]
  );

  const handlePickerCancel = useCallback(() => {
    if (phase !== "picking-regions") return;
    resetToIdle();
    flashStatus("info", "Plan change cancelled.", 4_000);
  }, [phase, resetToIdle, flashStatus]);

  const handlePickerConfirm = useCallback(
    (codes: string[]) => {
      if (phase !== "picking-regions") return;
      setPendingRegionCodes(codes);
      setPhase("confirming-terms");
    },
    [phase]
  );

  const handleTermsCancel = useCallback(() => {
    if (phase !== "confirming-terms") return;
    resetToIdle();
    flashStatus("info", "Payment cancelled.", 4_000);
  }, [phase, resetToIdle, flashStatus]);

  const handleTermsConfirm = useCallback(() => {
    if (phase !== "confirming-terms") return;
    if (!pendingTarget) {
      resetToIdle();
      return;
    }
    void runCreateOrder(pendingTarget, pendingRegionCodes);
  }, [phase, pendingTarget, pendingRegionCodes, resetToIdle, runCreateOrder]);

  const handleManualRefresh = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.reload();
  }, []);

  const showUpgrade5 = code === "free";
  const showUpgradeAll = code !== "all_jodhpur";

  // Title pill — current plan name. Expired plans render as "Free"
  // with the expired badge; the previous-plan name is shown below
  // the pill, so the pill itself always reflects effective state.
  const pillLabel = isExpired
    ? PLAN_COPY.free.shortLabel
    : PLAN_COPY[code].shortLabel;
  const maxRegionsLabel = isExpired
    ? PLAN_COPY.free.maxRegionsLabel
    : PLAN_COPY[code].maxRegionsLabel;

  return (
    <section
      aria-label="Current plan"
      data-testid="provider-plan-card"
      className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Current Plan
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              data-testid="provider-plan-pill"
              className="inline-flex items-center rounded-full border border-[#003d20]/20 bg-[#003d20]/5 px-3 py-1 text-sm font-semibold text-[#003d20]"
            >
              {pillLabel}
            </span>
            {isActive && code !== "free" ? (
              // "Active" pill is reserved for PAID active plans only.
              // Rendering it on Free (where effectivePlan() returns
              // active:true by design) reads as "you paid for the free
              // plan" to a non-technical provider. The Free pill above
              // already communicates the state.
              <span
                data-testid="provider-plan-active-badge"
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700"
              >
                Active
              </span>
            ) : null}
            {isExpired ? (
              <span
                data-testid="provider-plan-expired-badge"
                className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700"
              >
                Expired
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mt-4 space-y-3 text-sm text-slate-700">
        {isExpired ? (
          <div
            data-testid="provider-plan-expired-banner"
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
          >
            <p className="text-sm font-semibold text-rose-900">
              Your plan expired{expiryLabel ? ` on ${expiryLabel}` : ""}.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-rose-800">
              You&rsquo;re back on the Free plan — 1 region only. Renew below
              to restore your full coverage.
            </p>
          </div>
        ) : null}

        <p className="font-medium" data-testid="provider-plan-max-regions">
          {maxRegionsLabel}
        </p>

        {isUnlimitedCoverage ? (
          <p
            data-testid="provider-plan-usage-unlimited"
            className="font-semibold text-emerald-700"
          >
            All Jodhpur regions covered
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-slate-500" data-testid="provider-plan-usage">
              You&rsquo;re using{" "}
              <span
                className={
                  usageOverflow
                    ? "font-semibold text-rose-600"
                    : usageAtCap
                      ? "font-semibold text-amber-700"
                      : "font-semibold text-slate-700"
                }
              >
                {usedRegions}
              </span>{" "}
              of {maxRegions} region{maxRegions === 1 ? "" : "s"}.
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={maxRegions}
              aria-valuenow={Math.min(usedRegions, maxRegions)}
              data-testid="provider-plan-usage-bar"
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
            >
              <div
                data-testid="provider-plan-usage-bar-fill"
                className={`h-full rounded-full transition-all ${
                  usageOverflow
                    ? "bg-rose-500"
                    : usageAtCap
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        )}

        {isExpired && code !== "free" ? (
          <p className="text-rose-600" data-testid="provider-plan-expired-hint">
            Previously: {PLAN_COPY[code].label}
            {expiryLabel ? ` — expired ${expiryLabel}` : ""}. Now running as Free.
          </p>
        ) : null}
        {plan?.scheduledPlan && plan.scheduledPlan.code !== "free" ? (
          // Phase 2: paid-scheduled-lower banner. The provider sees this
          // immediately after a successful payment for the scheduled
          // plan; their current plan continues until expiry. No cancel
          // button — scheduled paid plans are locked and non-refundable
          // by business rule. Phase 3 will add a region-edit affordance.
          <div
            data-testid="provider-plan-scheduled-banner"
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <p className="text-sm font-semibold text-amber-900">
              Your {asKnownPlanCode(plan.scheduledPlan.code) === "regions_5"
                ? "₹31"
                : asKnownPlanCode(plan.scheduledPlan.code) === "all_jodhpur"
                  ? "₹101"
                  : ""}{" "}
              plan is scheduled for next cycle.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              Your current plan continues until expiry
              {formatExpiryDate(plan.scheduledPlan.activatesAt)
                ? ` (${formatExpiryDate(plan.scheduledPlan.activatesAt)})`
                : ""}
              . This scheduled plan is locked and non-refundable.
            </p>
          </div>
        ) : null}
        {isActive && hasExpiryHint && code !== "free" ? (
          <p className="text-slate-500" data-testid="provider-plan-expiry">
            Renews / Expires on {expiryLabel || "—"}
          </p>
        ) : null}
      </div>

      {showUpgrade5 || showUpgradeAll ? (
        !paymentsEnabled ? (
          <div
            data-testid="provider-plan-payments-disabled"
            className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
          >
            <p className="font-semibold text-slate-700">
              Online payment is not enabled yet.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              We&rsquo;re finalising the payment gateway. Your free plan
              continues to work. We&rsquo;ll let you know when paid plans
              go live.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {showUpgrade5 ? (
              <button
                type="button"
                data-testid="provider-plan-upgrade-regions-5"
                disabled={isUpgradeBusy}
                onClick={() => {
                  initiatePurchase("regions_5");
                }}
                className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
              >
                {busyPlan === "regions_5" && phase === "creating-order"
                  ? "Creating order…"
                  : busyPlan === "regions_5" && phase !== "idle"
                    ? "Processing…"
                    : isExpired
                      ? `${CTA_LABEL_PAID_RENEW} — ₹31`
                      : `${CTA_LABEL_PAID_CHOOSE} — ₹31`}
              </button>
            ) : null}
            {showUpgradeAll ? (
              <button
                type="button"
                data-testid="provider-plan-upgrade-all-jodhpur"
                disabled={isUpgradeBusy}
                onClick={() => {
                  initiatePurchase("all_jodhpur");
                }}
                className="inline-flex items-center justify-center rounded-xl border border-[#003d20] bg-white px-4 py-2.5 text-sm font-semibold text-[#003d20] shadow-sm transition hover:bg-[#003d20] hover:text-white active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
              >
                {busyPlan === "all_jodhpur" && phase === "creating-order"
                  ? "Creating order…"
                  : busyPlan === "all_jodhpur" && phase !== "idle"
                    ? "Processing…"
                    : isExpired
                      ? `${CTA_LABEL_PAID_RENEW} — ₹101`
                      : `${CTA_LABEL_PAID_CHOOSE} — ₹101`}
              </button>
            ) : null}
          </div>
        )
      ) : null}

      {/* Multi-stage status banner. The phase-driven copy gives the user
          a clear narration of where they are in the Razorpay-first flow.
          Verified-waiting also exposes a manual "Refresh now" button
          because the webhook is the source of truth — the dashboard
          page does not auto-poll, so the user decides when to pull
          fresh state. */}
      {statusMessage ? (
        <div
          role={statusMessage.kind === "error" ? "alert" : "status"}
          data-testid="provider-plan-status"
          data-status-kind={statusMessage.kind}
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            statusMessage.kind === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : statusMessage.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-sky-200 bg-sky-50 text-sky-800"
          }`}
        >
          <p>{statusMessage.text}</p>
          {phase === "verified-waiting" ? (
            <button
              type="button"
              data-testid="provider-plan-refresh-now"
              onClick={handleManualRefresh}
              className="mt-2 inline-flex items-center justify-center rounded-md border border-[#003d20] bg-white px-3 py-1.5 text-xs font-semibold text-[#003d20] transition hover:bg-[#003d20] hover:text-white"
            >
              Refresh now
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 border-t border-slate-200 pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
          Compare plans
        </p>
        <p
          data-testid="provider-plan-why-upgrade"
          className="mt-2 text-sm text-slate-600"
        >
          {whyUpgradeCopy}
        </p>

        <div
          data-testid="provider-plan-comparison"
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {PLAN_COMPARISON.map((entry) => {
            const isCurrent = effectiveCode === entry.code;
            const isCurrentAllJodhpur =
              isCurrent && entry.code === "all_jodhpur";
            const showPopularBadge =
              entry.popular === true &&
              effectiveCode !== "all_jodhpur" &&
              !isCurrent;
            const isFree = entry.code === "free";
            const busyOnThis = busyPlan === entry.code;
            // Wording rules per the Phase 1 product spec — see the
            // CTA_LABEL_* constants above for the source of truth.
            // Note: when the previous paid plan has expired, the
            // current effective code collapses to "free" → isCurrent
            // is true for the free card only, and the paid cards
            // fall through to the `isExpired` branch as renewals.
            const ctaLabel = isCurrent
              ? CTA_LABEL_YOUR_PLAN
              : isFree
                ? CTA_LABEL_FREE_CHOOSE
                : isExpired
                  ? CTA_LABEL_PAID_RENEW
                  : CTA_LABEL_PAID_CHOOSE;
            return (
              <div
                key={entry.code}
                data-testid={`provider-plan-compare-${entry.code}`}
                data-current={isCurrent ? "true" : "false"}
                data-visual-emphasis={isCurrentAllJodhpur ? "strong" : "normal"}
                className={`relative flex flex-col rounded-2xl border p-4 ${
                  isCurrentAllJodhpur
                    ? "border-emerald-700 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-100"
                    : isCurrent
                      ? "border-[#003d20] bg-[#003d20]/5"
                    : "border-slate-200 bg-white"
                }`}
              >
                {showPopularBadge ? (
                  <span
                    data-testid="provider-plan-compare-popular-badge"
                    className="absolute -top-2 right-3 inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
                  >
                    Most Popular
                  </span>
                ) : null}
                {isCurrent ? (
                  <span
                    data-testid={`provider-plan-compare-current-badge-${entry.code}`}
                    className="absolute -top-2 left-3 inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
                  >
                    Your plan
                  </span>
                ) : null}
                <p
                  data-testid={`provider-plan-compare-title-${entry.code}`}
                  className={
                    isCurrentAllJodhpur
                      ? "text-base font-bold text-slate-950"
                      : "text-sm font-semibold text-[#003d20]"
                  }
                >
                  {entry.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">{entry.subLabel}</p>
                <p
                  className={`mt-2 text-xs italic ${
                    isCurrentAllJodhpur
                      ? "font-semibold text-emerald-800"
                      : "text-slate-600"
                  }`}
                >
                  {entry.positioning}
                </p>
                <ul className="mt-3 flex-1 space-y-1 text-xs text-slate-600">
                  {entry.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-1.5">
                      <span aria-hidden="true" className="text-emerald-600">
                        ✓
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isFree ? (
                    // Phase 1: Free card CTA is wording-only. The
                    // "Choose this plan" copy is the future Free-
                    // scheduling action (Phase 2 wires it). Button
                    // stays disabled in Phase 1 — no action is
                    // available yet for switching to Free from a paid
                    // plan, and selecting Free while already on Free
                    // is a no-op.
                    <button
                      type="button"
                      disabled
                      data-testid={`provider-plan-compare-cta-${entry.code}`}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500"
                    >
                      {isCurrent ? CTA_LABEL_YOUR_PLAN : CTA_LABEL_FREE_CHOOSE}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`provider-plan-compare-cta-${entry.code}`}
                      disabled={
                        isCurrent || isUpgradeBusy || !paymentsEnabled
                      }
                      onClick={() => {
                        if (entry.code === "free") return;
                        initiatePurchase(entry.code);
                      }}
                      title={
                        !paymentsEnabled
                          ? "Online payment is not enabled yet."
                          : undefined
                      }
                      className={`inline-flex w-full items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${
                        isCurrent
                          ? "border border-[#003d20] bg-white text-[#003d20]"
                          : "bg-[#003d20] text-white hover:bg-[#002a16]"
                      }`}
                    >
                      {busyOnThis && phase === "creating-order"
                        ? "Creating order…"
                        : busyOnThis && phase !== "idle"
                          ? "Processing…"
                          : !paymentsEnabled
                            ? "Coming soon"
                            : ctaLabel}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase 2: scheduled-paid-lower picker. Conditionally mounted so
          its internal state resets cleanly on every new attempt. */}
      {phase === "picking-regions" && pendingTarget ? (
        <ScheduledRegionPicker
          requiredCount={PLAN_REQUIRED_REGIONS[pendingTarget]}
          targetPlanLabel={PLAN_SHORT_LABEL[pendingTarget]}
          cityCode={null}
          onCancel={handlePickerCancel}
          onConfirm={handlePickerConfirm}
        />
      ) : null}

      {/* Phase 2: payment terms confirmation. Conditionally mounted so
          the checkbox state resets cleanly on every new attempt. */}
      {phase === "confirming-terms" && pendingTarget ? (
        <PaymentTermsModal
          amountLabel={PLAN_PRICE_LABEL[pendingTarget]}
          intent={
            pendingMode === "scheduled_paid_lower"
              ? "schedule"
              : pendingMode === "immediate_renewal"
                ? "renew"
                : "choose"
          }
          onCancel={handleTermsCancel}
          onConfirm={handleTermsConfirm}
        />
      ) : null}
    </section>
  );
}
