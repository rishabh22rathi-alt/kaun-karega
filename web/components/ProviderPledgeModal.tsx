"use client";

import { useEffect } from "react";
import { PROVIDER_PLEDGE_TEXT } from "@/lib/disclaimer";

// Provider Responsibility Pledge — single scrollable card. Mirrors the
// shape of UserDisclaimerModal so the platform feels consistent: rounded
// card, body-scroll lock while open, max-h-[80vh] body, soft KK palette.
//
// Always blocking-style — no soft mode, no Later button. Provider must
// either Accept & Continue or close (X) to back out. The host page owns
// network calls (POST /api/provider/pledge), state, and the queued
// chat-action retry. No internal data, no fetches, no localStorage —
// pledge state is server-only per Phase 2 design decision.

type Props = {
  open: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  isAccepting?: boolean;
  acceptError?: string | null;
};

export default function ProviderPledgeModal({
  open,
  onAccept,
  onDismiss,
  isAccepting = false,
  acceptError = null,
}: Props) {
  // Body-scroll lock while open. Restores the previous overflow value
  // on close so other modals that mount alongside don't get clobbered.
  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const paragraphs = PROVIDER_PLEDGE_TEXT.split(/\n\n+/);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kk-provider-pledge-title"
      data-testid="kk-provider-pledge-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 py-6"
    >
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onDismiss}
          disabled={isAccepting}
          aria-label="Close pledge"
          data-testid="kk-pledge-dismiss"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
        >
          ×
        </button>

        <div className="border-b border-slate-100 px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base">🤝</span>
            <h2
              id="kk-provider-pledge-title"
              className="text-lg font-bold tracking-tight text-[#003d20]"
            >
              Provider Responsibility Pledge
            </h2>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Quick read &mdash; under a minute.
          </p>
        </div>

        <div
          data-testid="kk-pledge-body"
          className="max-h-[80vh] overflow-y-auto bg-gradient-to-br from-orange-50/40 to-green-50/40 px-5 py-4"
        >
          <div className="rounded-xl border border-white/60 bg-white p-4 text-sm leading-6 text-slate-700">
            {paragraphs.map((paragraph, idx) => (
              <p
                key={idx}
                className={`mb-3 last:mb-0 ${
                  idx === 0 ? "font-semibold text-slate-800" : ""
                }`}
              >
                {paragraph}
              </p>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            This helps keep Kaun Karega safe and trustworthy for everyone.
          </p>
        </div>

        {acceptError && (
          <p className="mx-5 mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {acceptError}
          </p>
        )}

        {/* Mobile: full-width accept button so the touch target spans
            the modal width and renders crisply. Desktop (≥sm): inline-
            right with the original gap. */}
        <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onAccept}
            disabled={isAccepting}
            autoFocus
            data-testid="kk-pledge-accept"
            className="w-full rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isAccepting ? "Saving…" : "Accept & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
