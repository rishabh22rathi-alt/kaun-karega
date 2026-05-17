"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

// Provider-side notification preferences card (Phase 3).
// Lives only on /provider/dashboard for now. Talks exclusively to the
// /api/notification-preferences route — does not know about Supabase,
// the shared catalogue, or actor_key plumbing. Adding a new toggle is a
// two-place change: PROVIDER_ALLOWED_EVENTS in the route, and TOGGLES
// here.

type EventKey = "general" | "job_match" | "chat_message" | "new_category";

type Preferences = Record<EventKey, boolean>;

type ApiResponse = {
  ok?: boolean;
  preferences?: Partial<Preferences>;
  error?: string;
  message?: string;
};

const TOGGLES: ReadonlyArray<{
  key: EventKey;
  label: string;
  description: string;
  mandatory?: boolean;
}> = [
  {
    key: "general",
    label: "General Notifications",
    description: "Required system notifications",
    mandatory: true,
  },
  {
    key: "job_match",
    label: "New Matched Jobs",
    description: "Get a push alert when a customer request matches your services and areas.",
  },
  {
    key: "chat_message",
    label: "Chat Messages",
    description: "Get notified when a customer sends you a new message.",
  },
  {
    key: "new_category",
    label: "New Categories / Services",
    description: "Heads-up when new service categories are added on Kaun Karega.",
  },
];

const DEFAULT_PREFS: Preferences = {
  general: true,
  job_match: true,
  chat_message: true,
  new_category: true,
};

function mergePrefs(partial: Partial<Preferences> | undefined): Preferences {
  return {
    general: true,
    job_match: partial?.job_match !== false,
    chat_message: partial?.chat_message !== false,
    new_category: partial?.new_category !== false,
  };
}

export default function ProviderNotificationPreferencesCard() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingKey, setPendingKey] = useState<EventKey | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const res = await fetch("/api/notification-preferences", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await res
          .json()
          .catch(() => null)) as ApiResponse | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !data.preferences) {
          setLoadError(
            data?.message || "Could not load notification preferences."
          );
          return;
        }
        setPrefs(mergePrefs(data.preferences));
      } catch {
        if (!cancelled) {
          setLoadError("Could not load notification preferences.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (key: EventKey, nextValue: boolean) => {
    if (key === "general") return;
    if (pendingKey) return;
    const previous = prefs[key];
    // Optimistic flip — UI reflects the new value immediately.
    setPrefs((current) => ({ ...current, [key]: nextValue }));
    setPendingKey(key);
    setActionError("");
    try {
      const res = await fetch("/api/notification-preferences", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ eventType: key, enabled: nextValue }],
        }),
      });
      const data = (await res
        .json()
        .catch(() => null)) as ApiResponse | null;
      if (!res.ok || !data?.ok || !data.preferences) {
        // Rollback the optimistic flip.
        setPrefs((current) => ({ ...current, [key]: previous }));
        setActionError(data?.message || "Could not save. Please try again.");
        return;
      }
      // Re-base on server truth in case the response narrows or expands
      // anything (e.g. server forced general=true).
      setPrefs(mergePrefs(data.preferences));
    } catch {
      setPrefs((current) => ({ ...current, [key]: previous }));
      setActionError("Could not save. Please check your connection.");
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section
      data-provider-tour="notification-preferences"
      aria-labelledby="provider-notif-prefs-heading"
      className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-col gap-2">
        <h2
          id="provider-notif-prefs-heading"
          className="text-xl font-semibold text-slate-900"
        >
          Notification Preferences
        </h2>
        <p className="text-sm text-slate-500">
          Choose which notifications you want to receive on your phone.
        </p>
      </div>

      {loadError ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {loadError}
        </p>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {actionError}
        </p>
      ) : null}

      <ul className="mt-5 divide-y divide-slate-100">
        {TOGGLES.map((toggle) => {
          const enabled = prefs[toggle.key];
          const isPending = pendingKey === toggle.key;
          const isLocked = Boolean(toggle.mandatory);
          const disabled = isLocked || loading || isPending;
          return (
            <li
              key={toggle.key}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {toggle.label}
                  </span>
                  {isLocked ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      Mandatory
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">{toggle.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {isPending ? (
                  <span className="text-xs text-slate-400">Saving…</span>
                ) : null}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${toggle.label} ${enabled ? "on" : "off"}`}
                  disabled={disabled}
                  onClick={() => handleToggle(toggle.key, !enabled)}
                  data-testid={`notif-toggle-${toggle.key}`}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                    enabled ? "bg-emerald-500" : "bg-slate-300"
                  } ${
                    isLocked
                      ? "cursor-not-allowed opacity-60"
                      : isPending
                        ? "cursor-wait opacity-70"
                        : loading
                          ? "cursor-wait opacity-60"
                          : "cursor-pointer"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {loading && !loadError ? (
        <p className="mt-3 text-xs text-slate-400">Loading…</p>
      ) : null}
    </section>
  );
}
