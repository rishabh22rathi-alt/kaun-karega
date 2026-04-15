"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Home,
  ClipboardList,
  MessageSquareWarning,
  User,
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  LogIn,
  UserPlus,
  ListTodo,
} from "lucide-react";
import {
  PROVIDER_PROFILE_UPDATED_EVENT,
  SIDEBAR_STATE_EVENT,
  SIDEBAR_TOGGLE_EVENT,
} from "./sidebarEvents";
import { clearAuthSession, getAuthSession } from "@/lib/auth";
import { isProviderVerifiedBadge } from "@/lib/providerPresentation";

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

type NavItem = {
  label: string;
  href: string;
};

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
  const [session, setSession] = useState<ReturnType<typeof getAuthSession>>(
    null
  );
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(
    null
  );
  const [providerExists, setProviderExists] = useState<boolean | null>(null);
  const [myNeedsUnreadCount, setMyNeedsUnreadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [iNeedOpen, setINeedOpen] = useState(false);
  const isLoggedIn = Boolean(session?.phone);
  const shouldHide = pathname?.startsWith("/admin");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; open?: boolean; close?: boolean }>).detail;
      if (detail?.type === "auth-updated") {
        setSession(getAuthSession());
        setIsAdmin(readAdminSession());
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
  }, [isOpen, isCollapsed, shouldHide]);

  useEffect(() => {
    setSession(getAuthSession());
    setIsAdmin(readAdminSession());
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
        const response = await fetch("/api/provider/dashboard-profile", { cache: "no-store" });
        const data = (await response.json()) as ProviderProfileResponse;
        if (!ignore && data?.ok && data.provider) {
          setProviderProfile(data.provider);
          window.localStorage.setItem(
            PROVIDER_PROFILE_STORAGE_KEY,
            JSON.stringify(data.provider)
          );
        } else if (!ignore && response.status === 404) {
          setProviderProfile(null);
          window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
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
      setIsCollapsed(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isDesktop =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;
    const isSidebarVisible = isDesktop ? !shouldHide : isOpen && !shouldHide;
    const width = !isSidebarVisible ? "0rem" : isCollapsed ? "80px" : "288px";
    const shell = document.getElementById("kk-app-shell");
    if (shell) {
      shell.style.setProperty("--kk-sidebar-width", width);
    }
    return () => {
      const shellNode = document.getElementById("kk-app-shell");
      if (shellNode) {
        shellNode.style.removeProperty("--kk-sidebar-width");
      }
    };
  }, [isCollapsed, shouldHide, isOpen, isLoggedIn, isMobile]);

  const navItems: NavItem[] = isLoggedIn
      ? [
        { label: "Home", href: "/" },
        { label: "My Requests", href: "/dashboard/my-requests" },
        { label: "My Needs", href: "/i-need/my-needs" },
        { label: "Report an Issue", href: "/report-issue" },
        ...(providerExists === true
          ? [{ label: "Provider Dashboard", href: "/provider/dashboard" }]
          : []),
        ...(isAdmin
          ? [{ label: "Admin Dashboard", href: "/admin/dashboard" }]
          : []),
      ]
    : [
        { label: "Home", href: "/" },
        { label: "Login", href: "/login" },
      ];

  const handleLogout = () => {
    clearAuthSession();
    setSession(null);
    setProviderProfile(null);
    setIsAdmin(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
    setIsOpen(false);
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


  const iconByLabel: Record<string, React.ComponentType<{ className?: string }>> =
    {
      Home: Home,
      "My Requests": ClipboardList,
      "My Needs": ClipboardList,
      "Report an Issue": MessageSquareWarning,
      Profile: User,
      "Provider Dashboard": LayoutDashboard,
      "Admin Dashboard": ShieldCheck,
      Login: LogIn,
      "Register as Service Provider": UserPlus,
      Logout: LogOut,
    };

  const myNeedsBadgeLabel = myNeedsUnreadCount > 9 ? "9+" : String(myNeedsUnreadCount);

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
          isCollapsed ? "w-20" : "w-72"
        } ${isOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
          {!isCollapsed && (
            <div className="flex flex-col leading-tight">
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
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
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
              ) : (
                <p className="text-xs text-white/70">
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

        <nav className="flex-1 px-3 py-4 space-y-2 overflow-hidden">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = iconByLabel[item.label];
            const showMyNeedsBadge = item.label === "My Needs" && myNeedsUnreadCount > 0;
            return (
              <div key={item.href}>
                {item.label === "Home" && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setINeedOpen((v) => !v)}
                      className="flex w-full items-center gap-3 rounded-lg border-l-4 border-orange-400 bg-orange-100 px-3 py-2 font-semibold text-orange-700 transition hover:bg-orange-200"
                    >
                      <ListTodo className="h-4 w-4 shrink-0 text-orange-600" />
                      {isCollapsed ? (
                        <span className="sr-only">I NEED</span>
                      ) : (
                        <>
                          <span className="text-sm whitespace-nowrap">I NEED</span>
                          <ChevronRight
                            className={`ml-auto h-3.5 w-3.5 text-orange-500 transition-transform duration-200 ${iNeedOpen ? "rotate-90" : ""}`}
                          />
                        </>
                      )}
                    </button>

                    {iNeedOpen && !isCollapsed && (
                      <div className="ml-7 mt-0.5 space-y-0.5">
                        {[
                          { label: "Naukri", emoji: "💼", category: "Employer" },
                          { label: "Property", emoji: "🏗️", category: "Property Buyer" },
                          { label: "Rent", emoji: "🏠", category: "Tenant" },
                          { label: "Buy / Sell", emoji: "🤝", category: "Vehicle Buyer" },
                        ].map((needItem) => (
                          <button
                            key={needItem.label}
                            type="button"
                            onClick={() => {
                              setIsOpen(false);
                              router.push(`/i-need?category=${encodeURIComponent(needItem.category)}`);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-orange-700 transition hover:bg-orange-100"
                          >
                            <span>{needItem.emoji}</span>
                            {needItem.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <Link
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 font-semibold text-white transition ${
                    active
                      ? "bg-white/20 text-white shadow-sm"
                      : "hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {Icon && (
                    <span className="relative inline-flex shrink-0">
                      <Icon className="h-4 w-4 text-white/90" />
                      {isCollapsed && showMyNeedsBadge ? (
                        <span className="absolute -right-2 -top-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-violet-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                          {myNeedsBadgeLabel}
                        </span>
                      ) : null}
                    </span>
                  )}
                  {isCollapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <>
                      <span className="text-sm whitespace-nowrap">
                        {item.label}
                      </span>
                      {showMyNeedsBadge ? (
                        <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-violet-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                          {myNeedsBadgeLabel}
                        </span>
                      ) : null}
                    </>
                  )}
                </Link>
              </div>
            );
          })}
          {providerExists === false ? (
            <button
              type="button"
              onClick={() => setShowProviderConfirm(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-semibold text-white transition hover:bg-white/10 hover:text-white"
            >
              <UserPlus className="h-4 w-4 text-white/90" />
              {isCollapsed ? (
                <span className="sr-only">Register as Service Provider</span>
              ) : (
                <span className="text-sm whitespace-nowrap">
                  Register as Service Provider
                </span>
              )}
            </button>
          ) : null}
          {session?.phone && (
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-semibold text-white transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4 text-white/90" />
              {isCollapsed ? (
                <span className="sr-only">Logout</span>
              ) : (
                <span className="text-sm whitespace-nowrap">Logout</span>
              )}
            </button>
          )}
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


