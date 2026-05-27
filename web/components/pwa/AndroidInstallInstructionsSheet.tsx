"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Fallback "Install Kaun Karega" instructions for Android / desktop
 * browsers where Chrome has NOT fired (or has already consumed) the
 * `beforeinstallprompt` event.
 *
 * Used by InstallAppMenuRow when neither iOS Safari nor a captured
 * deferred prompt is available — without this sheet, the menu row
 * would either be hidden (worse: no install affordance discoverable)
 * or click-but-do-nothing (worse still). The sheet teaches the user
 * the browser-driven manual install path.
 *
 * Closing the sheet is a UI dismissal only — it does NOT set the
 * 7-day cooldown. That belongs to the prompt card's "Not now".
 */
export default function AndroidInstallInstructionsSheet({
  open,
  onClose,
}: Props) {
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
        aria-label="Install Kaun Karega from your browser menu"
        data-testid="android-install-instructions"
        className="fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.18)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-[#003d20]">
            Install Kaun Karega App
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
          <p className="mb-4 text-sm text-slate-600">
            Your browser hasn&apos;t offered an automatic install option
            yet. You can still add Kaun Karega to your phone in a few
            taps.
          </p>
          <ol className="space-y-4 text-sm text-slate-700">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                1
              </span>
              <span>
                Open <strong>kaunkarega.com</strong> in <strong>Chrome</strong>
                {" "}on your Android phone.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                2
              </span>
              <span>
                Tap the <strong>⋮</strong> menu in the top-right corner.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                3
              </span>
              <span>
                Choose <strong>Install app</strong> (or{" "}
                <strong>Add to Home screen</strong> on older Chrome).
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#003d20] text-xs font-bold text-white">
                4
              </span>
              <span>
                Tap <strong>Install</strong> to confirm. The app icon will
                appear on your home screen.
              </span>
            </li>
          </ol>
          <button
            type="button"
            onClick={onClose}
            data-testid="android-install-instructions-close"
            className="mt-6 w-full rounded-lg bg-[#003d20] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00542b]"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
