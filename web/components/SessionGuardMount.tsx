"use client";

import { useSessionGuard } from "@/lib/useSessionGuard";

/**
 * Mounts the public-mode stale-session probe globally without coupling it
 * to the Sidebar. The Sidebar previously owned this call, but the mobile
 * bottom-nav refactor hides the sidebar entirely on mobile (`hidden md:flex`),
 * which would have orphaned the probe on phone viewports. Render this once
 * inside RootLayout so the guard runs on every public page on every viewport.
 */
export default function SessionGuardMount() {
  useSessionGuard({ mode: "public" });
  return null;
}
