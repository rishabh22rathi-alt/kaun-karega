"use client";

/**
 * Client-side guard against stale sessions.
 *
 * Background:
 *   /api/verify-otp now bumps profiles.session_version on every login,
 *   so a fresh login on Device B invalidates Device A's signed cookie
 *   server-side. But Device A's BROWSER still has the unsigned UI-hint
 *   cookie (kk_session_user, kk_admin) and any open tab still shows the
 *   logged-in chrome. This hook bridges that: on mount and on tab focus,
 *   it pings /api/auth/whoami; a 401 with reason "stale" means the
 *   server has already rejected the cookie, so we clear UI hints and
 *   route to /login.
 *
 * Why not a global wrapper:
 *   Most pages in the app are public (the homepage, /providers, etc.) —
 *   we don't want every page to redirect on missing session. The hook
 *   is opt-in: callers that gate on `phone` (Sidebar's avatar, provider
 *   dashboard, chat thread, etc.) wire it up. Pages that don't care
 *   simply don't import it.
 *
 * Behaviour:
 *   - On mount: probe immediately.
 *   - On tab focus / visibilitychange: probe again (covers "user
 *     foregrounded the old tab hours later").
 *   - On window storage event for `kk_admin_session` clearing: also
 *     react, so logging out in another tab of the same browser cleans
 *     up too.
 *   - When stale: clearAuthSession() + router.replace(redirectTo).
 *
 * The hook intentionally does NOT poll on an interval — that would burn
 * mobile battery for no benefit. Focus is the natural trigger for the
 * "old device" detection moment.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { clearAuthSession } from "@/lib/auth";

type WhoamiResponse = {
  ok?: boolean;
  reason?: string;
  phone?: string;
};

type Options = {
  /**
   * Public mode is for globally mounted chrome on public pages. It repairs
   * stale browser auth state but does not redirect away from the page.
   * Protected mode keeps the existing redirect-on-stale behavior.
   */
  mode?: "public" | "protected";
  /**
   * Explicit override for stale-session redirects. Defaults to false in
   * public mode and true otherwise.
   */
  redirectOnStale?: boolean;
  /**
   * Allows callers to keep the hook mounted while suppressing probes.
   */
  enabled?: boolean;
  /**
   * Where to send the user after a stale session is detected. Defaults
   * to `/login`. Pass a path like `/login?next=/provider/dashboard` if
   * you want to return to the same page after the next OTP login.
   */
  redirectTo?: string;
  /**
   * When true (default), the probe runs on mount. Set false for pages
   * that want to lazily call `recheck()` themselves (e.g. after a
   * suspected long idle).
   */
  probeOnMount?: boolean;
  /**
   * When true (default), the probe runs every time the tab is
   * foregrounded.
   */
  probeOnFocus?: boolean;
};

export function useSessionGuard(options: Options = {}): {
  recheck: () => Promise<void>;
} {
  const router = useRouter();
  const enabled = options.enabled !== false;
  const mode = options.mode ?? "protected";
  const redirectOnStale = options.redirectOnStale ?? mode !== "public";
  const redirectTo = options.redirectTo ?? "/login";
  const probeOnMount = options.probeOnMount !== false;
  const probeOnFocus = options.probeOnFocus !== false;
  const inFlightRef = useRef(false);
  const handledRef = useRef(false);

  const recheck = async (): Promise<void> => {
    if (!enabled || inFlightRef.current || handledRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/auth/whoami", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) {
        let body: WhoamiResponse | null = null;
        try {
          body = (await res.json()) as WhoamiResponse;
        } catch {
          body = null;
        }
        // Redirect ONLY on `reason: "stale"` — that's the "another
        // device kicked you out" signal this hook exists to surface.
        //
        // `reason: "no-session"` means the request was anonymous (no
        // cookie / expired cookie / first visit). The Sidebar mounts
        // this hook globally, so reacting to no-session would force
        // every guest visitor on every public page (`/`, `/providers`,
        // marketing) to /login, breaking the app for new users.
        // Per-page guards (middleware for /admin, page-level checks
        // for /provider/dashboard etc.) handle the "guest on a
        // protected page" case on their own.
        if (body?.reason === "stale") {
          handledRef.current = true;
          clearStaleClientHints();
          dispatchAuthStateChanged();
          await clearAuthSession();
          dispatchAuthStateChanged();
          if (redirectOnStale) {
            router.replace(redirectTo);
          }
        }
      }
    } catch {
      // Network errors are non-fatal — the next focus event will retry.
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!enabled) return;
    if (probeOnMount) {
      void recheck();
    }
    if (!probeOnFocus) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void recheck();
      }
    };
    const onFocus = () => {
      void recheck();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, redirectOnStale, redirectTo, probeOnMount, probeOnFocus]);

  return { recheck };
}

function clearStaleClientHints(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    window.localStorage.removeItem("kk_admin_session");
    window.localStorage.removeItem("kk_provider_profile");
  } catch {
    // localStorage may be unavailable in private-mode WebViews or quota errors.
  }
  try {
    document.cookie = "kk_session_user=; Max-Age=0; Path=/; SameSite=Strict";
    document.cookie = "kk_admin=; Max-Age=0; Path=/; SameSite=Strict";
  } catch {
    // Cookie writes can fail in locked-down browser contexts.
  }
}

function dispatchAuthStateChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event("storage"));
  } catch {
    // Non-critical; the next navigation will read the cleaned state.
  }
}
