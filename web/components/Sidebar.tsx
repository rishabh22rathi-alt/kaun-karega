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
  User,
  LayoutDashboard,
  LogOut,
  LogIn,
  UserPlus,
} from "lucide-react";
import {
  PROVIDER_PROFILE_UPDATED_EVENT,
  SIDEBAR_STATE_EVENT,
  SIDEBAR_TOGGLE_EVENT,
} from "./sidebarEvents";
import { clearAuthSession, getAuthSession } from "@/lib/auth";

const BASE_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL!;
const PROVIDER_PROFILE_STORAGE_KEY = "kk_provider_profile";

type NavItem = {
  label: string;
  href: string;
};

type ProviderProfile = {
  ProviderID?: string;
  Name?: string;
  Phone?: string;
  Verified?: string;
  Status?: string;
};

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: ProviderProfile;
  error?: string;
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
  String(provider?.Verified || "").trim().toLowerCase() === "yes";

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
  const isLoggedIn = Boolean(session?.phone);
  const shouldHide = pathname?.startsWith("/admin");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.type === "auth-updated") {
        setSession(getAuthSession());
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
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = () => {
      setSession(getAuthSession());
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
        const response = await fetch(
          `${BASE_URL}?action=get_provider_profile&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const data = (await response.json()) as ProviderProfileResponse;
        if (!ignore && data?.ok && data.provider) {
          setProviderProfile(data.provider);
          window.localStorage.setItem(
            PROVIDER_PROFILE_STORAGE_KEY,
            JSON.stringify(data.provider)
          );
        } else if (!ignore && data?.error === "NOT_FOUND") {
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
  }, [session?.phone]);

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
  }, [isCollapsed, shouldHide, isOpen, isLoggedIn]);

  const navItems: NavItem[] = isLoggedIn
    ? [
        { label: "Home", href: "/" },
        { label: "My Requests", href: "/dashboard/my-requests" },
        ...(providerExists === true
          ? [{ label: "Provider Dashboard", href: "/provider/dashboard" }]
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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
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
      Profile: User,
      "Provider Dashboard": LayoutDashboard,
      Login: LogIn,
      "Register as Service Provider": UserPlus,
      Logout: LogOut,
    };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity ${
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
              {providerProfile?.Name ? (
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
                      ? "Verified"
                      : "Pending Verification"}
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
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 font-semibold text-white transition ${
                  active
                    ? "bg-white/20 text-white shadow-sm"
                    : "hover:bg-white/10 hover:text-white"
                }`}
              >
                {Icon && (
                  <Icon className="h-4 w-4 text-white/90" />
                )}
                {isCollapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <span className="text-sm whitespace-nowrap">
                    {item.label}
                  </span>
                )}
              </Link>
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


