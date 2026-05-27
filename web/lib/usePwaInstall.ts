"use client";

import { useSyncExternalStore } from "react";

/**
 * PWA install hook + module-level singleton.
 *
 * RESPONSIBILITIES
 *   1. Capture `beforeinstallprompt` BEFORE any component mounts so a
 *      late-mounting card/menu-row can still call prompt() against it.
 *      Listener is attached at module load — runs as soon as this
 *      file is parsed on the client.
 *   2. Track TWO independent install signals that the install UI
 *      consumes differently:
 *        a. `isStandalone` — RUNTIME ONLY. True when the page is
 *           currently displayed in a standalone PWA window. Sources
 *           OR'd:
 *             - matchMedia (display-mode: standalone | fullscreen |
 *               minimal-ui)
 *             - navigator.standalone === true (iOS Safari)
 *           Re-evaluated on every matchMedia change. NOT persisted.
 *           Used by the menu row's visibility gate so the manual
 *           install entry stays reachable in normal browser mode
 *           even after a prior install on the same device.
 *        b. `wasInstalledEver` — PERSISTED. Read from localStorage
 *           `kk_pwa_installed === "yes"`. Written ONLY by the real
 *           `appinstalled` event listener. Suppresses high-intent
 *           reminder cards for users who already installed; does
 *           NOT hide the menu row.
 *   3. Listen for `appinstalled` and persist the `kk_pwa_installed`
 *      flag — the ONLY writer of that key. Pre-emptive writes from
 *      `init()` and the display-mode change listener were removed
 *      because they made a transient standalone observation
 *      permanently poison browser-mode UI (a user who opened the PWA
 *      once would never see the install row in their browser tab
 *      again).
 *   4. Detect iOS Safari (excluding in-app browsers + iOS Chrome/FF).
 *   5. Track "Not now" dismissal timestamp at `kk_pwa_install_dismissed_at`
 *      and expose a 7-day cooldown helper.
 *
 * STATE MODEL
 *   A single module-level `state` object updated by reassign (new
 *   object reference each change). Subscribers fire on every change.
 *   React reads via useSyncExternalStore — server snapshot returns a
 *   neutral "nothing supported" state so SSR + first hydration match
 *   the server output, then flip after the client commits.
 *
 * STORAGE KEYS — the ONLY localStorage keys this hook touches:
 *   - kk_pwa_installed: "yes" sentinel, written ONLY on real
 *     `appinstalled`. Persists across sessions to suppress reminder
 *     cards for users who already installed. Does NOT hide the
 *     manual menu install row.
 *   - kk_pwa_install_dismissed_at: Date.now() string (expires after 7d)
 */

const INSTALLED_KEY = "kk_pwa_installed";
const DISMISSED_KEY = "kk_pwa_install_dismissed_at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type State = {
  // CURRENT runtime standalone display-mode. Re-evaluated when
  // matchMedia fires. NOT persisted, NOT influenced by
  // kk_pwa_installed. The ONLY signal for the user-pulled menu row's
  // visibility — see hook contract below.
  isStandalone: boolean;
  // PERSISTED "user installed at some point" sentinel from
  // kk_pwa_installed. Written ONLY by the appinstalled listener.
  // Survives across sessions and is used to suppress reminder cards;
  // does NOT hide the manual menu row.
  wasInstalledEver: boolean;
  isIosSafari: boolean;
  canPromptAndroid: boolean;
  dismissedAt: number | null;
  // Computed in the singleton (NOT during render) from `dismissedAt`
  // and `Date.now()`. Re-evaluated on dismiss + on init + scheduled
  // via setTimeout to flip to false the moment the cooldown expires.
  // Storing the bool in state lets the hook stay pure (no Date.now()
  // during render → satisfies react-hooks/purity).
  isDismissedRecently: boolean;
};

const SERVER_SNAPSHOT: State = {
  isStandalone: false,
  wasInstalledEver: false,
  isIosSafari: false,
  canPromptAndroid: false,
  dismissedAt: null,
  isDismissedRecently: false,
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let state: State = SERVER_SNAPSHOT;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) cb();
}

function updateState(partial: Partial<State>): void {
  // Reassign with a fresh object so useSyncExternalStore's Object.is
  // comparison detects the change and re-renders subscribers.
  state = { ...state, ...partial };
  notify();
}

function detectIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return false;
  const isSafari = /safari/i.test(ua);
  // Exclude iOS in-app browsers + iOS Chrome/Firefox/Edge — none of
  // these can Add-to-Home-Screen with our standalone manifest.
  const isInAppOrAltBrowser =
    /(crios|fxios|edgios|opios|gsa|fban|fbav|instagram|line|wv)/i.test(ua);
  return isSafari && !isInAppOrAltBrowser;
}

/**
 * Runtime-only standalone detection. Pure read of the current window
 * state — does NOT read localStorage and does NOT cause any write.
 * If any of the three display-mode media queries match, or
 * navigator.standalone is true (iOS), the page is currently running
 * as an installed PWA window.
 */
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
    if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  } catch {
    // matchMedia may throw on very old browsers
  }
  try {
    const nav = navigator as { standalone?: boolean };
    if (nav.standalone === true) return true;
  } catch {
    // standalone is iOS-specific; defensive guard
  }
  return false;
}

function readWasInstalledEver(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === "yes";
  } catch {
    // localStorage may be unavailable in restricted contexts
    return false;
  }
}

function persistInstalled(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INSTALLED_KEY, "yes");
  } catch {
    // best-effort
  }
}

function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

/**
 * Recompute `isDismissedRecently` from `state.dismissedAt` and the
 * current wall clock. Updates state only if the bool changes (avoids
 * unnecessary re-renders). Also schedules a one-shot setTimeout for
 * the cooldown expiry boundary so a page kept open across the 7-day
 * threshold flips the flag without a reload.
 */
let cooldownTimerId: number | null = null;

function recomputeDismissal(): void {
  const within =
    state.dismissedAt !== null &&
    Date.now() - state.dismissedAt < COOLDOWN_MS;

  if (cooldownTimerId !== null && typeof window !== "undefined") {
    window.clearTimeout(cooldownTimerId);
    cooldownTimerId = null;
  }

  if (within && state.dismissedAt !== null && typeof window !== "undefined") {
    const remaining = COOLDOWN_MS - (Date.now() - state.dismissedAt);
    // setTimeout caps at signed-int max; 7 days is well under that.
    const safeRemaining = Math.min(Math.max(remaining, 0), 2_147_000_000);
    cooldownTimerId = window.setTimeout(() => {
      cooldownTimerId = null;
      recomputeDismissal();
    }, safeRemaining);
  }

  if (within !== state.isDismissedRecently) {
    updateState({ isDismissedRecently: within });
  }
}

let initialized = false;

function init(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;

  state = {
    // Runtime-only — never poisons future browser-mode sessions.
    isStandalone: detectStandalone(),
    // Persisted — does NOT gate the menu row.
    wasInstalledEver: readWasInstalledEver(),
    isIosSafari: detectIosSafari(),
    canPromptAndroid: false,
    dismissedAt: readDismissedAt(),
    isDismissedRecently: false,
  };
  // Compute the initial isDismissedRecently + schedule the expiry
  // timeout. Runs once on first import — no time-of-render impurity.
  recomputeDismissal();

  // Capture the deferred install prompt globally. preventDefault stops
  // Chrome's mini-infobar so we can decide when (and where) to surface
  // the install UI ourselves.
  window.addEventListener(
    "beforeinstallprompt",
    (event: Event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      updateState({ canPromptAndroid: true });
    },
    { passive: false }
  );

  // appinstalled is the SINGLE source of truth for "user installed
  // this app". This listener is the ONLY writer of kk_pwa_installed.
  // Note we do NOT set isStandalone here: the current tab is still
  // a browser tab — the standalone PWA opens in a separate window
  // whose own matchMedia/navigator.standalone will resolve true.
  // Setting isStandalone here would incorrectly hide the menu row
  // in the user's current browser tab.
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    persistInstalled();
    updateState({ wasInstalledEver: true, canPromptAndroid: false });
  });

  // Track display-mode changes reactively so the row hides the
  // moment the user transitions into a standalone window (e.g., a
  // Chrome session that swaps in-place). Listening on all three
  // modes the snapshot OR's keeps `isStandalone` accurate without
  // depending on the order they fire. NOTE: this listener does NOT
  // write to localStorage — that responsibility belongs solely to
  // the `appinstalled` event.
  const modes = ["standalone", "fullscreen", "minimal-ui"] as const;
  for (const mode of modes) {
    try {
      const mq = window.matchMedia(`(display-mode: ${mode})`);
      const onChange = (): void => {
        updateState({ isStandalone: detectStandalone() });
      };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
      }
    } catch {
      // matchMedia.addEventListener missing on very old browsers
    }
  }

  // Cross-tab sync via storage event. Dismissal + installed flag
  // changes in one tab reflect in others without a refresh. The
  // INSTALLED_KEY branch updates `wasInstalledEver` (reminder card
  // gate) — it does NOT touch `isStandalone` since localStorage is
  // not a standalone-state signal.
  window.addEventListener("storage", (event) => {
    if (event.key === DISMISSED_KEY) {
      updateState({ dismissedAt: readDismissedAt() });
      recomputeDismissal();
    } else if (event.key === INSTALLED_KEY) {
      updateState({ wasInstalledEver: event.newValue === "yes" });
    }
  });

  // Test affordance: lets Playwright synchronise its synthetic
  // `beforeinstallprompt` dispatch with the moment our listener is
  // actually attached. Harmless in production — it's just a window
  // flag with no behavior attached.
  try {
    (window as unknown as { __kkPwaInstallReady?: boolean }).__kkPwaInstallReady =
      true;
  } catch {
    // some restricted contexts may freeze window
  }
}

// Auto-initialise at module load (client-only).
init();

function subscribe(cb: () => void): () => void {
  init();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): State {
  return state;
}

function getServerSnapshot(): State {
  return SERVER_SNAPSHOT;
}

export type PwaInstallOutcome =
  | "accepted"
  | "dismissed"
  | "ios"
  | "unsupported";

/**
 * Discriminator for which install path the UI should drive when the
 * user taps the install menu row. Centralises the precedence so the
 * row component does not re-derive it (and risk drifting from the
 * `promptInstall()` resolution).
 *
 *   - "android-prompt": a captured beforeinstallprompt is available —
 *     calling promptInstall() will trigger Chrome's native install
 *     dialog. Single-use; flips back to "android-fallback" after
 *     prompt() runs (the hook nulls the deferred event).
 *   - "ios-sheet": iOS Safari (no programmatic install API) — UI
 *     must open the manual Add-to-Home-Screen instructions sheet.
 *   - "android-fallback": no captured prompt and not iOS — typically
 *     desktop, Android Chrome before the engagement heuristic fires,
 *     or an unsupported browser. UI must open the Chrome-menu
 *     instruction sheet so the user has a path forward.
 */
export type PwaInstallPath = "android-prompt" | "ios-sheet" | "android-fallback";

export type PwaInstallHook = {
  /**
   * True while the page is currently rendered inside a standalone
   * PWA window (display-mode standalone/fullscreen/minimal-ui, or
   * navigator.standalone === true on iOS). Runtime-only — does NOT
   * read or honor the persisted `kk_pwa_installed` flag.
   */
  isStandalone: boolean;
  /**
   * True when the user has installed the app at some prior point
   * (per the persisted `kk_pwa_installed` flag, written ONLY by a
   * real `appinstalled` event). Survives across browser sessions.
   * Used to suppress high-intent reminder cards for users who
   * already installed — does NOT hide the manual menu install row.
   */
  wasInstalledEver: boolean;
  isIosSafari: boolean;
  canPromptAndroid: boolean;
  isInstallSupported: boolean;
  isDismissedRecently: boolean;
  /**
   * True when the Menu install row should render.
   *
   * Gate: `!isStandalone` ONLY. The manual menu install row is the
   * user's discoverability anchor in browser mode and MUST stay
   * reachable even after a previous install — i.e., the persisted
   * `kk_pwa_installed` flag intentionally does NOT hide this row.
   * Hiding the row only when the current page is itself running as
   * a standalone PWA prevents the historical bug where one
   * transient standalone observation poisoned every future browser
   * session on the same device.
   *
   * Cooldown does NOT apply (user-pulled UI). The 7-day dismissal
   * key gates only the prompt card.
   *
   * Install-support detection (canPromptAndroid / isIosSafari) does
   * NOT gate the row either — the click handler dispatches to the
   * Android-fallback instruction sheet so users on any browser have
   * a path forward.
   */
  shouldShowMenuRow: boolean;
  /**
   * Which install path the menu row's click handler should drive.
   * See {@link PwaInstallPath} for the precedence rules.
   */
  installPath: PwaInstallPath;
  /**
   * True when a reminder card may render on a high-intent page.
   *
   * Gate: all of:
   *   - !isStandalone (don't pester users already inside the PWA)
   *   - !wasInstalledEver (don't re-pester users who installed before)
   *   - isInstallSupported (no point if no path exists)
   *   - !isDismissedRecently (7-day cooldown from "Not now")
   * Per-surface "first visit only" flags are layered on top by the
   * card consumer.
   */
  shouldShowReminder: boolean;
  promptInstall: () => Promise<PwaInstallOutcome>;
  dismiss: () => void;
};

export function usePwaInstall(): PwaInstallHook {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isInstallSupported = s.canPromptAndroid || s.isIosSafari;
  // iOS takes precedence over a captured Android prompt because iOS
  // Safari never fires beforeinstallprompt in the first place — a
  // captured prompt on an iOS UA would indicate a UA spoof or test
  // setup, in which case the iOS sheet is still the correct path.
  const installPath: PwaInstallPath = s.isIosSafari
    ? "ios-sheet"
    : s.canPromptAndroid
      ? "android-prompt"
      : "android-fallback";

  return {
    isStandalone: s.isStandalone,
    wasInstalledEver: s.wasInstalledEver,
    isIosSafari: s.isIosSafari,
    canPromptAndroid: s.canPromptAndroid,
    isInstallSupported,
    isDismissedRecently: s.isDismissedRecently,
    shouldShowMenuRow: !s.isStandalone,
    installPath,
    shouldShowReminder:
      !s.isStandalone &&
      !s.wasInstalledEver &&
      isInstallSupported &&
      !s.isDismissedRecently,
    promptInstall: async (): Promise<PwaInstallOutcome> => {
      // Only block prompt() when we are CURRENTLY running standalone
      // — wasInstalledEver is intentionally not a guard here so a
      // user who uninstalled and is back in browser mode can
      // reinstall via the row's prompt() path.
      if (s.isStandalone) return "unsupported";
      if (deferredPrompt) {
        const event = deferredPrompt;
        // Consume the deferred prompt: it can only be used once. Null
        // immediately so a double-tap can't try again on the same event.
        deferredPrompt = null;
        try {
          await event.prompt();
          const { outcome } = await event.userChoice;
          updateState({ canPromptAndroid: false });
          // appinstalled will fire (on accepted) and set the
          // permanent flag via its listener — no extra write here.
          return outcome;
        } catch {
          updateState({ canPromptAndroid: false });
          return "dismissed";
        }
      }
      if (s.isIosSafari) return "ios";
      return "unsupported";
    },
    dismiss: (): void => {
      if (typeof window === "undefined") return;
      try {
        const now = Date.now();
        window.localStorage.setItem(DISMISSED_KEY, String(now));
        updateState({ dismissedAt: now });
        recomputeDismissal();
      } catch {
        // best-effort
      }
    },
  };
}
