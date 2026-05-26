"use client";

import { useEffect } from "react";

/**
 * Phase 1 service worker registration.
 *
 * Production-only: dev mode skips registration entirely so the local
 * `npm run dev` loop is unaffected by SW caching/state and HMR doesn't
 * fight with an active SW. QA happens against `next build && next start`
 * or against deployed previews.
 *
 * Errors are swallowed: if the browser does not support service
 * workers, if registration fails (private mode, missing file, scope
 * issue, CSP block), or if the user has SW disabled, the site
 * continues to work — installability is degraded, but the app itself
 * is not blocked.
 *
 * Renders nothing. Safe to mount anywhere inside `<body>`.
 */
export default function PwaServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // Soft fail — PWA install is best-effort. Do not surface
        // user-visible errors for SW registration issues.
      });
  }, []);

  return null;
}
