"use client";

import { useState } from "react";
import { Download, Share } from "lucide-react";
import { usePwaInstall } from "@/lib/usePwaInstall";
import IosInstallInstructionsSheet from "./IosInstallInstructionsSheet";

type Props = {
  /**
   * Parent menu sheet's close handler. Called after a successful
   * Android install so the menu collapses around the new state. Not
   * called on Android dismiss / iOS instructions open (user may want
   * to return to the menu after closing instructions).
   */
  onClose: () => void;
};

/**
 * Menu row that opens the PWA install flow:
 *   - Android Chromium: triggers the captured beforeinstallprompt.
 *   - iOS Safari: opens the manual instructions sheet.
 *
 * Self-hides when the PWA is already installed or when install is
 * not supported in this browser. Cooldown does NOT apply here —
 * see usePwaInstall.shouldShowMenuRow.
 */
export default function InstallAppMenuRow({ onClose }: Props) {
  const { shouldShowMenuRow, isIosSafari, promptInstall } = usePwaInstall();
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  if (!shouldShowMenuRow) return null;

  const handleClick = async (): Promise<void> => {
    if (isIosSafari) {
      setIosSheetOpen(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      onClose();
    }
    // outcome === "dismissed" / "unsupported": row will hide on the
    // next render because canPromptAndroid flipped to false in the
    // hook; if the browser later re-fires beforeinstallprompt, the
    // row reappears.
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
        {isIosSafari ? (
          <Share className="h-4 w-4 text-[#003d20]" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4 text-[#003d20]" aria-hidden="true" />
        )}
        <span>
          {isIosSafari ? "Add to Home Screen" : "Install Kaun Karega App"}
        </span>
      </button>
      <IosInstallInstructionsSheet
        open={iosSheetOpen}
        onClose={() => setIosSheetOpen(false)}
      />
    </>
  );
}
