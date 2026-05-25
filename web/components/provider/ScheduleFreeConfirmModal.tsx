"use client";

import { useEffect, useId } from "react";

/**
 * Phase 3.2A: confirmation modal for the paid → Free scheduling flow.
 *
 * Shown ONLY when a provider on an active paid plan picks the Free
 * card AND no scheduled plan blocks the action. There is no payment
 * involved — Free scheduling is a state transition queued for the
 * provider's current_period_end. The modal exists so the change is
 * explicit (one extra confirm tap) and so the provider sees the
 * consequences (oldest region kept; can change after activation)
 * before they trigger the server call.
 *
 * Deliberate differences from PaymentTermsModal:
 *   - No payment-terms checkbox. There is no payment to consent to;
 *     the three non-refundable/listing/no-earnings disclosures from
 *     PaymentTermsModal do not apply to a no-money transition.
 *   - Confirm button is enabled on mount (no gating state).
 *   - Wording uses "next cycle" / "after expiry" — never "downgrade".
 *
 * Lifecycle: the parent (ProviderPlanCard) mounts the modal
 * conditionally when phase === "confirming-free". Local state is none
 * — the only interactive element is the Confirm button. Escape and
 * backdrop click both cancel, matching PaymentTermsModal's pattern.
 */

export type ScheduleFreeConfirmModalProps = {
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Pre-formatted human-readable expiry date of the provider's current
   * paid plan (e.g. "25 Jun 2026"). Falls back to "its expiry date" if
   * empty. Formatted by the parent for consistency with the dashboard
   * banner copy.
   */
  currentPeriodEndLabel: string;
  /**
   * Disables both buttons while the parent is mid-flight (the POST to
   * /api/provider/plan/schedule-free is in flight after Confirm).
   */
  busy?: boolean;
};

export default function ScheduleFreeConfirmModal({
  onCancel,
  onConfirm,
  currentPeriodEndLabel,
  busy = false,
}: ScheduleFreeConfirmModalProps) {
  const titleId = useId();

  // Escape closes the modal (treats as cancel). Wired only while the
  // component is mounted; the parent unmounts us on Cancel / Confirm.
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
      data-testid="schedule-free-confirm-modal"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/60 px-3 pb-6 pt-10 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(e) => {
        // Click on the backdrop (not the inner card) cancels. Matches
        // PaymentTermsModal's behaviour so providers learn one pattern.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
        data-testid="schedule-free-confirm-card"
      >
        <header className="border-b border-slate-200 px-5 py-4">
          <p
            id={titleId}
            className="text-base font-semibold text-slate-900"
            data-testid="schedule-free-confirm-title"
          >
            Choose Free plan for next cycle?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            No payment is required. Here&rsquo;s what happens next:
          </p>
        </header>

        <div className="space-y-3 px-5 py-4 text-sm text-slate-700">
          <ul
            data-testid="schedule-free-confirm-bullets"
            className="space-y-2 text-xs leading-relaxed"
          >
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                ✓
              </span>
              <span>
                Your current paid plan continues until{" "}
                <strong>{currentPeriodEndLabel || "its expiry date"}</strong>.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                ✓
              </span>
              <span>
                Your <strong>Free plan</strong> starts automatically after
                that.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                ✓
              </span>
              <span>
                We&rsquo;ll keep your{" "}
                <strong>oldest registered region</strong> as your Free-plan
                region.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                ✓
              </span>
              <span>
                You can change your Free region anytime after it becomes
                active.
              </span>
            </li>
          </ul>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid="schedule-free-confirm-cancel"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="schedule-free-confirm-continue"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Scheduling…" : "Confirm Free plan"}
          </button>
        </footer>
      </div>
    </div>
  );
}
