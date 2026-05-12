"use client";

import { useEffect } from "react";
import { DISCLAIMER_TEXT } from "@/lib/disclaimer";

// WhatsApp-style scrollable disclaimer card. Dumb component — owns no
// data, no fetches, no acceptance state. The host page passes `open`,
// `mode`, and the two callbacks; the host also owns the network call to
// /api/user/disclaimer and the localStorage write. Phase 2 keeps the
// architecture deliberately simple: no global modal manager, no context
// provider, no hook. Pure props in, pure events out.
//
// Modes:
//   - "soft"     → both Later and "I Understand & Continue" rendered.
//                  Triggered ~800–1200 ms after homepage mount when the
//                  user is logged in and disclaimer is not fresh.
//   - "blocking" → only "I Understand & Continue" is rendered. Triggered
//                  on submit attempt (client pre-flight) or on the silent
//                  403 DISCLAIMER_REQUIRED path from /api/submit-request.
//
// max-h-[80vh] + overflow-y-auto live on the body container (where the
// scrollable text sits) per the Phase 2 UX rule.

type Props = {
  open: boolean;
  mode: "soft" | "blocking";
  onAccept: () => void;
  onDismiss: () => void;
  isAccepting?: boolean;
  acceptError?: string | null;
};

export default function UserDisclaimerModal({
  open,
  mode,
  onAccept,
  onDismiss,
  isAccepting = false,
  acceptError = null,
}: Props) {
  // Body-scroll lock while the modal is open. Restores the original
  // overflow value on close so a parent that sets its own overflow
  // (rare but possible) is not clobbered.
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

  const isBlocking = mode === "blocking";
  const paragraphs = DISCLAIMER_TEXT.split(/\n\n+/);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kk-disclaimer-title"
      data-testid="kk-disclaimer-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 py-6"
    >
      <div className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 pt-5 pb-4">
          <h2
            id="kk-disclaimer-title"
            className="text-lg font-bold tracking-tight text-[#003d20]"
          >
            Disclaimer &amp; Important Notice
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Please read this short note about how Kaun Karega works.
          </p>
        </div>
        <div
          data-testid="kk-disclaimer-body"
          className="max-h-[80vh] overflow-y-auto px-5 py-4 text-sm leading-6 text-slate-700"
        >
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-3 last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>
        {acceptError && (
          <p className="mx-5 mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {acceptError}
          </p>
        )}
        {/* Mobile: stacked, full-width buttons so the touch target spans
            the modal width and the labels render crisply at min-44px
            height. Desktop (≥sm): inline-right with the original gap. */}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {!isBlocking && (
            <button
              type="button"
              onClick={onDismiss}
              disabled={isAccepting}
              data-testid="kk-disclaimer-later"
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
            >
              Later
            </button>
          )}
          <button
            type="button"
            onClick={onAccept}
            disabled={isAccepting}
            autoFocus
            data-testid="kk-disclaimer-accept"
            className="w-full rounded-lg bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a15] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isAccepting ? "Saving…" : "I Understand & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
