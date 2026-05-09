"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Home,
  ClipboardList,
  MessageSquareWarning,
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  LogIn,
  UserPlus,
  ListTodo,
  Briefcase,
  Lock,
} from "lucide-react";
import {
  PROVIDER_PROFILE_UPDATED_EVENT,
  SIDEBAR_STATE_EVENT,
  SIDEBAR_TOGGLE_EVENT,
} from "./sidebarEvents";
import { clearAuthSession, getAuthSession, type AuthSession } from "@/lib/auth";
import { isProviderVerifiedBadge } from "@/lib/providerPresentation";
import { fetchProviderDashboardProfile } from "@/lib/providerDashboardProfile";

const PROVIDER_PROFILE_STORAGE_KEY = "kk_provider_profile";
const ADMIN_SESSION_STORAGE_KEY = "kk_admin_session";

function readAdminSession(): boolean {
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { isAdmin?: unknown };
    return parsed?.isAdmin === true;
  } catch {
    return false;
  }
}

type ProviderProfile = {
  ProviderID?: string;
  Name?: string;
  Phone?: string;
  Verified?: string;
  OtpVerified?: string;
  OtpVerifiedAt?: string;
  PendingApproval?: string;
  Status?: string;
};

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: ProviderProfile;
  error?: string;
};

type NeedSummary = {
  NeedID?: string;
};

type MyNeedsResponse = {
  ok?: boolean;
  needs?: NeedSummary[];
};

type NeedThreadSummary = {
  UnreadPosterCount?: number;
};

type NeedThreadsResponse = {
  ok?: boolean;
  threads?: NeedThreadSummary[];
};

const formatPhone = (phone?: string | null) => {
  if (!phone) return "Guest";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "Guest";
  const lastTen = digits.slice(-10);
  return `+91 ${lastTen}`;
};

const normalizePhoneToTen = (value?: string | null) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
};

const isProviderVerified = (provider?: ProviderProfile | null) =>
  isProviderVerifiedBadge(provider ?? {});

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showProviderConfirm, setShowProviderConfirm] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(
    null
  );
  const [providerExists, setProviderExists] = useState<boolean | null>(null);
  const [myNeedsUnreadCount, setMyNeedsUnreadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  // "For your needs" section starts collapsed so the sidebar above the
  // fold is dominated by the active features (Home, My Activity, For
  // Providers, Help) rather than the launching-soon catalogue. Users
  // click the header chevron to expand. Stays as a simple controlled
  // boolean — no persistence needed.
  const [iNeedOpen, setINeedOpen] = useState(false);
  const [authHydrated, setAuthHydrated] = useState(false);
  const isLoggedIn = Boolean(session?.phone);
  const shouldHide = pathname?.startsWith("/admin");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; open?: boolean; close?: boolean }>).detail;
      if (detail?.type === "auth-updated") {
        setSession(getAuthSession());
        setIsAdmin(readAdminSession());
        setAuthHydrated(true);
        return;
      }
      if (detail?.open === true) {
        setIsOpen(true);
        return;
      }
      if (detail?.close === true) {
        setIsOpen(false);
        return;
      }
      const isDesktop =
        typeof window !== "undefined" &&
        window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop) {
        setIsCollapsed((prev) => !prev);
        setIsOpen(true);
      } else {
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateIsMobile = () => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      setIsMobile(!isDesktop);
    };
    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;
    const isSidebarVisible = isDesktop ? !shouldHide : isOpen && !shouldHide;
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_STATE_EVENT, {
        detail: { isOpen: isSidebarVisible, isCollapsed },
      })
    );
  }, [isOpen, isCollapsed, shouldHide, isMobile]);

  useEffect(() => {
    setSession(getAuthSession());
    setIsAdmin(readAdminSession());
    setAuthHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = () => {
      setSession(getAuthSession());
      const nextIsAdmin = readAdminSession();
      setIsAdmin(nextIsAdmin);
      if (nextIsAdmin) {
        setProviderProfile(null);
        return;
      }
      try {
        const raw = window.localStorage.getItem(PROVIDER_PROFILE_STORAGE_KEY);
        setProviderProfile(raw ? (JSON.parse(raw) as ProviderProfile) : null);
      } catch {
        setProviderProfile(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onProviderProfileUpdated = () => {
      // Logout race guard: an in-flight fetchProviderDashboardProfile() can
      // resolve AFTER handleLogout has already nulled state and cleared
      // localStorage. The helper writes the fresh payload back to
      // localStorage and dispatches this event, so without this check the
      // listener would re-read the just-written cache and re-populate
      // providerProfile, leaving the header showing the old provider name
      // and Phone Verified badge until the next page reload.
      if (!getAuthSession()) {
        setProviderProfile(null);
        return;
      }
      if (readAdminSession()) {
        setProviderProfile(null);
        return;
      }
      try {
        const raw = window.localStorage.getItem(PROVIDER_PROFILE_STORAGE_KEY);
        setProviderProfile(raw ? (JSON.parse(raw) as ProviderProfile) : null);
      } catch {
        setProviderProfile(null);
      }
    };
    window.addEventListener(PROVIDER_PROFILE_UPDATED_EVENT, onProviderProfileUpdated);
    return () =>
      window.removeEventListener(PROVIDER_PROFILE_UPDATED_EVENT, onProviderProfileUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAdmin) {
      setProviderProfile(null);
      window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
      return;
    }
    const phone = normalizePhoneToTen(session?.phone);
    if (!/^\d{10}$/.test(phone)) {
      setProviderProfile(null);
      window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
      return;
    }
    try {
      const cachedRaw = window.localStorage.getItem(PROVIDER_PROFILE_STORAGE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as ProviderProfile;
        if (
          normalizePhoneToTen(cached?.Phone || "") === phone &&
          String(cached?.Name || "").trim()
        ) {
          setProviderProfile(cached);
        }
      }
    } catch {
      setProviderProfile(null);
    }

    let ignore = false;
    const loadProviderProfile = async () => {
      try {
        // Shared helper: de-dupes the in-flight call with the dashboard
        // page's own fetch, persists to localStorage, and dispatches
        // PROVIDER_PROFILE_UPDATED_EVENT (which the listener below picks up).
        const data = await fetchProviderDashboardProfile();
        if (ignore) return;
        if (data?.ok && data.provider) {
          const raw = data.provider as ProviderProfile & { ProviderName?: string };
          const normalized: ProviderProfile = {
            ...raw,
            Name: raw.Name ?? raw.ProviderName,
          };
          setProviderProfile(normalized);
        } else if (data && data.ok === false) {
          // 404 / not-found path is handled inside the helper (clears
          // localStorage + dispatches event); reflect that locally too.
          setProviderProfile(null);
        }
      } catch {
        // Keep cached data/fallback in case of transient fetch issues.
      }
    };
    void loadProviderProfile();

    return () => {
      ignore = true;
    };
  }, [isAdmin, session?.phone]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let ignore = false;

    const resolveProviderExists = async () => {
      const lookupPhone = normalizePhoneToTen(session?.phone || "");

      if (!lookupPhone) {
        if (!ignore) setProviderExists(false);
        return;
      }

        try {
          const response = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(lookupPhone)}`,
            { cache: "no-store" }
          );
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (!ignore) {
          setProviderExists(Boolean(response.ok && data?.ok === true && data?.provider));
        }
      } catch {
        if (!ignore) setProviderExists(false);
      }
    };

    if (!isLoggedIn) {
      setProviderExists(false);
      return;
    }

    setProviderExists(null);
    void resolveProviderExists();

    const onRefresh = () => {
      void resolveProviderExists();
    };
    window.addEventListener(PROVIDER_PROFILE_UPDATED_EVENT, onRefresh);
    window.addEventListener("storage", onRefresh);
    return () => {
      ignore = true;
      window.removeEventListener(PROVIDER_PROFILE_UPDATED_EVENT, onRefresh);
      window.removeEventListener("storage", onRefresh);
    };
  }, [isLoggedIn, session?.phone]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // I-Need feature is publicly paused (see app/i-need/page.tsx). Skip the
    // unread-count polling so the sidebar does not hit /api/kk get_my_needs
    // and need_chat_get_threads_for_need on every page load. Flip this flag
    // back to true (or delete the gate entirely) when the feature relaunches.
    const I_NEED_FEATURE_ACTIVE = false;
    if (!I_NEED_FEATURE_ACTIVE) {
      setMyNeedsUnreadCount(0);
      return;
    }

    const phone = normalizePhoneToTen(session?.phone || "");
    if (!/^\d{10}$/.test(phone)) {
      setMyNeedsUnreadCount(0);
      return;
    }

    let ignore = false;

    const loadMyNeedsUnreadCount = async () => {
      try {
        const needsRes = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get_my_needs",
            UserPhone: phone,
          }),
          cache: "no-store",
        });

        const needsData = (await needsRes.json()) as MyNeedsResponse;
        if (!needsRes.ok || needsData?.ok !== true) {
          if (!ignore) setMyNeedsUnreadCount(0);
          return;
        }

        const needIds = (needsData.needs || [])
          .map((need) => String(need?.NeedID || "").trim())
          .filter(Boolean);

        if (!needIds.length) {
          if (!ignore) setMyNeedsUnreadCount(0);
          return;
        }

        const threadResponses = await Promise.all(
          needIds.map(async (needId) => {
            const response = await fetch("/api/kk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "need_chat_get_threads_for_need",
                NeedID: needId,
                UserPhone: phone,
              }),
              cache: "no-store",
            });

            const data = (await response.json()) as NeedThreadsResponse;
            return response.ok && data?.ok === true ? data.threads || [] : [];
          })
        );

        const unreadCount = threadResponses
          .flat()
          .reduce((sum, thread) => sum + (Number(thread?.UnreadPosterCount) || 0), 0);

        if (!ignore) setMyNeedsUnreadCount(unreadCount);
      } catch {
        if (!ignore) setMyNeedsUnreadCount(0);
      }
    };

    void loadMyNeedsUnreadCount();

    return () => {
      ignore = true;
    };
  }, [session?.phone]);

  useEffect(() => {
    if (!isLoggedIn) {
      if (typeof window === "undefined") {
        setIsCollapsed(false);
        return;
      }
      const isTablet =
        window.matchMedia("(min-width: 768px)").matches &&
        !window.matchMedia("(min-width: 1024px)").matches;
      setIsCollapsed(isTablet);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;
    const isSidebarVisible = isDesktop ? !shouldHide : isOpen && !shouldHide;
    // Collapsed icon rail tightened from 80px → 64px (industry-standard
    // icon-only nav width). Expanded sidebar trimmed from 288px → 256px
    // for ~32px more main-content room without truncating any current
    // nav label. Both values flow into the layout shell via the
    // `--kk-sidebar-width` CSS variable, so the main content shifts in
    // sync with the new rail.
    const width = !isSidebarVisible ? "0rem" : isCollapsed ? "64px" : "256px";
    const mobileHeaderHeight = "0px";
    const shell = document.getElementById("kk-app-shell");
    if (shell) {
      shell.style.setProperty("--kk-sidebar-width", width);
      shell.style.setProperty("--kk-mobile-header-height", mobileHeaderHeight);
    }
    return () => {
      const shellNode = document.getElementById("kk-app-shell");
      if (shellNode) {
        shellNode.style.removeProperty("--kk-sidebar-width");
        shellNode.style.removeProperty("--kk-mobile-header-height");
      }
    };
  }, [isCollapsed, shouldHide, isOpen, isLoggedIn, isMobile]);

  const handleLogout = async () => {
    // The signed kk_auth_session cookie is HttpOnly — only the server can
    // clear it. await /api/auth/logout (via clearAuthSession) before
    // redirecting so the next navigation does not still carry a valid
    // server-trusted cookie.
    setSession(null);
    setProviderProfile(null);
    setIsAdmin(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
    setIsOpen(false);
    // clearAuthSession() must run BEFORE dispatching `auth-updated`. The
    // dispatch fires our own listener synchronously, which re-reads
    // getAuthSession() from the kk_session_user cookie — if we dispatched
    // first, that listener would clobber setSession(null) above with the
    // still-present old session, leaving the sidebar visually logged in
    // and forcing the user to tap logout a second time.
    await clearAuthSession();
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_TOGGLE_EVENT, {
        detail: { type: "auth-updated" },
      })
    );
    router.push("/");
  };

  const handleProviderContinue = () => {
    setShowProviderConfirm(false);
    setIsOpen(false);
    if (isLoggedIn) {
      router.push("/provider/register");
      return;
    }
    router.push("/login?next=/provider/register");
  };

  if (shouldHide) {
    return null;
  }


  const myNeedsBadgeLabel = myNeedsUnreadCount > 9 ? "9+" : String(myNeedsUnreadCount);

  type NavLinkConfig = {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    showBadge?: boolean;
  };

  const renderNavLink = ({ label, href, icon: Icon, showBadge }: NavLinkConfig) => {
    const active = pathname === href;
    const isHome = label === "Home";
    const badgeVisible = Boolean(showBadge) && myNeedsUnreadCount > 0;
    return (
      <Link
        key={href}
        href={href}
        draggable={false}
        onClick={() => setIsOpen(false)}
        className={`flex items-center rounded-lg py-2 font-semibold text-white transition ${
          isCollapsed ? "justify-center px-0" : "gap-3 px-3"
        } ${
          active
            ? isHome
              ? "bg-transparent text-white ring-1 ring-inset ring-white/[0.12] hover:bg-white/[0.06]"
              : "bg-white/[0.18] text-white ring-1 ring-inset ring-white/10"
            : "hover:bg-white/[0.08] hover:text-white"
        }`}
      >
        <span className="relative inline-flex shrink-0">
          <Icon className="h-4 w-4 text-white/90" />
          {isCollapsed && badgeVisible ? (
            <span className="absolute -right-2 -top-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
              {myNeedsBadgeLabel}
            </span>
          ) : null}
        </span>
        {isCollapsed ? (
          <span className="sr-only">{label}</span>
        ) : (
          <>
            <span className="text-sm whitespace-nowrap">{label}</span>
            {badgeVisible ? (
              <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {myNeedsBadgeLabel}
              </span>
            ) : null}
          </>
        )}
      </Link>
    );
  };

  const renderSectionHeader = (label: string) =>
    isCollapsed ? (
      <div key={`section-${label}`} className="mx-2 my-2 border-t border-white/10" />
    ) : (
      <p
        key={`section-${label}`}
        className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-white/50"
      >
        {label}
      </p>
    );

  // Collapsible variant of `renderSectionHeader` used for the
  // "For your needs" group only. In the icon-rail (collapsed sidebar)
  // the divider is reused — there's no room for a chevron toggle and
  // the section's icon row remains visible so users can still tap into
  // /i-need from the rail.
  const renderForYourNeedsHeader = () =>
    isCollapsed ? (
      <div key="section-iNeed-divider" className="mx-2 my-2 border-t border-white/10" />
    ) : (
      <button
        key="section-iNeed-toggle"
        type="button"
        onClick={() => setINeedOpen((v) => !v)}
        aria-expanded={iNeedOpen}
        aria-controls="kk-iNeed-section"
        className="flex w-full items-center gap-2 rounded-md px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-white/50 transition hover:text-white/80"
      >
        <span>For your needs</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-white/50 transition-transform duration-200 ${
            iNeedOpen ? "rotate-0" : "-rotate-90"
          }`}
          aria-hidden="true"
        />
      </button>
    );

  // Launching Soon: I-Need feature is publicly paused. Sub-items are shown
  // for visibility (so users can see what's coming) but every sub-item routes
  // to /i-need (the Launching Soon page) — none open active flows. Restore
  // the original interactive routing (`/i-need?category=…`) from git history
  // alongside the I_NEED_FEATURE_ACTIVE flip when re-enabling the feature.
  const iNeedComingItems = [
    { label: "Naukri", emoji: "💼" },
    { label: "Property", emoji: "🏗️" },
    { label: "Rent", emoji: "🏠" },
    { label: "Buy-Sell", emoji: "🤝" },
  ];

  const postARequestButton = (
    <div key="post-a-request" id="kk-iNeed-section">
      <Link
        href="/i-need"
        onClick={() => setIsOpen(false)}
        className={`flex w-full items-center rounded-lg bg-transparent py-2 font-semibold text-white transition hover:bg-white/[0.06] ${
          isCollapsed ? "justify-center px-0" : "gap-3 px-3"
        }`}
      >
        <ListTodo className="h-4 w-4 shrink-0 text-white/90" />
        {isCollapsed ? (
          <span className="sr-only">Jodhpur ko chahiye — Launching Soon</span>
        ) : (
          <>
            <span className="text-sm whitespace-nowrap">Jodhpur ko chahiye</span>
            <span className="ml-auto rounded-full bg-orange-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Soon
            </span>
          </>
        )}
      </Link>

      {!isCollapsed && (
        <div className="ml-5 mt-1 space-y-0.5">
          {iNeedComingItems.map((item) => (
            <Link
              key={item.label}
              href="/i-need"
              onClick={() => setIsOpen(false)}
              aria-label={`${item.label} — coming soon`}
              title="Coming soon"
              className="flex w-full items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm text-white/70 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.10] hover:text-white/90"
            >
              <span aria-hidden>{item.emoji}</span>
              <span>{item.label}</span>
              <Lock className="ml-auto h-3 w-3 text-white/50" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  const registerProviderButton = (
    <button
      key="register-provider"
      type="button"
      onClick={() => setShowProviderConfirm(true)}
      className={`flex w-full items-center rounded-lg py-2 font-semibold text-white transition hover:bg-white/[0.08] hover:text-white ${
        isCollapsed ? "justify-center px-0" : "gap-3 px-3"
      }`}
    >
      <UserPlus className="h-4 w-4 text-white/90" />
      {isCollapsed ? (
        <span className="sr-only">Register as Service Provider</span>
      ) : (
        <span className="text-sm whitespace-nowrap">Register as Service Provider</span>
      )}
    </button>
  );

  const logoutButton = (
    <button
      key="logout"
      type="button"
      onClick={handleLogout}
      className={`flex w-full items-center rounded-lg py-2 font-semibold text-white transition hover:bg-white/[0.08] hover:text-white ${
        isCollapsed ? "justify-center px-0" : "gap-3 px-3"
      }`}
    >
      <LogOut className="h-4 w-4 text-white/90" />
      {isCollapsed ? (
        <span className="sr-only">Logout</span>
      ) : (
        <span className="text-sm whitespace-nowrap">Logout</span>
      )}
    </button>
  );

  const showProviderSection = providerExists === true || providerExists === false;

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setIsOpen(false)}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 min-h-screen overflow-hidden bg-[#003d20] text-white shadow-lg transition-all duration-200 flex flex-col ${
          isCollapsed ? "w-16" : "w-64"
        } ${isOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
        <div
          className={`flex items-center gap-2 border-b border-white/10 py-3 ${
            isCollapsed ? "justify-center px-2" : "px-3"
          }`}
        >
          {!isCollapsed && (
            <div className="flex flex-col leading-tight select-none">
              <p className="text-base font-semibold text-white">Kaun Karega</p>
              {isAdmin ? (
                <>
                  <p className="text-sm font-semibold text-white">Admin</p>
                  <p className="text-xs text-white/80">Admin Console</p>
                </>
              ) : providerProfile?.Name ? (
                <>
                  <p className="text-sm font-semibold text-white">
                    {providerProfile.Name}
                  </p>
                  <p className="text-xs text-white/80">
                    Registered Service Provider
                  </p>
                  <span
                    className={`mt-1 inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      isProviderVerified(providerProfile)
                        ? "border-green-200 bg-green-100 text-green-800"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {isProviderVerified(providerProfile)
                      ? "Phone Verified"
                      : String(providerProfile?.PendingApproval || "").toLowerCase() === "yes"
                        ? "Pending Admin Approval"
                        : "Not Verified"}
                  </span>
                </>
              ) : !authHydrated ? (
                <div className="space-y-2 py-1" aria-label="Loading sidebar">
                  <div className="h-3 w-28 rounded bg-white/20" />
                  <div className="h-2.5 w-20 rounded bg-white/15" />
                </div>
              ) : (
                <p className="min-h-[52px] text-xs text-white/70">
                  Hi!{" "}
                  <span className="font-semibold">
                    {formatPhone(session?.phone)}
                  </span>
                </p>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            {isMobile ? (
              isOpen && (
                <button
                  type="button"
                  aria-label="Close sidebar"
                  onClick={() => setIsOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-white transition hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              )
            ) : (
              <button
                type="button"
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setIsCollapsed((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-white transition hover:bg-white/10"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>

        <nav
          className={`flex-1 overflow-hidden py-4 select-none ${
            isCollapsed ? "px-2" : "px-3"
          }`}
        >
          <div className="space-y-2">
            {!authHydrated ? (
              <div className="space-y-2" aria-label="Loading sidebar navigation">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-9 rounded-lg bg-white/[0.10]" />
                ))}
              </div>
            ) : !isLoggedIn ? (
              <>
                {renderNavLink({ label: "Home", href: "/", icon: Home })}
                {renderNavLink({ label: "Login", href: "/login", icon: LogIn })}
              </>
            ) : (
              <>
                {renderNavLink({ label: "Home", href: "/", icon: Home })}

                {renderForYourNeedsHeader()}
                {/* When the sidebar is collapsed (icon rail), the section
                    is always visible — the toggle UX only applies in the
                    expanded sidebar. This preserves rail-mode access to
                    /i-need without forcing users to expand first. */}
                {(isCollapsed || iNeedOpen) && postARequestButton}

                {renderSectionHeader("MY ACTIVITY")}
                {/* "My Posts" hidden while I-Need is paused — it points at
                    /i-need/my-needs which now redirects to /i-need (Launching
                    Soon). Restore alongside the I-Need feature re-enable. */}
                {renderNavLink({
                  label: "My Requests",
                  href: "/dashboard/my-requests",
                  icon: ClipboardList,
                })}

                {showProviderSection ? (
                  <>
                    {renderSectionHeader("FOR PROVIDERS")}
                    {providerExists === true ? (
                      <>
                        {renderNavLink({
                          label: "Dashboard",
                          href: "/provider/dashboard",
                          icon: LayoutDashboard,
                        })}
                        {renderNavLink({
                          label: "My Jobs",
                          href: "/provider/my-jobs",
                          icon: Briefcase,
                        })}
                      </>
                    ) : null}
                    {providerExists === false ? registerProviderButton : null}
                  </>
                ) : null}

                {isAdmin ? (
                  <>
                    {renderSectionHeader("ADMIN")}
                    {renderNavLink({
                      label: "Admin Dashboard",
                      href: "/admin/dashboard",
                      icon: ShieldCheck,
                    })}
                  </>
                ) : null}

                {renderSectionHeader("HELP")}
                {renderNavLink({
                  label: "Report an Issue",
                  href: "/report-issue",
                  icon: MessageSquareWarning,
                })}
                {logoutButton}
              </>
            )}
          </div>
        </nav>
      </aside>
      {showProviderConfirm && providerExists === false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-slate-900">
              Become a Service Provider
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Register as a provider to receive nearby work requests on WhatsApp.
              You can choose services and areas. Takes 1 minute.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowProviderConfirm(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProviderContinue}
                className="rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00542b]"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


