"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";

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

export type ProviderPlanShape = {
  code: string;
  maxRegions: number;
  currentPeriodEnd: string | null;
  active: boolean;
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

const PLAN_COPY: Record<PlanCode, PlanCopy> = {
  free: {
    label: "Free",
    shortLabel: "Free",
    maxRegionsLabel: "1 Region Included",
  },
  regions_5: {
    label: "₹31 / 5 Regions",
    shortLabel: "₹31 Plan",
    maxRegionsLabel: "5 Regions Allowed",
  },
  all_jodhpur: {
    label: "₹101 / Full Jodhpur",
    shortLabel: "₹101 Plan",
    maxRegionsLabel: "Full Jodhpur Coverage",
  },
};

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

export default function ProviderPlanCard({
  plan,
  currentRegionsCount,
  providerName,
}: ProviderPlanCardProps) {
  const [busyPlan, setBusyPlan] = useState<PlanCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const refreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

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

  const scheduleDashboardRefresh = useCallback(() => {
    if (typeof window === "undefined") return;
    const dispatch = () =>
      window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
    // Fire once immediately, once at ~5s to catch the webhook arrival.
    dispatch();
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      dispatch();
      refreshTimeoutRef.current = null;
    }, 5_000);
  }, []);

  const handleUpgrade = useCallback(
    async (targetPlan: Exclude<PlanCode, "free">) => {
      if (busyPlan) return;
      setBusyPlan(targetPlan);
      setErrorMessage("");
      try {
        const orderRes = await fetch("/api/payments/create-order", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan_code: targetPlan }),
        });

        if (orderRes.status === 503) {
          setErrorMessage("Payments are not enabled yet. Please try again soon.");
          return;
        }
        if (orderRes.status === 401) {
          setErrorMessage("Please log in again to continue.");
          return;
        }
        if (orderRes.status === 403) {
          setErrorMessage("Only registered providers can upgrade a plan.");
          return;
        }

        const orderData = (await orderRes.json().catch(() => null)) as
          | {
              ok?: boolean;
              order_id?: string;
              key_id?: string;
              amount?: number;
              currency?: string;
              error?: string;
            }
          | null;

        if (!orderRes.ok || !orderData?.ok || !orderData.order_id || !orderData.key_id) {
          setErrorMessage(
            orderData?.error
              ? `Unable to start checkout (${orderData.error}).`
              : "Unable to start checkout. Please try again."
          );
          return;
        }

        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded || !window.Razorpay) {
          setErrorMessage("Could not load Razorpay. Check your connection and try again.");
          return;
        }

        const rzp = new window.Razorpay({
          key: orderData.key_id,
          amount: orderData.amount,
          currency: orderData.currency || "INR",
          order_id: orderData.order_id,
          name: "Kaun Karega",
          description:
            targetPlan === "regions_5"
              ? "5 Regions plan — 30 days"
              : "Full Jodhpur plan — 30 days",
          prefill: providerName ? { name: providerName } : undefined,
          theme: { color: "#003d20" },
          handler: () => {
            // Webhook is the source of truth. Fire dashboard refresh
            // shortly so the new Plan state hydrates once the
            // webhook lands.
            scheduleDashboardRefresh();
          },
          modal: {
            ondismiss: () => {
              // No state change on dismiss — user can retry.
            },
          },
        });
        rzp.open();
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Something went wrong. Please try again."
        );
      } finally {
        setBusyPlan(null);
      }
    },
    [busyPlan, providerName, scheduleDashboardRefresh]
  );

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
            {isActive ? (
              <span
                data-testid="provider-plan-active-badge"
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700"
              >
                Active
              </span>
            ) : (
              <span
                data-testid="provider-plan-expired-badge"
                className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700"
              >
                Expired
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mt-4 space-y-1 text-sm text-slate-700">
        <p className="font-medium" data-testid="provider-plan-max-regions">
          {maxRegionsLabel}
        </p>
        <p className="text-slate-500" data-testid="provider-plan-usage">
          You&rsquo;re using{" "}
          <span className={usageOverflow ? "font-semibold text-rose-600" : "font-semibold text-slate-700"}>
            {usedRegions}
          </span>{" "}
          of {maxRegions} region{maxRegions === 1 ? "" : "s"}.
        </p>
        {isExpired && code !== "free" ? (
          <p className="text-rose-600" data-testid="provider-plan-expired-hint">
            Previously: {PLAN_COPY[code].label}
            {expiryLabel ? ` — expired ${expiryLabel}` : ""}. Now running as Free.
          </p>
        ) : null}
        {isActive && hasExpiryHint && code !== "free" ? (
          <p className="text-slate-500" data-testid="provider-plan-expiry">
            Renews / Expires on {expiryLabel || "—"}
          </p>
        ) : null}
        {isActive && code === "free" ? (
          <p className="text-slate-500">
            Upgrade your plan to expand your service coverage.
          </p>
        ) : null}
      </div>

      {showUpgrade5 || showUpgradeAll ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {showUpgrade5 ? (
            <button
              type="button"
              data-testid="provider-plan-upgrade-regions-5"
              disabled={busyPlan !== null}
              onClick={() => {
                void handleUpgrade("regions_5");
              }}
              className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
            >
              {busyPlan === "regions_5"
                ? "Opening checkout…"
                : isExpired
                  ? "Renew ₹31 / 5 Regions"
                  : "Upgrade to 5 Regions — ₹31"}
            </button>
          ) : null}
          {showUpgradeAll ? (
            <button
              type="button"
              data-testid="provider-plan-upgrade-all-jodhpur"
              disabled={busyPlan !== null}
              onClick={() => {
                void handleUpgrade("all_jodhpur");
              }}
              className="inline-flex items-center justify-center rounded-xl border border-[#003d20] bg-white px-4 py-2.5 text-sm font-semibold text-[#003d20] shadow-sm transition hover:bg-[#003d20] hover:text-white active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
            >
              {busyPlan === "all_jodhpur"
                ? "Opening checkout…"
                : isExpired
                  ? "Upgrade to Full Jodhpur — ₹101"
                  : "Upgrade to Full Jodhpur — ₹101"}
            </button>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p
          role="alert"
          data-testid="provider-plan-error"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
