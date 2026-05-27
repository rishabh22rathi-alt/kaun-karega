"use client";

import { useState } from "react";
import { Download, Share } from "lucide-react";
import { usePwaInstall } from "@/lib/usePwaInstall";
import IosInstallInstructionsSheet from "./IosInstallInstructionsSheet";
import AndroidInstallInstructionsSheet from "./AndroidInstallInstructionsSheet";

type Props = {
  /**
   * Parent menu sheet's close handler. Called after a successful
   * Android install so the menu collapses around the new state. Not
   * called on Android dismiss / instructions-sheet open (user may
   * want to return to the menu after closing instructions).
   */
  onClose: () => void;
};

/**
 * Menu row that opens the PWA install flow. The row is visible
 * whenever the app is NOT already installed, regardless of whether
 * the current browser has fired beforeinstallprompt — the click
 * handler picks the right path:
 *
 *   - iOS Safari: open the manual Add-to-Home-Screen instructions sheet.
 *   - Android Chromium with captured beforeinstallprompt: call prompt().
 *   - Anything else (desktop, Android pre-engagement, unsupported):
 *     open the Chrome-menu fallback instructions sheet.
 *
 * Hides ONLY while the page is currently running as a standalone
 * PWA (display-mode standalone/fullscreen/minimal-ui, or
 * navigator.standalone === true on iOS). The persisted
 * `kk_pwa_installed` flag does NOT hide this row — the menu is the
 * user's manual install entry and must stay reachable in normal
 * browser mode even after a prior install on the same device. 7-day
 * cooldown does NOT apply here (user-pulled UI).
 */
export default function InstallAppMenuRow({ onClose }: Props) {
  const { shouldShowMenuRow, installPath, promptInstall } = usePwaInstall();
  const [iosSheetOpen, setIosSheetOpen] = useState(false);
  const [androidSheetOpen, setAndroidSheetOpen] = useState(false);

  if (!shouldShowMenuRow) return null;

  const isIos = installPath === "ios-sheet";

  const handleClick = async (): Promise<void> => {
    if (installPath === "ios-sheet") {
      setIosSheetOpen(true);
      return;
    }
    if (installPath === "android-prompt") {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        onClose();
        return;
      }
      // outcome === "dismissed": the deferred prompt is consumed and
      // canPromptAndroid flipped to false in the hook. The row stays
      // visible (not installed) but the next click will route to the
      // android-fallback path until Chrome re-fires beforeinstallprompt.
      return;
    }
    // installPath === "android-fallback"
    setAndroidSheetOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void handleClick();
        }}
        data-testid="pwa-install-menu-row"
        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
      >
        {isIos ? (
          <Share className="h-4 w-4 text-[#003d20]" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4 text-[#003d20]" aria-hidden="true" />
        )}
        <span>
          {isIos
            ? "Add Kaun Karega to Home Screen"
            : "Install Kaun Karega App"}
        </span>
      </button>
      <IosInstallInstructionsSheet
        open={iosSheetOpen}
        onClose={() => setIosSheetOpen(false)}
      />
      <AndroidInstallInstructionsSheet
        open={androidSheetOpen}
        onClose={() => setAndroidSheetOpen(false)}
      />
    </>
  );
}
