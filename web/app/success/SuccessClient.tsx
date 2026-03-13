"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type SuccessClientProps = {
  service: string;
  area: string;
  taskId?: string;
  userPhone?: string;
};

type ProviderItem = {
  name: string;
  phone: string;
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
    "";
  const phone =
    (typeof record.phone === "string" && record.phone.trim()) ||
    (typeof record.mobile === "string" && record.mobile.trim()) ||
    (typeof record.phone_number === "string" && record.phone_number.trim()) ||
    "";
  if (!name || !phone) return null;
  return { name, phone };
}

export default function SuccessClient({
  service,
  area,
  taskId = "",
  userPhone = "",
}: SuccessClientProps) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<ProviderItem[]>([]);

  const canFetchProviders = useMemo(
    () => Boolean(service && area),
    [service, area]
  );

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
    } catch (err) {
      setError("Unable to fetch providers right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-lg md:p-8">
        <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
          Task Submitted Successfully
        </h1>

        <p className="mx-auto mt-3 max-w-lg text-sm text-slate-600 md:text-base">
          Nearby providers will contact you soon on WhatsApp.
        </p>

        <div className="mx-auto mt-6 h-px w-full max-w-md bg-slate-200" />

        <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-slate-600 md:text-base">
          Thanks for posting your request. We are matching nearby verified
          providers right now.
        </p>

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
            Go to My Requests
          </Link>
        </div>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl md:p-6">
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
              <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                {providers.map((provider, index) => (
                  <li
                    key={`${provider.phone}-${index}`}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {provider.name}
                    </p>
                    <a
                      href={`tel:${provider.phone}`}
                      className="mt-1 flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                    >
                      <span>📞</span>
                      <span>{provider.phone}</span>
                    </a>
                  </li>
                ))}
              </ul>
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
