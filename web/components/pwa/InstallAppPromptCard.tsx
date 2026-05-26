"use client";

import { useState } from "react";
import { Smartphone } from "lucide-react";
import { usePwaInstall } from "@/lib/usePwaInstall";
import IosInstallInstructionsSheet from "./IosInstallInstructionsSheet";

type Props = {
  /**
   * Optional per-surface localStorage key. When set, dismissing the
   * card on this surface also writes `<oncePerKey> = "yes"` so the
   * card does NOT re-appear on the same surface even within the
   * global 7-day cooldown window. Useful for surfaces a user visits
   * repeatedly (e.g. provider dashboard) where one dismissal should
   * silence the card on that surface permanently.
   *
   * Surfaces visited transiently (e.g. /success after submitting a
   * request) usually omit this — the global 7-day cooldown is enough.
   */
  oncePerKey?: string;
};

/**
 * Soft "Add to Home Screen" reminder card.
 *
 * Render on HIGH-INTENT surfaces only: post-action success pages,
 * post-login dashboards. NEVER render on the homepage, /admin/*,
 * chat threads, payment/login flows.
 *
 * Visibility gate:
 *   - hidden if installed (display-mode / navigator.standalone /
 *     kk_pwa_installed flag — usePwaInstall handles)
 *   - hidden if unsupported (neither captured beforeinstallprompt nor
 *     iOS Safari)
 *   - hidden if dismissed within the last 7 days
 *   - hidden if oncePerKey is set and previously dismissed
 *
 * On Android Chromium tap: triggers prompt(). On accepted/dismissed,
 * the hook flips canPromptAndroid → card auto-hides until next page
 * load (when the browser may re-fire beforeinstallprompt).
 *
 * On iOS Safari tap: opens the manual instructions sheet.
 */
export default function InstallAppPromptCard({ oncePerKey }: Props = {}) {
  const { shouldShowReminder, isIosSafari, promptInstall, dismiss } =
    usePwaInstall();
  const [iosSheetOpen, setIosSheetOpen] = useState(false);
  // Per-surface "already dismissed here" flag — read once on mount so
  // a dismiss earlier this session sticks for the lifetime of this
  // tab even if the global cooldown is later cleared.
  const [perSurfaceDismissed, setPerSurfaceDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined" || !oncePerKey) return false;
    try {
      return window.localStorage.getItem(oncePerKey) === "yes";
    } catch {
      return false;
    }
  });

  if (!shouldShowReminder) return null;
  if (perSurfaceDismissed) return null;

  const handleInstall = async (): Promise<void> => {
    if (isIosSafari) {
      setIosSheetOpen(true);
      return;
    }
    await promptInstall();
    // On accepted, appinstalled flips isInstalled → card auto-unmounts.
    // On dismissed, canPromptAndroid flips → card hides next render.
  };

  const handleNotNow = (): void => {
    dismiss();
    if (oncePerKey && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(oncePerKey, "yes");
      } catch {
        // best-effort
      }
      setPerSurfaceDismissed(true);
    }
  };

  return (
    <>
      <section
        data-testid="pwa-install-prompt-card"
        className="rounded-2xl border border-slate-200 border-t-4 border-t-[#003d20] bg-white p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#003d20]/10">
            <Smartphone className="h-5 w-5 text-[#003d20]" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">
              Use Kaun Karega like an app
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Add it to your phone home screen for faster access.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleInstall();
                }}
                data-testid="pwa-install-prompt-card-install"
                className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00542b]"
              >
                Add to Home Screen
              </button>
              <button
                type="button"
                onClick={handleNotNow}
                data-testid="pwa-install-prompt-card-not-now"
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </section>
      <IosInstallInstructionsSheet
        open={iosSheetOpen}
        onClose={() => setIosSheetOpen(false)}
      />
    </>
  );
}
