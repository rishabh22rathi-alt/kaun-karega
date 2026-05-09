"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, PanelLeftClose, X } from "lucide-react";

type AdminSidebarProps = {
  isOpen: boolean;
  onClose?: () => void;
  permissions: string[];
  isCollapsed?: boolean;
  isDesktop?: boolean;
  onCollapseToggle?: () => void;
};

type NavItem = {
  label: string;
  href: string;
  icon: ReactElement;
  requiredPermission?: string;
};

// Admin sidebar nav. Trimmed to a single "Dashboard" entry while the
// broader admin redesign is in progress. Existing pages (Providers, Tasks,
// Task Monitor, Needs, Chat Rooms, Logs, Reviews, Analytics) remain on
// disk and reachable by direct URL — only their sidebar entries are
// hidden until each is rewired/redesigned and added back here one at
// a time. Add new modules by appending NavItem entries to this array.
const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin/dashboard",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6"
        />
      </svg>
    ),
  },
];

export default function AdminSidebar({
  isOpen,
  onClose,
  permissions,
  isCollapsed = false,
  isDesktop = false,
  onCollapseToggle,
}: AdminSidebarProps) {
  const pathname = usePathname();

  const visibleItems = navItems.filter((item) => {
    if (item.requiredPermission) {
      return permissions.includes(item.requiredPermission);
    }
    return true;
  });

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`z-40 flex flex-col bg-slate-900 text-slate-100 shadow-2xl transition-[width,transform] duration-200 ${
          isCollapsed ? "w-20" : "w-72"
        } ${
          isDesktop
            ? "sticky top-0 h-screen shrink-0 translate-x-0"
            : `fixed top-0 left-0 h-full ${isOpen ? "translate-x-0" : "-translate-x-full"}`
        }`}
      >
        <div className={`border-b border-white/10 ${isCollapsed ? "px-3 py-5" : "px-5 py-6"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-xs uppercase tracking-[0.2em] text-slate-400 ${isCollapsed ? "sr-only" : ""}`}>
                Kaun Karega
              </p>
              <p className={`font-semibold text-white ${isCollapsed ? "text-sm" : "text-xl"}`}>
                {isCollapsed ? "KK" : "Admin Control"}
              </p>
              {!isCollapsed ? (
                <p className="text-sm text-slate-400">Manage providers & tasks</p>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {isDesktop ? (
                <button
                  type="button"
                  onClick={onCollapseToggle}
                  aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 transition hover:bg-white/10"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close sidebar"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 transition hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto py-4 ${isCollapsed ? "px-2" : "px-3"}`}>
          {visibleItems.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center rounded-lg py-2 text-sm font-medium transition ${
                  isCollapsed ? "justify-center px-2" : "gap-3 px-3"
                } ${
                  active
                    ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
                title={isCollapsed ? item.label : undefined}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    active
                      ? "border-white/20 bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-slate-200"
                  }`}
                >
                  {item.icon}
                </span>
                {!isCollapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
          {isCollapsed ? (
            <div className="px-1 pt-3">
              <div className="h-px bg-white/10" />
            </div>
          ) : null}
        </nav>
      </aside>
    </>
  );
}
