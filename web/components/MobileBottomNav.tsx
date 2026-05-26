"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  ClipboardList,
  Bell,
  Menu as MenuIcon,
  MessageSquare,
  LayoutDashboard,
  Briefcase,
  LogIn,
  PlusSquare,
} from "lucide-react";
import { getAuthSession, type AuthSession } from "@/lib/auth";
import {
  PROVIDER_PROFILE_UPDATED_EVENT,
  SIDEBAR_TOGGLE_EVENT,
} from "./sidebarEvents";
import MenuSheet from "./MenuSheet";

const PROVIDER_UNREAD_POLL_MS = 60_000;
const ADMIN_SESSION_STORAGE_KEY = "kk_admin_session";
const PROVIDER_PROFILE_STORAGE_KEY = "kk_provider_profile";

// ─── useSyncExternalStore wiring for session / admin / hydration ─────────────
// Replaces a pair of `useState + useEffect(setState)` mount-and-listen blocks
// that the react-hooks/set-state-in-effect rule flags. The store snapshot
// must return a stable reference until something changes, so getAuthSession()
// (which allocates a fresh object every call) is wrapped in a phone-keyed
// cache. isAdmin returns a boolean primitive so no caching is needed.

let sessionSnapshotCache: AuthSession | null = null;

function getSessionSnapshot(): AuthSession | null {
  const fresh = getAuthSession();
  const cached = sessionSnapshotCache;
  // Stability check: same null state OR same phone → return cached reference.
  // Object.is comparison inside useSyncExternalStore depends on this.
  if ((fresh?.phone ?? null) === (cached?.phone ?? null)) {
    return cached;
  }
  sessionSnapshotCache = fresh;
  return fresh;
}

function getServerSessionSnapshot(): AuthSession | null {
  return null;
}

function readAdminSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { isAdmin?: unknown };
    return parsed?.isAdmin === true;
  } catch {
    return false;
  }
}

function getAdminSnapshot(): boolean {
  return readAdminSession();
}

function getServerAdminSnapshot(): boolean {
  return false;
}

function subscribeToAuth(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onAuthEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ type?: string }>).detail;
    if (detail?.type === "auth-updated") callback();
  };
  window.addEventListener("storage", callback);
  window.addEventListener(PROVIDER_PROFILE_UPDATED_EVENT, callback);
  window.addEventListener(SIDEBAR_TOGGLE_EVENT, onAuthEvent);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PROVIDER_PROFILE_UPDATED_EVENT, callback);
    window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onAuthEvent);
  };
}

// "Has the component mounted on the client?" — the canonical
// useSyncExternalStore idiom for a hydration flag.
function subscribeNoop(): () => void {
  return () => {};
}
function getHydratedSnapshot(): boolean {
  return true;
}
function getServerHydratedSnapshot(): boolean {
  return false;
}

type ProviderProfileCache = {
  Phone?: string;
};

type ProviderNotificationsResponse = {
  ok?: boolean;
  notifications?: Array<{ seen?: boolean }>;
};

function readCachedProviderExists(session: AuthSession | null): boolean | null {
  if (typeof window === "undefined") return null;
  if (!session?.phone) return false;
  try {
    const raw = window.localStorage.getItem(PROVIDER_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProviderProfileCache;
    const cachedPhone = String(parsed?.Phone || "").replace(/\D/g, "").slice(-10);
    const sessionPhone = String(session.phone || "").replace(/\D/g, "").slice(-10);
    if (cachedPhone && cachedPhone === sessionPhone) return true;
    return null;
  } catch {
    return null;
  }
}

type TabConfig = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Optional unread badge count. */
  badge?: number;
  /** Active-state predicate. Defaults to exact match + nested prefix. */
  isActive?: (pathname: string) => boolean;
};

function deriveInitialProviderExists(
  hydrated: boolean,
  session: AuthSession | null,
  isAdmin: boolean
): boolean | null {
  if (!hydrated) return null;
  if (!session?.phone || isAdmin) return false;
  return readCachedProviderExists(session);
}

export default function MobileBottomNav() {
  const pathname = usePathname() || "/";

  // Cookie + localStorage + cross-tab subscriptions all flow through
  // useSyncExternalStore so the initial render matches SSR (null / false)
  // and post-hydration commits switch to live values without a setState
  // inside useEffect (avoids the react-hooks/set-state-in-effect lint).
  const session = useSyncExternalStore(
    subscribeToAuth,
    getSessionSnapshot,
    getServerSessionSnapshot
  );
  const isAdmin = useSyncExternalStore(
    subscribeToAuth,
    getAdminSnapshot,
    getServerAdminSnapshot
  );
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getHydratedSnapshot,
    getServerHydratedSnapshot
  );

  const [menuOpen, setMenuOpen] = useState(false);

  // providerExists. Render-time "adjust state on input change" pattern
  // (React 19 docs) — re-seeds from cache when hydrated/session/admin
  // flip, instead of a setState inside an effect. The async fetch below
  // is the only thing that still writes via an effect, and it does so
  // from a callback (not the effect body), which the lint rule allows.
  const [providerExists, setProviderExists] = useState<boolean | null>(null);
  const providerExistsKey = `${hydrated ? "1" : "0"}:${session?.phone ?? ""}:${
    isAdmin ? "1" : "0"
  }`;
  // Initial key matches the server snapshots (hydrated=false, session=null,
  // isAdmin=false); the first post-hydration render flips it, triggering
  // the render-time re-derive below.
  const [trackedProviderExistsKey, setTrackedProviderExistsKey] = useState("0::0");
  if (trackedProviderExistsKey !== providerExistsKey) {
    setTrackedProviderExistsKey(providerExistsKey);
    setProviderExists(deriveInitialProviderExists(hydrated, session, isAdmin));
  }

  useEffect(() => {
    if (!hydrated) return;
    if (!session?.phone || isAdmin) return;
    const lookupPhone = String(session.phone || "").replace(/\D/g, "").slice(-10);
    if (!lookupPhone) return;

    let ignore = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(lookupPhone)}`,
          { cache: "no-store" }
        );
        const text = await res.text();
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        const parsed = data as { ok?: boolean; provider?: unknown } | null;
        if (!ignore) {
          setProviderExists(
            Boolean(res.ok && parsed?.ok === true && parsed?.provider)
          );
        }
      } catch {
        if (!ignore) setProviderExists(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [hydrated, session, isAdmin]);

  // Provider unread badge — polls the same endpoint the desktop bell uses.
  // The bell is hidden on mobile via the layout wrapper (`hidden md:block`),
  // so its hooks never run on mobile and there is no duplicate polling.
  // Reset to 0 when the polling gate flips, via the render-time pattern
  // instead of an in-effect setState.
  const shouldPollProviderUnread =
    hydrated && !isAdmin && providerExists === true;
  const [providerUnread, setProviderUnread] = useState(0);
  const [trackedShouldPoll, setTrackedShouldPoll] = useState(false);
  if (trackedShouldPoll !== shouldPollProviderUnread) {
    setTrackedShouldPoll(shouldPollProviderUnread);
    if (!shouldPollProviderUnread) {
      setProviderUnread(0);
    }
  }

  useEffect(() => {
    if (!shouldPollProviderUnread) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/provider/notifications", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res.json()) as ProviderNotificationsResponse;
        if (cancelled || !data?.ok) return;
        const unread = (data.notifications || []).filter((n) => !n?.seen).length;
        setProviderUnread(unread);
      } catch {
        // Soft fail; next interval retries.
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), PROVIDER_UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shouldPollProviderUnread]);

  // Route-based hide list. Admin layout owns its own chrome. Full-screen
  // chat thread routes have a sticky message input that would clash with
  // the bottom bar.
  const shouldHide = useMemo(() => {
    if (!pathname) return true;
    if (pathname.startsWith("/admin")) return true;
    // Matches /chat/[id], /chat/thread/[id], /dashboard/my-requests/chat/[id],
    // /i-need/chat/[id]. Bare /chat is a redirect entry, so /chat/<segment>
    // is the right pattern.
    if (pathname.includes("/chat/")) return true;
    return false;
  }, [pathname]);

  const tabs = useMemo<TabConfig[]>(() => {
    const homeTab: TabConfig = {
      label: "Home",
      href: "/",
      icon: Home,
      isActive: (p) => p === "/",
    };
    const menuTab: TabConfig = {
      label: "Menu",
      href: "#menu",
      icon: MenuIcon,
    };

    // Loading skeleton — render Home + Menu only; mid slots reserved.
    if (!hydrated) {
      return [homeTab, menuTab];
    }

    // Guest
    if (!session?.phone) {
      return [
        homeTab,
        { label: "Login", href: "/login", icon: LogIn },
        {
          label: "Post",
          href: "/login?next=/post-task",
          icon: PlusSquare,
        },
        {
          label: "Alerts",
          href: "/login?next=/dashboard/alerts",
          icon: Bell,
        },
        menuTab,
      ];
    }

    // Provider
    if (providerExists === true) {
      return [
        homeTab,
        {
          label: "Dashboard",
          href: "/provider/dashboard",
          icon: LayoutDashboard,
        },
        {
          label: "Jobs",
          href: "/provider/my-jobs",
          icon: Briefcase,
        },
        {
          label: "Alerts",
          href: "/provider/alerts",
          icon: Bell,
          badge: providerUnread,
        },
        menuTab,
      ];
    }

    // Logged-in user (and the providerExists === null loading window —
    // show user tabs optimistically so we don't flash skeletons every
    // navigation).
    // TODO(chats-route): there is no canonical chats inbox today —
    // `/chat` is a redirect entry that needs taskId+provider. Until a
    // proper inbox page lands, the "Chats" tab routes to /dashboard/my-
    // requests where users open chats per-request. Revisit when an
    // inbox view exists.
    return [
      homeTab,
      {
        label: "Requests",
        href: "/dashboard/my-requests",
        icon: ClipboardList,
      },
      {
        label: "Chats",
        href: "/dashboard/my-requests",
        icon: MessageSquare,
      },
      {
        label: "Alerts",
        href: "/dashboard/alerts",
        icon: Bell,
      },
      menuTab,
    ];
  }, [hydrated, session, providerExists, providerUnread]);

  // Publish bottom-nav height so the main content can pad-bottom for it.
  // Mirrors how Sidebar.tsx writes `--kk-sidebar-width` to #kk-app-shell.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const shell = document.getElementById("kk-app-shell");
    if (!shell) return;
    const height = shouldHide
      ? "0px"
      : "calc(4rem + env(safe-area-inset-bottom, 0px))";
    shell.style.setProperty("--kk-bottom-nav-height", height);
    return () => {
      const node = document.getElementById("kk-app-shell");
      if (node) node.style.removeProperty("--kk-bottom-nav-height");
    };
  }, [shouldHide]);

  if (shouldHide) {
    return null;
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#00542b] bg-[#003d20] shadow-[0_-8px_24px_rgba(0,61,32,0.35)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="grid h-16 grid-cols-5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isMenu = tab.label === "Menu";
            const active = isMenu
              ? menuOpen
              : tab.isActive
                ? tab.isActive(pathname)
                : pathname === tab.href ||
                  pathname.startsWith(`${tab.href}/`);
            const badgeVisible = (tab.badge ?? 0) > 0;
            const badgeText =
              (tab.badge ?? 0) > 9 ? "9+" : String(tab.badge ?? 0);
            const content = (
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
                      className="absolute -right-2 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[#f97316] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[#003d20]"
                    >
                      {badgeText}
                    </span>
                  ) : null}
                </span>
                <span>{tab.label}</span>
              </span>
            );
            if (isMenu) {
              return (
                <li key={tab.label}>
                  <button
                    type="button"
                    aria-label="Open menu"
                    aria-expanded={menuOpen}
                    aria-haspopup="dialog"
                    data-testid="mobile-bottom-nav-menu"
                    onClick={() => setMenuOpen((v) => !v)}
                    className="block h-full w-full focus:outline-none focus-visible:bg-white/10"
                  >
                    {content}
                  </button>
                </li>
              );
            }
            return (
              <li key={`${tab.label}-${tab.href}`}>
                <Link
                  href={tab.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className="block h-full w-full focus:outline-none focus-visible:bg-white/10"
                  onClick={() => setMenuOpen(false)}
                >
                  {content}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        session={session}
        isAdmin={isAdmin}
        providerExists={providerExists}
      />
    </>
  );
}
