"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";

const BASE_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL!;
const MAX_SERVICES = 3;
const MAX_AREAS = 5;

type ProviderProfile = {
  ProviderID: string;
  ProviderName: string;
  Phone: string;
  Verified: string;
  PendingApproval?: string;
  Status?: string;
  Services: { Category: string }[];
  Areas: { Area: string }[];
};

type ProviderByPhoneResponse = {
  ok?: boolean;
  provider?: ProviderProfile;
  error?: string;
  debug?: unknown;
};

type ProviderLeadsResponse = {
  ok?: boolean;
  leads?: unknown[];
};

function normalizePhone10(phoneRaw: string): string {
  const digits = String(phoneRaw || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function parseJsonSafe<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function maskPhoneForDebug(phone10: string): string {
  if (!phone10) return "-";
  if (phone10.length < 4) return "****";
  return "******" + phone10.slice(-4);
}

export default function ProviderDashboardPage() {
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [leads, setLeads] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState("");
  const [apiDebug, setApiDebug] = useState<unknown>(null);
  const [debugPhone, setDebugPhone] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedPhone =
      window.localStorage.getItem("kk_provider_phone") ||
      window.localStorage.getItem("kk_user_phone") ||
      window.localStorage.getItem("kk_last_phone") ||
      window.localStorage.getItem("kk_phone") ||
      "";
    const phone10 = normalizePhone10(storedPhone);
    if (phone10) {
      setPhone(phone10);
      setDebugPhone(maskPhoneForDebug(phone10));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!phone) return;

    let ignore = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setApiError("");
      setApiDebug(null);
      try {
        const profileRes = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const profileText = await profileRes.text();
        const profileData = parseJsonSafe<ProviderByPhoneResponse>(profileText);
        if (!profileRes.ok) {
          throw new Error(`HTTP ${profileRes.status} while loading provider profile.`);
        }
        if (!profileData) {
          throw new Error("Invalid JSON from provider profile API.");
        }
        if (!profileData.ok) {
          const code = profileData.error || "UNKNOWN_ERROR";
          setApiError(code);
          setApiDebug(profileData.debug ?? null);
          setError(code);
          setProfile(null);
          return;
        }
        if (!profileData.provider) {
          throw new Error("Provider profile API returned ok:true without provider.");
        }

        if (ignore) return;
        setProfile(profileData.provider);

        if (typeof window !== "undefined") {
          window.localStorage.setItem("kk_provider_phone", phone);
          window.localStorage.setItem("kk_provider_id", profileData.provider.ProviderID || "");
          window.localStorage.setItem("kk_user_role", "provider");
          window.localStorage.setItem(
            "kk_provider_profile",
            JSON.stringify({
              ProviderID: profileData.provider.ProviderID,
              Name: profileData.provider.ProviderName,
              Phone: profileData.provider.Phone,
              Verified: profileData.provider.Verified,
              PendingApproval: profileData.provider.PendingApproval,
              Status:
                profileData.provider.Status ||
                (String(profileData.provider.PendingApproval || "").toLowerCase() === "yes"
                  ? "Pending Admin Approval"
                  : String(profileData.provider.Verified || "").toLowerCase() === "yes"
                  ? "Active"
                  : "Pending Verification"),
            })
          );
          window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
        }

        const leadsRes = await fetch(
          `${BASE_URL}?action=get_provider_leads&providerId=${encodeURIComponent(
            profileData.provider.ProviderID || ""
          )}`,
          { cache: "no-store" }
        );
        const leadsText = await leadsRes.text();
        const leadsData = parseJsonSafe<ProviderLeadsResponse>(leadsText);
        if (!ignore && leadsRes.ok && leadsData?.ok && Array.isArray(leadsData.leads)) {
          setLeads(leadsData.leads);
        } else if (!ignore) {
          setLeads([]);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Unable to load provider dashboard.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();
    return () => {
      ignore = true;
    };
  }, [phone]);

  const verified = useMemo(
    () => String(profile?.Verified || "").trim().toLowerCase() === "yes",
    [profile]
  );
  const pendingApproval = useMemo(
    () => String(profile?.PendingApproval || "").trim().toLowerCase() === "yes",
    [profile]
  );
  const servicesCount = profile?.Services.length ?? 0;
  const areasCount = profile?.Areas.length ?? 0;
  const statusLabel = verified
    ? "Verified"
    : pendingApproval
    ? "Pending Admin Approval"
    : "Pending Verification";
  const verificationMessage = verified
    ? "Status: Verified and active"
    : pendingApproval
    ? "Status: Pending admin approval for new category review"
    : "Status: Under review";
  const emptyRequestsMessage = verified
    ? "No requests yet. Customer requests in your selected services and areas will appear here."
    : "No requests yet. Customer requests in your selected services and areas will appear here. Verified providers get higher priority.";

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading provider dashboard...
        </div>
      </main>
    );
  }

  if (!phone) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-base font-semibold text-slate-900">
            Please login. Invalid or missing provider phone.
          </p>
          <Link
            href="/provider/login"
            className="mt-3 inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600"
          >
            Go to Provider Login
          </Link>
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-700">
            {error || "Unable to load provider dashboard."}
          </p>
          {apiError ? <p className="mt-1 text-xs text-rose-700">Error: {apiError}</p> : null}
          {debugPhone ? (
            <p className="mt-1 text-xs text-rose-700">Request phone: {debugPhone}</p>
          ) : null}
          {process.env.NODE_ENV !== "production" && apiDebug ? (
            <pre className="mt-3 max-h-44 overflow-auto rounded border border-rose-200 bg-rose-100 p-2 text-[10px] leading-relaxed text-rose-900">
              {JSON.stringify(apiDebug, null, 2)}
            </pre>
          ) : null}
          <Link
            href="/provider/register"
            className="mt-4 inline-flex rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            Register as Provider
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Provider Dashboard
              </p>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">{profile.ProviderName}</h1>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Registered Service Provider
                </p>
              </div>
              <div className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                ProviderID: {profile.ProviderID}
              </div>
              <p className="text-sm text-slate-600">{verificationMessage}</p>
            </div>
            <span
              className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
                verified
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : pendingApproval
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-slate-100 text-slate-700"
              }`}
            >
              {statusLabel}
            </span>
          </div>
        </section>

        {!verified ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-900">
              {pendingApproval ? "Pending Admin Approval" : "Profile Verification Pending"}
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              {pendingApproval
                ? "Your profile was saved successfully, but one or more selected categories are new and waiting for admin approval. You can still access your dashboard while the request is reviewed."
                : "Your profile is currently under review by Kaun Karega. You can still access your dashboard, and verified providers will get higher priority in customer matching."}
            </p>
            <p className="mt-2 text-sm font-medium text-amber-900/90">
              Complete your profile and keep your phone active to improve trust.
            </p>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">What You Can Do Now</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span>Add up to 3 services</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-sky-500" />
              <span>Add up to 5 areas</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-slate-400" />
              <span>Keep your phone active for customer calls</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span>Verified providers get higher request priority</span>
            </li>
          </ul>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Services ({servicesCount}/{MAX_SERVICES})
                </h2>
                {servicesCount === MAX_SERVICES ? (
                  <p className="mt-1 text-xs text-slate-500">Maximum services selected</p>
                ) : null}
              </div>
              <Link
                href="/provider/register?edit=services"
                className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
              >
                Edit
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {profile.Services.length ? (
                profile.Services.map((service) => (
                  <span
                    key={service.Category}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                  >
                    {service.Category}
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-500">No services added yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Areas ({areasCount}/{MAX_AREAS})
                </h2>
                {areasCount === MAX_AREAS ? (
                  <p className="mt-1 text-xs text-slate-500">Maximum areas selected</p>
                ) : null}
              </div>
              <Link
                href="/provider/register?edit=areas"
                className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
              >
                Edit
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {profile.Areas.length ? (
                profile.Areas.map((area) => (
                  <span
                    key={area.Area}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700"
                  >
                    {area.Area}
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-500">No service areas added yet.</p>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Requests near you</h2>
          {leads.length ? (
            <p className="mt-2 text-sm text-slate-700">{leads.length} request(s) available.</p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{emptyRequestsMessage}</p>
          )}
        </section>
      </div>
    </main>
  );
}
