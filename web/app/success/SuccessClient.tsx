"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import { normalizeVerifiedValue } from "@/lib/providerPresentation";
import InstallAppPromptCard from "@/components/pwa/InstallAppPromptCard";

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
  // Phase 3 coverage-origin metadata from /api/find-provider.
  group: string;
  matchScope: string;
};

type MatchProvidersResponse = {
  providers?: unknown[];
};

const clean = (s: string) => (s || "").trim().replace(/\s+/g, " ");

// Result grouping (Phase 3). Render order is fixed; the friendly headings
// come straight from the backend `group` metadata on each provider.
const GROUP_ORDER = [
  "available_across_jodhpur",
  "available_in_this_region",
  "other_providers_in_this_area",
] as const;
type GroupKey = (typeof GROUP_ORDER)[number];
const GROUP_LABEL: Record<GroupKey, string> = {
  available_across_jodhpur: "Available Across Jodhpur",
  available_in_this_region: "Popular providers in your area",
  other_providers_in_this_area: "Other providers in this area",
};
// First N providers per group; the rest collapse behind "View more".
const GROUP_PREVIEW_COUNT = 5;
function groupKeyOf(value: string): GroupKey {
  return value === "available_across_jodhpur" ||
    value === "available_in_this_region"
    ? value
    : "other_providers_in_this_area";
}

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
  const group =
    (typeof record.group === "string" && record.group.trim()) || "";
  const matchScope =
    (typeof record.matchScope === "string" && record.matchScope.trim()) || "";
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
    group,
    matchScope,
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
  // Per-group "View more" expansion. Keyed by GroupKey.
  const [expandedGroups, setExpandedGroups] = useState<
    Partial<Record<GroupKey, boolean>>
  >({});

  // Bucket the matched providers by their backend `group`. Providers with an
  // unknown/missing group fall into "other_providers_in_this_area". For an
  // all-city task every provider is "available_across_jodhpur", so only that
  // section renders.
  const providersByGroup = useMemo(() => {
    const map = new Map<GroupKey, ProviderItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const p of providers) map.get(groupKeyOf(p.group))!.push(p);
    return map;
  }, [providers]);
  const [notificationStatus, setNotificationStatus] = useState<
    "idle" | "queued" | "processing" | "done" | "error"
  >(taskId ? "queued" : "idle");
  const triggerStartedRef = useRef(false);

  const canFetchProviders = useMemo(
    () => Boolean(service && area),
    [service, area]
  );
  // All-city tasks carry the virtual "All Jodhpur" area label. Used to show a
  // tailored empty-state message instead of the generic region one.
  const isAllCity = useMemo(
    () => clean(area).toLowerCase() === "all jodhpur",
    [area]
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

  // Renders one slice of providers (desktop table + mobile cards). Called
  // once per group so the markup stays identical to the pre-grouping table.
  const renderProviderBlock = (items: ProviderItem[]) => (
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
            {items.map((provider, index) => (
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
        {items.map((provider, index) => (
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
  );

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
      {/* Phase 2 PWA reminder — high-intent moment (user just
          successfully submitted a request). Self-hides when already
          installed, when install is unsupported, or when the 7-day
          dismissal cooldown is active. */}
      <div className="mb-4 w-full max-w-xl">
        <InstallAppPromptCard />
      </div>
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
            <div className="space-y-6">
              {GROUP_ORDER.map((groupKey) => {
                const items = providersByGroup.get(groupKey) ?? [];
                if (items.length === 0) return null;
                const isExpanded = Boolean(expandedGroups[groupKey]);
                const shown = isExpanded
                  ? items
                  : items.slice(0, GROUP_PREVIEW_COUNT);
                const hiddenCount = items.length - GROUP_PREVIEW_COUNT;
                return (
                  <section key={groupKey} data-testid={`provider-group-${groupKey}`}>
                    <h2 className="mb-2 text-sm font-bold text-[#003d20]">
                      {GROUP_LABEL[groupKey]}
                    </h2>
                    {renderProviderBlock(shown)}
                    {items.length > GROUP_PREVIEW_COUNT ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((prev) => ({
                            ...prev,
                            [groupKey]: !isExpanded,
                          }))
                        }
                        data-testid={`provider-group-${groupKey}-toggle`}
                        className="mt-2 text-xs font-semibold text-[#003d20] underline underline-offset-2 hover:text-[#002a16]"
                      >
                        {isExpanded ? "View less" : `View more (${hiddenCount} more)`}
                      </button>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : isAllCity ? (
            <div
              data-testid="all-jodhpur-empty"
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600"
            >
              <p>
                We couldn&rsquo;t find any providers currently serving all of
                Jodhpur for this service.
              </p>
              <p className="mt-2">
                Choose your area to see local providers who may be available
                nearby.
              </p>
              {/* Return to request-flow with the category preserved. No scope
                  param → the picker starts in normal region mode (all-city is
                  intentionally NOT carried over). */}
              <Link
                href={`/request-flow${
                  service ? `?category=${encodeURIComponent(service)}` : ""
                }`}
                data-testid="all-jodhpur-choose-area"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-[#003d20] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16]"
              >
                Choose Area Instead
              </Link>
            </div>
          ) : (
            <p
              data-testid="providers-empty"
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-600"
            >
              No provider numbers available yet. We&rsquo;ll notify you when
              providers respond.
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
