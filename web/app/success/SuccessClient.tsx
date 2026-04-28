"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  phone: string;
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
  const phone =
    (typeof record.phone === "string" && record.phone.trim()) ||
    (typeof record.mobile === "string" && record.mobile.trim()) ||
    (typeof record.phone_number === "string" && record.phone_number.trim()) ||
    (typeof record.ProviderPhone === "string" && record.ProviderPhone.trim()) ||
    "";
  if (!name || !phone) return null;
  return {
    name,
    phone,
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
  const [showModal, setShowModal] = useState(false);
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
    if (notificationStatus === "queued" || notificationStatus === "processing") {
      return "Notifying nearby service providers...";
    }
    if (notificationStatus === "done") {
      return "Nearby service providers have been informed.";
    }
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

  const handleShowProviders = async () => {
    setShowModal(true);
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
      setError("Unable to fetch providers right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
          <p className="mx-auto mt-5 inline-flex rounded-full bg-white border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800">
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
            className="inline-flex w-full items-center justify-center rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600"
          >
            Post another request
          </Link>
          <Link
            href="/dashboard/my-requests"
            className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Go to Responses
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-lg md:p-8">
        <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
          Task Submitted Successfully
        </h1>

        <p className="mt-3 text-sm text-slate-600">
          Nearby service providers have been notified. Most requests receive a response within a few minutes to a few hours.
        </p>

        <p className="mt-2 text-sm text-slate-500">
          You will receive updates here and via WhatsApp when a provider responds.
        </p>

        <p className="mx-auto mt-3 max-w-lg text-sm text-slate-600 md:text-base">
          Congratulations! Your task has been successfully posted.
          {taskId ? " We are now informing nearby service providers." : ""}
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
          <p className="mx-auto mt-4 inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">
            {taskDisplayLabel}
          </p>
        ) : null}

        <div className="mx-auto mt-6 h-px w-full max-w-md bg-slate-200" />

        <button
          type="button"
          onClick={() => {
            void handleShowProviders();
          }}
          className="mx-auto mt-6 inline-flex w-full max-w-sm items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-md transition duration-200 hover:scale-105 hover:bg-emerald-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
        >
          Show Service Provider Numbers
        </button>

        {service || area ? (
          <p className="mx-auto mt-4 max-w-md text-xs text-slate-500">
            {service ? `Service: ${service}` : ""}
            {service && area ? " | " : ""}
            {area ? `Area: ${area}` : ""}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600"
          >
            Post another request
          </Link>
          <Link
            href="/dashboard/my-requests"
            className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Go to Responses
          </Link>
        </div>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl md:p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                Available Providers
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-md px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            {loading ? (
              <p className="mt-4 text-sm text-slate-600">Fetching providers...</p>
            ) : error ? (
              <p className="mt-4 text-sm text-red-600">{error}</p>
            ) : providers.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-3 py-3 font-semibold">S.No</th>
                      <th className="px-3 py-3 font-semibold">Provider Name</th>
                      <th className="px-3 py-3 font-semibold">Phone</th>
                      <th className="px-3 py-3 font-semibold">Phone Verified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white text-slate-800">
                    {providers.map((provider, index) => (
                      <tr key={`${provider.phone}-${index}`}>
                        <td className="px-3 py-3 align-top">{index + 1}</td>
                        <td className="px-3 py-3 align-top font-medium">{provider.name}</td>
                        <td className="px-3 py-3 align-top">
                          <a href={`tel:${provider.phone}`} className="text-blue-600 hover:underline">
                            {provider.phone}
                          </a>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={
                              provider.verified === "yes"
                                ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                                : "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
                            }
                          >
                            {provider.verified === "yes" ? "Verified" : "Not Verified"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                No providers found for this service and area.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
