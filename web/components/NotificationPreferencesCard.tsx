"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import type { NotificationPreferenceToggle } from "@/lib/notificationPreferenceUiConfig";

// Generic notification preferences card. One client component used by
// the provider settings page today and (Phase 4/5) the user + admin
// settings pages. Talks only to the route given by `apiPath` — does not
// know about Supabase, the shared catalogue, or the underlying actor
// model.
//
// Preserves all behavior from the previous provider-only card:
//   • GET on mount, render toggle list
//   • optimistic flip → PUT → rebase or rollback
//   • per-row "Saving…" indicator while a PUT is in flight
//   • only one toggle in flight at a time (pendingKey guard)
//   • mandatory rows render disabled with a Lock pill
//   • general always forced true client-side (defense in depth)
//   • mobile-first layout (stacks below sm:, side-by-side from sm: up)

type Preferences = Record<string, boolean>;

type ApiResponse = {
  ok?: boolean;
  preferences?: Preferences;
  error?: string;
  message?: string;
};

export type NotificationPreferencesCardProps = {
  /**
   * Logical surface this card lives on. Used as the default test-id
   * prefix and for log messages — never sent to the API. The route
   * itself derives the actor from the session cookie.
   */
  scope: "provider" | "user" | "admin";
  /**
   * Endpoint that serves both GET (current snapshot) and PUT (apply
   * updates) for this surface. The route is responsible for actor
   * resolution and allow-list enforcement.
   */
  apiPath: string;
  /**
   * Ordered list of toggles to render. The card's response merger
   * defaults missing keys to enabled and forces mandatory keys to true.
   */
  toggles: ReadonlyArray<NotificationPreferenceToggle>;
  /** Card heading rendered as an h2 inside the section. */
  title: string;
  /** Sub-line under the heading. */
  subtitle: string;
  /**
   * Override for the outer section's data-testid. Switches keep their
   * own `notif-toggle-<eventType>` test-ids regardless of this prop.
   */
  dataTestId?: string;
};

function buildDefaults(
  toggles: ReadonlyArray<NotificationPreferenceToggle>
): Preferences {
  const out: Preferences = {};
  for (const toggle of toggles) {
    out[toggle.eventType] = true;
  }
  return out;
}

function mergePrefs(
  toggles: ReadonlyArray<NotificationPreferenceToggle>,
  partial: Preferences | undefined
): Preferences {
  const out: Preferences = {};
  for (const toggle of toggles) {
    if (toggle.mandatory) {
      // Hard guarantee: mandatory toggles are ALWAYS enabled in the UI,
      // even if a corrupted server response says otherwise. The DB
      // trigger + helper + route also enforce this server-side.
      out[toggle.eventType] = true;
      continue;
    }
    const value = partial?.[toggle.eventType];
    out[toggle.eventType] = value !== false;
  }
  return out;
}

export default function NotificationPreferencesCard({
  scope,
  apiPath,
  toggles,
  title,
  subtitle,
  dataTestId,
}: NotificationPreferencesCardProps) {
  const [prefs, setPrefs] = useState<Preferences>(() => buildDefaults(toggles));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const res = await fetch(apiPath, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as ApiResponse | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !data.preferences) {
          setLoadError(
            data?.message || "Could not load notification preferences."
          );
          return;
        }
        setPrefs(mergePrefs(toggles, data.preferences));
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
  }, [apiPath, toggles]);

  const handleToggle = async (
    toggle: NotificationPreferenceToggle,
    nextValue: boolean
  ) => {
    if (toggle.mandatory) return;
    if (pendingKey) return;
    const key = toggle.eventType;
    const previous = prefs[key];
    // Optimistic flip — UI reflects the new value immediately.
    setPrefs((current) => ({ ...current, [key]: nextValue }));
    setPendingKey(key);
    setActionError("");
    try {
      const res = await fetch(apiPath, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ eventType: key, enabled: nextValue }],
        }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !data?.ok || !data.preferences) {
        // Rollback to the previous value and surface the message.
        setPrefs((current) => ({ ...current, [key]: previous }));
        setActionError(data?.message || "Could not save. Please try again.");
        return;
      }
      // Re-base on server truth in case the response narrows or expands
      // anything (e.g. server forced mandatory keys back to true).
      setPrefs(mergePrefs(toggles, data.preferences));
    } catch {
      setPrefs((current) => ({ ...current, [key]: previous }));
      setActionError("Could not save. Please check your connection.");
    } finally {
      setPendingKey(null);
    }
  };

  const sectionTestId = dataTestId ?? `notification-preferences-card-${scope}`;
  const headingId = `notif-prefs-heading-${scope}`;

  return (
    <section
      data-testid={sectionTestId}
      aria-labelledby={headingId}
      className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-col gap-2">
        <h2
          id={headingId}
          className="text-xl font-semibold text-slate-900"
        >
          {title}
        </h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>

      {loadError ? (
        <p
          role="alert"
          data-testid={`${sectionTestId}-load-error`}
          className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {loadError}
        </p>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          data-testid={`${sectionTestId}-action-error`}
          className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {actionError}
        </p>
      ) : null}

      <ul className="mt-5 divide-y divide-slate-100">
        {toggles.map((toggle) => {
          const enabled = prefs[toggle.eventType] ?? true;
          const isPending = pendingKey === toggle.eventType;
          const isLocked = Boolean(toggle.mandatory);
          const disabled = isLocked || loading || isPending;
          return (
            <li
              key={toggle.eventType}
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
                <p className="mt-1 text-xs text-slate-500">
                  {toggle.description}
                </p>
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
                  onClick={() => handleToggle(toggle, !enabled)}
                  data-testid={`notif-toggle-${toggle.eventType}`}
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
