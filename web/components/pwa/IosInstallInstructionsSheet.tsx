"use client";

import { useEffect } from "react";
import { X, Compass, Share, Plus, Check } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * iOS Safari "Add to Home Screen" guided coachmark.
 *
 * Used by:
 *   - InstallAppMenuRow (when iOS) on EXPLICIT click of the menu row
 *   - InstallAppPromptCard (when iOS) on EXPLICIT click of the card's
 *     install button
 *
 * iOS Safari does not expose a programmatic install API — websites
 * cannot open the Add-to-Home-Screen popup directly. This sheet
 * teaches the user the manual Share → Add-to-Home-Screen flow.
 *
 * MUST NOT auto-open. Only opens when `open` flips to true via a
 * parent's user-initiated click handler. There is no useEffect that
 * sets open in this file; the parent owns the open state.
 *
 * Closing the sheet is a UI dismissal only — it does NOT set the
 * 7-day cooldown. That belongs to the prompt card's "Not now".
 */
export default function IosInstallInstructionsSheet({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-slate-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add Kaun Karega to your Home Screen"
        data-testid="ios-install-instructions"
        className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.18)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-[#003d20]">
            Add Kaun Karega to Home Screen
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close instructions"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-[#003d20]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <p className="mb-4 text-sm text-slate-600">
            iPhone does not let websites open the Add to Home Screen popup
            directly. Follow these four steps in Safari.
          </p>
          <ol className="space-y-4 text-sm text-slate-700">
            <li
              data-testid="ios-install-step-safari"
              className="flex items-start gap-3"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-white">
                <Compass className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <strong>Open</strong> kaunkarega.com in{" "}
                <strong>Safari</strong> if you are currently in Chrome,
                WhatsApp, Instagram, or another in-app browser.
              </span>
            </li>
            <li
              data-testid="ios-install-step-share"
              className="flex items-start gap-3"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-white">
                <Share className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                Tap the <strong>Share</strong> button in Safari.
              </span>
            </li>
            <li
              data-testid="ios-install-step-add-to-home-screen"
              className="flex items-start gap-3"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-white">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                Scroll and tap <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li
              data-testid="ios-install-step-add"
              className="flex items-start gap-3"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-white">
                <Check className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                Tap <strong>Add</strong> in the top-right corner.
              </span>
            </li>
          </ol>
          <p
            data-testid="ios-install-footer"
            className="mt-5 text-xs text-slate-500"
          >
            After adding, open Kaun Karega from your phone home screen.
          </p>
          <button
            type="button"
            onClick={onClose}
            data-testid="ios-install-instructions-close"
            className="mt-6 w-full rounded-lg bg-[#003d20] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00542b]"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
