"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * iOS Safari "Add to Home Screen" instruction sheet.
 *
 * Used by InstallAppMenuRow (when iOS) and InstallAppPromptCard (when
 * iOS) since iOS Safari does not expose a programmatic install API —
 * the user must manually trigger Add-to-Home-Screen from the Share
 * sheet. This sheet just teaches them how.
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
        className="fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.18)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-[#003d20]">
            Add Kaun Karega to your Home Screen
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
        <div className="px-4 py-5">
          <ol className="space-y-4 text-sm text-slate-700">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                1
              </span>
              <span>
                Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                2
              </span>
              <span>
                Scroll and tap <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                3
              </span>
              <span>
                Tap <strong>Add</strong> in the top-right corner.
              </span>
            </li>
          </ol>
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
