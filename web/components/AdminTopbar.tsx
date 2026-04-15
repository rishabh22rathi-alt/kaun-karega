"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

type AdminTopbarProps = {
  name?: string;
  role?: string;
  onLogout: () => void;
  onMenuToggle?: () => void;
  isSidebarCollapsed?: boolean;
  isDesktop?: boolean;
};

export default function AdminTopbar({
  name = "Admin",
  role = "admin",
  onLogout,
  onMenuToggle,
  isSidebarCollapsed = false,
  isDesktop = false,
}: AdminTopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 shadow-sm md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuToggle}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100"
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
          <p className="truncate text-sm font-semibold leading-tight text-slate-900">
            {name} <span className="text-slate-500">({role})</span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 md:px-4"
      >
        Logout
      </button>
    </header>
  );
}
