"use client";

import { useSyncExternalStore } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import AdminNotificationBell from "./admin/AdminNotificationBell";

type AdminTopbarProps = {
  name?: string;
  role?: string;
  onLogout: () => void;
  onMenuToggle?: () => void;
  isSidebarCollapsed?: boolean;
  isDesktop?: boolean;
};

// Desktop-viewport gate for AdminNotificationBell. The previous
// `hidden md:block` wrapper kept the bell visually hidden on mobile but
// React still mounted it, so its 45s /api/admin/notifications poll
// fired alongside AdminMobileBottomNav's own poll — double-polling on
// every phone load. Returning the bell conditionally based on this
// useSyncExternalStore snapshot means the component genuinely never
// mounts on < md, so its useEffect (and the polling) never runs.
//
// Hydration is not a concern here: AdminTopbar is dynamic-imported in
// AdminLayoutClient with ssr: false, so the server emits nothing for
// this subtree. The getServerSnapshot value is therefore unobservable
// in practice; `false` matches the documented "absent on SSR" default.
//
// Tailwind's md breakpoint is min-width: 768px. The matchMedia query
// mirrors that boundary exactly.
function subscribeDesktopViewport(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getDesktopViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 768px)").matches;
}

function getServerDesktopViewportSnapshot(): boolean {
  return false;
}

export default function AdminTopbar({
  // `name` and `role` are still accepted on AdminTopbarProps so
  // existing callers don't need to change their JSX, but neither is
  // rendered in the greeting per the current "Welcome Boss !" copy.
  onLogout,
  onMenuToggle,
  isSidebarCollapsed = false,
  isDesktop = false,
}: AdminTopbarProps) {
  const isDesktopViewport = useSyncExternalStore(
    subscribeDesktopViewport,
    getDesktopViewportSnapshot,
    getServerDesktopViewportSnapshot
  );

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 shadow-sm md:px-6">
      <div className="flex items-center gap-3">
        {/* Sidebar toggle — hidden on phone viewports. The phone admin
            navigation lives in AdminMobileBottomNav's Menu sheet, so
            this hamburger has nothing to drive at < md. Tablet (md to
            lg-) and desktop still rely on it for drawer + collapse. */}
        <button
          type="button"
          onClick={onMenuToggle}
          className="hidden md:inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
          aria-label={isDesktop ? (isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar") : "Toggle sidebar"}
        >
          {isDesktop ? (
            isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Admin Workspace
          </p>
          <p className="truncate text-base font-bold leading-tight text-slate-900">
            Welcome Boss !
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* AdminNotificationBell — desktop/tablet only. The viewport
            gate above genuinely unmounts the component at < md so its
            useEffect (and the 45s /api/admin/notifications poll) never
            runs on phone viewports. AdminMobileBottomNav handles the
            mobile Alerts badge with its own poll. Single poll per
            viewport, no double-polling. */}
        {isDesktopViewport ? <AdminNotificationBell /> : null}
        <button
          type="button"
          onClick={onLogout}
          className="hidden md:inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 md:px-4"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
