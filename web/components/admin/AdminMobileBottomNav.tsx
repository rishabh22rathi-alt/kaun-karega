"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  Briefcase,
  LayoutDashboard,
  Menu as MenuIcon,
  Users as UsersIcon,
} from "lucide-react";
import AdminMenuSheet from "./AdminMenuSheet";

const ADMIN_UNREAD_POLL_MS = 45_000;

// Mobile viewport detection via useSyncExternalStore. Critical reason:
// without this, the nav would still mount at md+ (display:none hides it
// visually, but React effects still fire) and its 45s notifications
// poll would run alongside the desktop AdminNotificationBell's poll —
// double-polling /api/admin/notifications on desktop. With this hook,
// the entire component returns null at md+, its effects never run, and
// only the desktop bell polls. Tailwind's md breakpoint is min-width:
// 768px, so the matchMedia query mirrors that boundary exactly.
function subscribeMobileViewport(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(max-width: 767.98px)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767.98px)").matches;
}

function getServerMobileViewportSnapshot(): boolean {
  return false;
}

type AdminNotificationsResponse = {
  success?: boolean;
  unreadCount?: number;
};

type Props = {
  name?: string;
  role?: string;
  permissions?: string[];
  onLogout: () => void | Promise<void>;
};

type TabConfig = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  isActive: (pathname: string, tab: string) => boolean;
  badgeKey?: "alerts";
};

export default function AdminMobileBottomNav({
  name,
  role,
  permissions,
  onLogout,
}: Props) {
  const pathname = usePathname() || "/admin/dashboard";
  const searchParams = useSearchParams();
  const currentTab = (searchParams?.get("tab") ?? "").toLowerCase();

  const isMobile = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Hide list — the AdminLayoutClient's loading guard prevents this
  // component from mounting until admin auth is verified, but route-
  // based exceptions are still needed (login screen + any future
  // sticky-input route). Bottom-nav UX must never appear on /admin/
  // login because that route renders no chrome at all.
  const shouldHide = useMemo(() => {
    if (!pathname) return true;
    if (pathname === "/admin/login") return true;
    // Defensive: if a sticky chat input exists at /admin/chats/<id>,
    // hide. The dashboard ChatsTab is the primary chat surface today;
    // the bare /admin/chats route lists threads and is safe to overlay.
    if (/^\/admin\/chats\/[^/]+/.test(pathname)) return true;
    return false;
  }, [pathname]);

  // Publish bottom-nav reserved height so the admin <main> can pad
  // its bottom for our height. Mirrors the public MobileBottomNav.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const shell = document.getElementById("kk-app-shell");
    if (!shell) return;
    const height =
      !isMobile || shouldHide
        ? "0px"
        : "calc(4rem + env(safe-area-inset-bottom, 0px))";
    shell.style.setProperty("--kk-bottom-nav-height", height);
    return () => {
      const node = document.getElementById("kk-app-shell");
      if (node) node.style.removeProperty("--kk-bottom-nav-height");
    };
  }, [isMobile, shouldHide]);

  // Notifications unread badge poll. Same endpoint and cadence as the
  // desktop AdminNotificationBell. By the time this effect runs, we
  // are guaranteed to be on mobile (component returns null at md+
  // BEFORE this effect can fire — see the early return below). The
  // desktop bell is the sole source on >= md; this bar is the sole
  // source on < md. Zero double polling.
  useEffect(() => {
    if (!isMobile || shouldHide) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/admin/notifications", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res
          .json()
          .catch(() => ({}))) as AdminNotificationsResponse;
        if (cancelled || !data?.success) return;
        setUnreadCount(
          typeof data.unreadCount === "number" ? data.unreadCount : 0
        );
      } catch {
        // Soft fail; next interval retries. The bar must never throw
        // because admin workflow tolerates a transient blip on the
        // badge but not a crash.
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), ADMIN_UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isMobile, shouldHide]);

  if (!isMobile || shouldHide) {
    return null;
  }

  const tabs: TabConfig[] = [
    {
      label: "Dashboard",
      href: "/admin/dashboard",
      icon: LayoutDashboard,
      testId: "admin-bottom-nav-tab-dashboard",
      isActive: (p, tab) =>
        p === "/admin/dashboard" &&
        (tab === "" || (tab !== "providers" && tab !== "kaam")),
    },
    {
      label: "Providers",
      href: "/admin/dashboard?tab=providers",
      icon: UsersIcon,
      testId: "admin-bottom-nav-tab-providers",
      isActive: (p, tab) => p === "/admin/dashboard" && tab === "providers",
    },
    {
      label: "Kaam",
      href: "/admin/dashboard?tab=kaam",
      icon: Briefcase,
      testId: "admin-bottom-nav-tab-kaam",
      isActive: (p, tab) => p === "/admin/dashboard" && tab === "kaam",
    },
    {
      label: "Alerts",
      href: "/admin/alerts",
      icon: Bell,
      testId: "admin-bottom-nav-tab-alerts",
      isActive: (p) =>
        p === "/admin/alerts" || p.startsWith("/admin/alerts/"),
      badgeKey: "alerts",
    },
  ];

  return (
    <>
      <nav
        aria-label="Admin primary"
        data-testid="admin-bottom-nav"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#00542b] bg-[#003d20] shadow-[0_-8px_24px_rgba(0,61,32,0.35)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="grid h-16 grid-cols-5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.isActive(pathname, currentTab);
            const badgeVisible =
              tab.badgeKey === "alerts" && unreadCount > 0;
            const badgeText =
              unreadCount > 99 ? "99+" : unreadCount > 9 ? "9+" : String(unreadCount);
            return (
              <li key={tab.label}>
                <Link
                  href={tab.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  data-testid={tab.testId}
                  onClick={() => setMenuOpen(false)}
                  className="block h-full w-full focus:outline-none focus-visible:bg-white/10"
                >
                  <span
                    className={`flex h-full flex-col items-center justify-center gap-1 text-[10px] font-semibold transition ${
                      active ? "text-[#FFE3C2]" : "text-orange-200/80"
                    }`}
                  >
                    <span
                      className={`relative inline-flex items-center justify-center rounded-full transition ${
                        active
                          ? "bg-[#FFE3C2] px-4 py-1 text-[#003d20] shadow-[0_2px_6px_rgba(0,0,0,0.18)]"
                          : "text-[#f97316]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {badgeVisible ? (
                        <span
                          aria-hidden="true"
                          data-testid="admin-bottom-nav-alerts-badge"
                          className="absolute -right-2 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[#f97316] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[#003d20]"
                        >
                          {badgeText}
                        </span>
                      ) : null}
                    </span>
                    <span>{tab.label}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-label="Open admin menu"
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              data-testid="admin-bottom-nav-tab-menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="block h-full w-full focus:outline-none focus-visible:bg-white/10"
            >
              <span
                className={`flex h-full flex-col items-center justify-center gap-1 text-[10px] font-semibold transition ${
                  menuOpen ? "text-[#FFE3C2]" : "text-orange-200/80"
                }`}
              >
                <span
                  className={`relative inline-flex items-center justify-center rounded-full transition ${
                    menuOpen
                      ? "bg-[#FFE3C2] px-4 py-1 text-[#003d20] shadow-[0_2px_6px_rgba(0,0,0,0.18)]"
                      : "text-[#f97316]"
                  }`}
                >
                  <MenuIcon className="h-5 w-5" />
                </span>
                <span>Menu</span>
              </span>
            </button>
          </li>
        </ul>
      </nav>

      <AdminMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        name={name}
        role={role}
        permissions={permissions}
        onLogout={onLogout}
      />
    </>
  );
}
