"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Phase 2: reusable payment-terms confirmation modal.
 *
 * Mounted by ProviderPlanCard before every paid Razorpay checkout
 * (upgrade, renewal, scheduled-paid-lower). NOT shown for free-plan
 * actions. The continue button is disabled until the checkbox is
 * checked — the parent receives onConfirm only after explicit consent.
 *
 * The three required disclosures (non-refundable / listing platform /
 * no earnings guarantee) live in this component so the wording is
 * versioned in one place. Future changes should bump a copy version
 * stamp and we should record agreed_terms_at on payment_orders to
 * keep an audit trail per order (already wired in Phase 2).
 *
 * Lifecycle: the parent conditionally mounts this component when the
 * provider is in the confirming-terms phase. State (the checkbox)
 * lives locally and resets naturally on remount, so we don't need an
 * `open` prop or a reset effect. Closing happens by calling
 * `onCancel` or `onConfirm`; the parent then unmounts us.
 *
 * Keyboard: Escape closes (treats as cancel). Focus is trapped to the
 * checkbox on mount via autoFocus.
 */

export type PaymentTermsModalProps = {
  onCancel: () => void;
  onConfirm: () => void;
  // Pricing context shown to the user so the modal is self-explanatory
  // without the surrounding card context. e.g. "₹31" or "₹101".
  amountLabel: string;
  // Phase A: GST-exclusive pricing. When provided, the modal shows a
  // base / GST / total-payable receipt so the provider sees exactly
  // what Razorpay will charge (base + 18% GST) before paying. Labels
  // are pre-formatted rupee strings (e.g. "₹31.00", "₹5.58", "₹36.58").
  priceBreakdown?: {
    baseLabel: string;
    gstLabel: string;
    totalLabel: string;
    gstBps: number;
  };
  // One of "choose" (paid select / upgrade), "renew" (paid renewal),
  // "schedule" (scheduled paid lower). Selects friendly headline copy.
  intent: "choose" | "renew" | "schedule";
  // Disables both buttons while the parent is mid-flight (e.g. the
  // create-order POST is in flight after the user clicked continue).
  busy?: boolean;
};

const TITLE_BY_INTENT: Record<PaymentTermsModalProps["intent"], string> = {
  choose: "Before you pay",
  renew: "Before you renew",
  schedule: "Before you pay",
};

const SUBTITLE_BY_INTENT: Record<PaymentTermsModalProps["intent"], string> = {
  choose:
    "Quick check before we open the payment window. Please confirm you understand the terms.",
  renew:
    "Quick check before we open the payment window. Please confirm you understand the terms.",
  schedule:
    "Your current plan continues until expiry. This payment queues your next plan. Please confirm before we open the payment window.",
};

export default function PaymentTermsModal({
  onCancel,
  onConfirm,
  amountLabel,
  priceBreakdown,
  intent,
  busy = false,
}: PaymentTermsModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const checkboxId = useId();

  // Mount-time focus + Escape listener. No setState in these effects;
  // the confirmed-state resets on remount because the parent unmounts
  // and re-mounts us between attempts.
  useEffect(() => {
    const id = window.setTimeout(() => {
      checkboxRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="payment-terms-modal"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 px-3 pb-6 pt-10 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(e) => {
        // Click on the backdrop (not the inner card) cancels. This
        // matches the Razorpay modal's own dismiss behaviour and avoids
        // trapping providers if they accidentally open the popup.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
        data-testid="payment-terms-modal-card"
      >
        <header className="border-b border-slate-200 px-5 py-4">
          <p
            id={titleId}
            className="text-base font-semibold text-slate-900"
            data-testid="payment-terms-title"
          >
            {TITLE_BY_INTENT[intent]}
            <span className="ml-2 inline-flex items-center rounded-full bg-[#003d20]/10 px-2 py-0.5 text-xs font-semibold text-[#003d20]">
              {amountLabel}
            </span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {SUBTITLE_BY_INTENT[intent]}
          </p>
        </header>

        <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
          {priceBreakdown ? (
            // Phase A: GST-exclusive receipt. Shows base + GST = total
            // payable so the provider sees exactly what Razorpay charges
            // before the payment window opens.
            <div
              data-testid="payment-terms-price"
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs"
            >
              <div className="flex items-center justify-between py-0.5">
                <span className="text-slate-600">Plan price</span>
                <span
                  data-testid="payment-terms-base"
                  className="font-medium text-slate-800"
                >
                  {priceBreakdown.baseLabel}
                </span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-slate-600">
                  GST ({Math.round(priceBreakdown.gstBps / 100)}%)
                </span>
                <span
                  data-testid="payment-terms-gst"
                  className="font-medium text-slate-800"
                >
                  {priceBreakdown.gstLabel}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1.5">
                <span className="font-semibold text-slate-900">
                  Total payable
                </span>
                <span
                  data-testid="payment-terms-total"
                  className="text-sm font-bold text-[#003d20]"
                >
                  {priceBreakdown.totalLabel}
                </span>
              </div>
            </div>
          ) : null}

          <ul
            data-testid="payment-terms-bullets"
            className="space-y-2 text-xs leading-relaxed"
          >
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-amber-600">
                ⚠
              </span>
              <span>
                The amount once paid is <strong>non-refundable</strong>.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-amber-600">
                ⚠
              </span>
              <span>
                Kaun Karega is a <strong>listing and service discovery</strong>{" "}
                platform. You are paying for listing, visibility, and coverage
                access.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-amber-600">
                ⚠
              </span>
              <span>
                We do <strong>not guarantee</strong> leads, jobs, income, or
                confirmed work. Outcomes depend on customer demand and your own
                service quality.
              </span>
            </li>
          </ul>

          <label
            htmlFor={checkboxId}
            className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-700 hover:bg-slate-100"
          >
            <input
              ref={checkboxRef}
              id={checkboxId}
              type="checkbox"
              data-testid="payment-terms-checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#003d20]"
            />
            <span>
              I&rsquo;ve read and understood the points above. I&rsquo;m paying
              for listing access only.
            </span>
          </label>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid="payment-terms-cancel"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="payment-terms-continue"
            disabled={!confirmed || busy}
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Opening payment…" : "Continue to payment"}
          </button>
        </footer>
      </div>
    </div>
  );
}
