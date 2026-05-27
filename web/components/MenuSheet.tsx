"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X,
  UserPlus,
  MessageSquareWarning,
  ShieldCheck,
  Settings,
  LogOut,
  LogIn,
} from "lucide-react";
import {
  PROVIDER_PROFILE_UPDATED_EVENT,
  SIDEBAR_TOGGLE_EVENT,
} from "./sidebarEvents";
import { clearAuthSession, getAuthSession, type AuthSession } from "@/lib/auth";
import { isProviderVerifiedBadge } from "@/lib/providerPresentation";
import { fetchProviderDashboardProfile } from "@/lib/providerDashboardProfile";
import InstallAppMenuRow from "./pwa/InstallAppMenuRow";

const PROVIDER_PROFILE_STORAGE_KEY = "kk_provider_profile";
const ADMIN_SESSION_STORAGE_KEY = "kk_admin_session";

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

type Props = {
  open: boolean;
  onClose: () => void;
  session: AuthSession | null;
  isAdmin: boolean;
  providerExists: boolean | null;
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

function readCachedProviderProfile(
  session: AuthSession | null,
  isAdmin: boolean
): ProviderProfile | null {
  if (typeof window === "undefined") return null;
  if (isAdmin) return null;
  const phone = normalizePhoneToTen(session?.phone);
  if (!/^\d{10}$/.test(phone)) return null;
  try {
    const raw = window.localStorage.getItem(PROVIDER_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as ProviderProfile;
    if (
      normalizePhoneToTen(cached?.Phone || "") === phone &&
      String(cached?.Name || "").trim()
    ) {
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}

export default function MenuSheet({
  open,
  onClose,
  session,
  isAdmin,
  providerExists,
}: Props) {
  const router = useRouter();
  const isLoggedIn = Boolean(session?.phone);
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(
    () => readCachedProviderProfile(session, isAdmin)
  );
  const [showProviderConfirm, setShowProviderConfirm] = useState(false);

  // React 19's recommended pattern for "reset/derive state when a prop
  // changes" — call setState during render guarded by a tracked-key check.
  // Replaces a useEffect that did the same synchronous reset, which the
  // react-hooks/set-state-in-effect lint rule flags. Also re-seeds from
  // the kk_provider_profile cache when session or role flips.
  const currentInputsKey = `${session?.phone ?? ""}:${isAdmin ? "1" : "0"}`;
  const [trackedInputsKey, setTrackedInputsKey] = useState(currentInputsKey);
  if (trackedInputsKey !== currentInputsKey) {
    setTrackedInputsKey(currentInputsKey);
    setProviderProfile(readCachedProviderProfile(session, isAdmin));
  }

  // Async refresh from the dashboard endpoint. Mirrors the Sidebar's
  // logout-race guard: an in-flight fetchProviderDashboardProfile() can
  // resolve AFTER logout cleared everything, so the listener below also
  // checks getAuthSession() before re-reading the cache. Without it the
  // badge would resurrect for a logged-out user until the next reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAdmin || !isLoggedIn) return;

    let ignore = false;
    const load = async () => {
      try {
        const data = await fetchProviderDashboardProfile();
        if (ignore) return;
        if (data?.ok && data.provider) {
          const raw = data.provider as ProviderProfile & { ProviderName?: string };
          setProviderProfile({
            ...raw,
            Name: raw.Name ?? raw.ProviderName,
          });
        } else if (data && data.ok === false) {
          setProviderProfile(null);
        }
      } catch {
        // Keep cached value on transient failure.
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [session, isAdmin, isLoggedIn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onProviderProfileUpdated = () => {
      if (!getAuthSession()) {
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
    window.addEventListener(
      PROVIDER_PROFILE_UPDATED_EVENT,
      onProviderProfileUpdated
    );
    return () => {
      window.removeEventListener(
        PROVIDER_PROFILE_UPDATED_EVENT,
        onProviderProfileUpdated
      );
    };
  }, []);

  // ESC + body scroll lock while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const handleLogout = async () => {
    // Logout sequence — identical ordering to the desktop Sidebar's
    // handleLogout. Order matters: clearAuthSession() must finish BEFORE
    // dispatching `auth-updated`, otherwise the listener re-reads the
    // still-present cookie and the UI snaps back to logged-in.
    setProviderProfile(null);
    setShowProviderConfirm(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PROVIDER_PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
    onClose();
    await clearAuthSession();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_TOGGLE_EVENT, {
          detail: { type: "auth-updated" },
        })
      );
    }
    router.push("/");
  };

  const handleProviderContinue = () => {
    setShowProviderConfirm(false);
    onClose();
    if (isLoggedIn) {
      router.push("/provider/register");
      return;
    }
    router.push("/login?next=/provider/register");
  };

  if (!open) {
    return null;
  }

  const identityLine = isAdmin
    ? "Admin"
    : providerProfile?.Name
      ? providerProfile.Name
      : formatPhone(session?.phone);

  const identitySub = isAdmin
    ? "Admin Console"
    : providerProfile?.Name
      ? "Registered Service Provider"
      : isLoggedIn
        ? "Signed in"
        : "Not signed in";

  const showRegisterCta =
    isLoggedIn && !isAdmin && providerExists === false;
  // "Notification Settings" row — splits by role so the destination
  // matches the surface the user actually has preferences on. The
  // user variant uses `!== true` so it also renders during the brief
  // window when providerExists is still null (in-flight provider
  // lookup). Otherwise the menu would show no settings row at all
  // for the first paint, which is a UX regression. Confirmed-provider
  // sessions swap to the provider variant once the API resolves.
  const showProviderNotificationSettings =
    isLoggedIn && !isAdmin && providerExists === true;
  const showUserNotificationSettings =
    isLoggedIn && !isAdmin && providerExists !== true;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[55] bg-slate-900/40 md:hidden"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-x-0 bottom-0 z-[55] flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.18)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-[#003d20]">Menu</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-[#003d20]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Identity card */}
          <div className="border-b border-slate-100 px-4 py-4">
            <p className="text-sm font-semibold text-[#003d20]">{identityLine}</p>
            <p className="mt-0.5 text-xs text-slate-500">{identitySub}</p>
            {!isAdmin && providerProfile?.Name ? (
              <span
                className={`mt-2 inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
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
            ) : null}
          </div>

          <div className="px-2 py-2">
            {!isLoggedIn ? (
              <Link
                href="/login"
                onClick={onClose}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
              >
                <LogIn className="h-4 w-4 text-[#003d20]" />
                <span>Login</span>
              </Link>
            ) : null}

            {showRegisterCta ? (
              <button
                type="button"
                onClick={() => setShowProviderConfirm(true)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
              >
                <UserPlus className="h-4 w-4 text-[#003d20]" />
                <span>Register as Service Provider</span>
              </button>
            ) : null}

            {/* PWA Install / Add-to-Home-Screen — positioned above
                Notification Settings so it sits prominently at the top
                of the action list once the user is past the identity
                card. Self-hides only when the app is already installed
                (display-mode standalone, navigator.standalone, or
                kk_pwa_installed flag). On click, routes to the
                correct path (iOS sheet / native prompt / Android
                fallback sheet) via usePwaInstall.installPath. */}
            <InstallAppMenuRow onClose={onClose} />

            {showProviderNotificationSettings ? (
              <Link
                href="/provider/notifications"
                onClick={onClose}
                data-testid="menu-notification-settings"
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
              >
                <Settings className="h-4 w-4 text-[#003d20]" />
                <span>Notification Settings</span>
              </Link>
            ) : null}

            {showUserNotificationSettings ? (
              <Link
                href="/dashboard/notifications"
                onClick={onClose}
                data-testid="menu-notification-settings"
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
              >
                <Settings className="h-4 w-4 text-[#003d20]" />
                <span>Notification Settings</span>
              </Link>
            ) : null}

            <Link
              href="/report-issue"
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
            >
              <MessageSquareWarning className="h-4 w-4 text-[#003d20]" />
              <span>Report an Issue</span>
            </Link>

            {isAdmin ? (
              <Link
                href="/admin/dashboard"
                onClick={onClose}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
              >
                <ShieldCheck className="h-4 w-4 text-[#003d20]" />
                <span>Admin Dashboard</span>
              </Link>
            ) : null}

            {isLoggedIn ? (
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2 flex w-full items-center gap-3 rounded-lg border-t border-slate-100 px-3 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
              >
                <LogOut className="h-4 w-4 text-red-600" />
                <span>Logout</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Register-as-Provider confirm modal — portal-equivalent z-index so
          it stacks above the sheet's backdrop. Identical copy to the
          desktop Sidebar's modal so the flow stays familiar. */}
      {showProviderConfirm && providerExists === false ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 md:hidden">
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
      ) : null}
    </>
  );
}
