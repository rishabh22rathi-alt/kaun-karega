"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import { normalizeVerifiedValue } from "@/lib/providerPresentation";

type SuccessClientProps = {
  service: string;
  area: string;
  taskId?: string;
  displayId?: string;
  userPhone?: string;
  status?: string;
  requestRef?: string;
};

type ProviderItem = {
  name: string;
  // Masked display value, e.g. "98XXXXXX21". Always present.
  phoneMasked: string;
  // Raw 10-digit phone. Server returns this ONLY when the signed-in
  // session is the verified owner of the requested taskId. Anonymous /
  // unrelated users get an empty string here and fall back to
  // phoneMasked for display.
  phone: string;
  providerId: string;
  category: string;
  area: string;
  rating: string;
  verified: "yes" | "no";
};

type MatchProvidersResponse = {
  providers?: unknown[];
};

const clean = (s: string) => (s || "").trim().replace(/\s+/g, " ");

function toProviderItem(item: unknown): ProviderItem | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const name =
    (typeof record.name === "string" && record.name.trim()) ||
    (typeof record.provider_name === "string" && record.provider_name.trim()) ||
    (typeof record.ProviderName === "string" && record.ProviderName.trim()) ||
    "";
  const phoneMasked =
    (typeof record.phoneMasked === "string" && record.phoneMasked.trim()) ||
    (typeof record.PhoneMasked === "string" && record.PhoneMasked.trim()) ||
    "";
  // Raw phone is server-gated: present only when the signed-in caller is
  // the verified task owner. Anonymous / unrelated users leave this empty.
  const phoneRaw =
    (typeof record.phone === "string" && record.phone.trim()) ||
    (typeof record.Phone === "string" && record.Phone.trim()) ||
    "";
  const phone = /^\d{10}$/.test(phoneRaw.replace(/\D/g, "").slice(-10))
    ? phoneRaw.replace(/\D/g, "").slice(-10)
    : "";
  const providerId =
    (typeof record.ProviderID === "string" && record.ProviderID.trim()) ||
    (typeof record.providerId === "string" && record.providerId.trim()) ||
    "";
  const category =
    (typeof record.category === "string" && record.category.trim()) ||
    (typeof record.Category === "string" && record.Category.trim()) ||
    "";
  const area =
    (typeof record.area === "string" && record.area.trim()) ||
    (typeof record.Area === "string" && record.Area.trim()) ||
    "";
  const ratingValue =
    record.rating ??
    record.Rating ??
    record.average_rating ??
    record.averageRating ??
    record.review_rating;
  const rating =
    typeof ratingValue === "number"
      ? String(ratingValue)
      : typeof ratingValue === "string"
        ? ratingValue.trim()
        : "";
  if (!name) return null;
  return {
    name,
    phoneMasked,
    phone,
    providerId,
    category,
    area,
    rating,
    verified: normalizeVerifiedValue(record.verified),
  };
}

export default function SuccessClient({
  service,
  area,
  taskId = "",
  displayId = "",
  userPhone = "",
  status = "",
  requestRef = "",
}: SuccessClientProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [notificationStatus, setNotificationStatus] = useState<
    "idle" | "queued" | "processing" | "done" | "error"
  >(taskId ? "queued" : "idle");
  const triggerStartedRef = useRef(false);

  const canFetchProviders = useMemo(
    () => Boolean(service && area),
    [service, area]
  );
  const taskDisplayLabel = useMemo(
    () => getTaskDisplayLabel({ TaskID: taskId, DisplayID: displayId }, taskId),
    [displayId, taskId]
  );
  const notificationStatusMessage = useMemo(() => {
    if (notificationStatus === "error") {
      return "We could not notify providers right now. Please try again shortly.";
    }
    return "";
  }, [notificationStatus]);

  useEffect(() => {
    if (!taskId || triggerStartedRef.current) return;

    const storageKey = `kk_notified_${taskId}`;
    if (sessionStorage.getItem(storageKey)) {
      console.log(
        "[success] notification skipped, already triggered for task",
        taskId
      );
      return;
    }

    triggerStartedRef.current = true;
    console.log("[success] notification trigger allowed for task", taskId);
    setNotificationStatus("queued");

    const timer = window.setTimeout(async () => {
      sessionStorage.setItem(storageKey, "1");
      setNotificationStatus("processing");

      try {
        const res = await fetch("/api/process-task-notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId }),
          cache: "no-store",
        });

        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok || data?.ok === false) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "Unable to process provider notifications."
          );
        }

        console.log("SUCCESS_NOTIFICATION_TRIGGER", {
          taskId,
          skipped: Boolean(data?.skipped),
          matchedProviders:
            typeof data?.matchedProviders === "number" ? data.matchedProviders : undefined,
          attemptedSends:
            typeof data?.attemptedSends === "number" ? data.attemptedSends : undefined,
          failedSends:
            typeof data?.failedSends === "number" ? data.failedSends : undefined,
        });

        setNotificationStatus("done");
      } catch (triggerError) {
        console.error("SUCCESS_NOTIFICATION_TRIGGER_FAILED", {
          taskId,
          error:
            triggerError instanceof Error ? triggerError.message : triggerError,
        });
        setNotificationStatus("error");
      }
    }, 3000);

    return () => {
      window.clearTimeout(timer);
      triggerStartedRef.current = false;
    };
  }, [taskId]);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError("");
    setProviders([]);

    if (!canFetchProviders) {
      setLoading(false);
      setError("Service or area details are missing.");
      return;
    }

    try {
      const payload = {
        category: clean(service),
        area: clean(area),
        taskId: taskId || "",
        userPhone: userPhone || "",
        limit: 20,
      };
      console.log("MATCH_UI_PAYLOAD", payload);

      const res = await fetch("/api/find-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`match_providers failed: ${res.status}`);
      }
      const data = (await res.json()) as MatchProvidersResponse;
      const normalizedProviders = Array.isArray(data?.providers)
        ? data.providers
            .map((item) => toProviderItem(item))
            .filter((item): item is ProviderItem => Boolean(item))
        : [];
      setProviders(normalizedProviders);
    } catch {
      setError("Could not load provider numbers right now.");
    } finally {
      setLoading(false);
    }
  }, [area, canFetchProviders, service, taskId, userPhone]);

  useEffect(() => {
    if (status === "under_review") return;
    void fetchProviders();
  }, [fetchProviders, status]);


  if (status === "under_review") {
    return (
      <div className="w-full max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center shadow-lg md:p-8">
        <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
          Request Received
        </h1>

        <p className="mt-3 text-sm text-slate-700">
          Your request is under review. We are verifying the service category and will post it shortly.
        </p>

        <p className="mt-2 text-sm text-slate-500">
          You will be notified on WhatsApp once your request is live and providers can see it.
        </p>

        {requestRef ? (
          <p className="mx-auto mt-5 inline-flex rounded-full bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm">
            Kaam No. {requestRef}
          </p>
        ) : null}

        {(service || area) ? (
          <p className="mx-auto mt-3 max-w-md text-xs text-slate-500">
            {service ? `Service: ${service}` : ""}
            {service && area ? " | " : ""}
            {area ? `Area: ${area}` : ""}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-full bg-[#003d20] px-4 py-3 text-sm font-bold text-white shadow-md transition duration-200 hover:bg-[#002a16] hover:shadow-lg"
          >
            Post another request
          </Link>
          <Link
            href="/dashboard/my-requests"
            className="inline-flex w-full items-center justify-center rounded-full border border-orange-300 bg-white px-4 py-3 text-sm font-bold text-[#003d20] transition duration-200 hover:bg-orange-50"
          >
            Go to Responses
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-lg md:p-6">
        <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
          Request Posted Successfully
        </h1>

        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Nearby providers have been notified. You can also contact available providers directly below.
        </p>

        {notificationStatusMessage ? (
          <p
            className={`mx-auto mt-2 max-w-lg text-xs md:text-sm ${
              notificationStatus === "error"
                ? "text-red-600"
                : notificationStatus === "done"
                  ? "text-emerald-700"
                  : "text-slate-500"
            }`}
          >
            {notificationStatusMessage}
          </p>
        ) : null}

        {taskDisplayLabel ? (
          <p className="mx-auto mt-3 inline-flex rounded-full bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm">
            {taskDisplayLabel}
          </p>
        ) : null}

        {service || area ? (
          <p className="mx-auto mt-3 max-w-md text-xs text-slate-500">
            {service ? `Service: ${service}` : ""}
            {service && area ? " · " : ""}
            {area ? `Area: ${area}` : ""}
          </p>
        ) : null}

        <div className="mx-auto mt-4 h-px w-full max-w-md bg-slate-200" />

        <div className="mt-4 text-left">
          {loading ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-600">
              Loading available providers...
            </p>
          ) : error ? (
            <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-center text-sm text-red-600">
              Could not load provider numbers right now.
            </p>
          ) : providers.length > 0 ? (
            <>
              <div className="hidden overflow-hidden rounded-xl border border-orange-200 md:block">
                <table className="w-full table-fixed divide-y divide-orange-200 text-left text-sm">
                  <thead className="bg-[#fb923c] text-left text-[#003d20]">
                    <tr>
                      <th className="w-[23%] whitespace-nowrap px-3 py-2 text-left align-middle text-base font-bold tracking-wide">Name</th>
                      <th className="w-[21%] whitespace-nowrap px-3 py-2 text-left align-middle text-base font-bold tracking-wide">Category</th>
                      <th className="w-[19%] whitespace-nowrap px-3 py-2 text-left align-middle text-base font-bold tracking-wide">Area</th>
                      <th className="w-[20%] whitespace-nowrap px-3 py-2 text-left align-middle text-base font-bold tracking-wide">Phone</th>
                      <th className="w-[17%] whitespace-nowrap pl-3 pr-6 py-2 text-left align-middle text-base font-bold tracking-wide">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-100 bg-white text-slate-800">
                    {providers.map((provider, index) => (
                      <tr
                        key={provider.providerId || `${provider.name}-${index}`}
                        className="align-middle"
                      >
                        <td className="px-3 py-2.5 font-medium leading-snug">{provider.name}</td>
                        <td className="px-3 py-2.5 leading-snug text-slate-600">{provider.category || service || "—"}</td>
                        <td className="px-3 py-2.5 leading-snug text-slate-600">{provider.area || area || "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col leading-tight">
                            {provider.phone ? (
                              <>
                                <a
                                  href={`tel:${provider.phone}`}
                                  className="font-bold text-[#003d20] underline decoration-[#f97316] decoration-2 underline-offset-4 transition-colors hover:text-[#002a16] hover:decoration-[#ea580c]"
                                >
                                  {provider.phone}
                                </a>
                                <span className="mt-1 text-[10px] font-medium text-[#003d20]/70">Tap to call</span>
                              </>
                            ) : (
                              <>
                                <span className="font-bold text-[#003d20] font-mono">
                                  {provider.phoneMasked || "—"}
                                </span>
                                <span className="mt-1 text-[10px] font-medium text-[#003d20]/70">
                                  Provider will reach you on WhatsApp
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="pl-3 pr-6 py-2.5 text-slate-600">{provider.rating || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 md:hidden">
                {providers.map((provider, index) => (
                  <div
                    key={provider.providerId || `${provider.name}-${index}`}
                    className="rounded-xl border border-orange-200 bg-white p-3.5 shadow-sm"
                  >
                    <p className="font-semibold text-slate-900">{provider.name}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {provider.category || service || "Category not available"} · {provider.area || area || "Area not available"}
                    </p>
                    <div className="mt-3 flex flex-col">
                      {provider.phone ? (
                        <>
                          <a
                            href={`tel:${provider.phone}`}
                            className="inline-flex text-sm font-bold text-[#003d20] underline decoration-[#f97316] decoration-2 underline-offset-4 transition-colors hover:text-[#002a16] hover:decoration-[#ea580c]"
                          >
                            {provider.phone}
                          </a>
                          <span className="mt-1 text-[11px] font-medium text-[#003d20]/70">
                            Tap to call · Hold to copy
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex text-sm font-bold text-[#003d20] font-mono">
                            {provider.phoneMasked || "—"}
                          </span>
                          <span className="mt-1 text-[11px] font-medium text-[#003d20]/70">
                            Provider will reach you on WhatsApp
                          </span>
                        </>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Rating: {provider.rating || "Rating not available"}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-600">
              No provider numbers available yet. We’ll notify you when providers respond.
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-full border border-orange-300 bg-orange-100 px-4 py-3 text-sm font-bold text-[#003d20] shadow-sm transition duration-200 hover:border-orange-400 hover:bg-orange-200 hover:shadow-md"
          >
            Post another request
          </Link>
          <Link
            href="/dashboard/my-requests"
            className="inline-flex w-full items-center justify-center rounded-full border border-transparent bg-[#003d20] px-4 py-3 text-sm font-bold text-white shadow-md transition duration-200 hover:bg-[#002a16] hover:shadow-lg"
          >
            Go to Responses
          </Link>
        </div>
      </div>

    </>
  );
}
