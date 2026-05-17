"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// Phase 6 V1: admin notification analytics tab. Read-only view of
// push_logs counts and recent non-sent rows. No charts, no polling,
// no mutations. Mirrors the collapsible-section pattern used by
// ChatsTab / IssueReportsTab / KaamTab so it slots into the admin
// dashboard's vertical accordion layout without bespoke chrome.

type AnalyticsRange = "today" | "7d" | "30d";

type SummaryCounts = {
  sent: number;
  failed: number;
  invalid_token: number;
  preference_disabled: number;
  no_active_device: number;
  skipped_other: number;
  total: number;
};

type EventTypeBreakdown = SummaryCounts & {
  event_type: string;
};

type RecentFailure = {
  created_at: string;
  event_type: string;
  status: string;
  reason: string;
  recipient_provider_id: string | null;
};

type AnalyticsResponse = {
  ok?: boolean;
  range?: AnalyticsRange;
  since?: string;
  truncated?: boolean;
  summary?: SummaryCounts;
  by_event_type?: EventTypeBreakdown[];
  recent_failures?: RecentFailure[];
  error?: string;
  message?: string;
};

type PushAnalyticsTabProps = {
  defaultOpen?: boolean;
};

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const RANGE_OPTIONS: ReadonlyArray<AnalyticsRange> = ["today", "7d", "30d"];

// Plain-English captions surfaced under the summary cards and as table
// row tooltips. Sourced from the Phase 6 spec; keep wording aligned
// with what providers see in their own preferences UI so admins and
// providers share the same vocabulary.
const STATUS_HELP: Record<
  keyof Omit<SummaryCounts, "total">,
  { label: string; help: string; tone: string }
> = {
  sent: {
    label: "Sent",
    help: "Delivered successfully to FCM.",
    tone: "text-emerald-700",
  },
  failed: {
    label: "Failed",
    help: "FCM send failed (transient or server-side error).",
    tone: "text-rose-700",
  },
  invalid_token: {
    label: "Invalid Token",
    help: "Device token expired or app uninstalled. Auto-deactivated.",
    tone: "text-amber-700",
  },
  preference_disabled: {
    label: "Preference Disabled",
    help: "Recipient turned this notification off.",
    tone: "text-sky-700",
  },
  no_active_device: {
    label: "No Active Device",
    help: "No registered app device for the recipient.",
    tone: "text-slate-700",
  },
  skipped_other: {
    label: "Skipped (other)",
    help: "Skipped for an uncategorized reason.",
    tone: "text-slate-700",
  },
};

const STATUS_BADGE: Record<string, string> = {
  failed: "border-rose-300 bg-rose-50 text-rose-800",
  invalid_token: "border-amber-300 bg-amber-50 text-amber-800",
  skipped: "border-sky-300 bg-sky-50 text-sky-800",
};

function statusBadgeClass(status: string): string {
  return (
    STATUS_BADGE[status] || "border-slate-300 bg-slate-100 text-slate-700"
  );
}

function formatDateTime(value: string): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

function StatCard({
  label,
  value,
  help,
  tone,
  testId,
}: {
  label: string;
  value: number | string;
  help: string;
  tone: string;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        data-testid={testId}
        className={`mt-1 text-2xl font-bold ${tone}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{help}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
    >
      {children}
    </th>
  );
}

export default function PushAnalyticsTab({
  defaultOpen = false,
}: PushAnalyticsTabProps = {}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Re-trigger open when the search-param query flips to ?tab=notifications
  // after this tab has already mounted (matches ChatsTab pattern at
  // components/admin/ChatsTab.tsx:176-178). The setState-in-effect rule
  // fires here despite the same shape passing in the precedent file —
  // an experimental-rule asymmetry. We follow the established convention.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (defaultOpen) setIsOpen(true);
  }, [defaultOpen]);

  // Re-fetch when the accordion opens, when range changes, or when the
  // user hits Refresh. Same fetch-on-open pattern as ChatsTab.tsx (≈l.184)
  // and AdminNotificationBell.tsx — see note above re: rule asymmetry.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    fetch(`/api/admin/push-analytics?range=${encodeURIComponent(range)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res
          .json()
          .catch(() => ({}))) as AnalyticsResponse;
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setError(
            json?.message ||
              json?.error ||
              `Failed to load analytics (${res.status})`
          );
          setData(null);
          return;
        }
        setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, range, refreshKey]);

  const summary = data?.summary;
  const headerSummary =
    summary !== undefined
      ? `${summary.total} push event${summary.total === 1 ? "" : "s"} · ${summary.sent} sent · ${summary.failed + summary.invalid_token} failed/invalid`
      : "Aggregated FCM delivery results from push_logs";

  return (
    <section
      data-testid="push-analytics-tab"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="push-analytics-tab-body"
        data-testid="push-analytics-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            Notification Analytics
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{headerSummary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div
          id="push-analytics-tab-body"
          className="border-t border-slate-200 px-5 py-5"
        >
          {/* Range + refresh */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="text-xs font-medium text-slate-700">
              Range
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as AnalyticsRange)}
                data-testid="push-analytics-range"
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              >
                {RANGE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {RANGE_LABEL[opt]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              data-testid="push-analytics-refresh"
              className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p
              role="alert"
              data-testid="push-analytics-error"
              className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}

          {data?.truncated ? (
            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Results truncated — the selected range exceeded the row fetch
              cap. Pick a shorter range for accurate counts.
            </p>
          ) : null}

          {/* Summary cards */}
          <div
            className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
            data-testid="push-analytics-summary"
          >
            {(
              [
                "sent",
                "failed",
                "invalid_token",
                "preference_disabled",
                "no_active_device",
                "skipped_other",
              ] as const
            ).map((key) => {
              const meta = STATUS_HELP[key];
              const value = summary ? summary[key] : "—";
              return (
                <StatCard
                  key={key}
                  label={meta.label}
                  value={value}
                  help={meta.help}
                  tone={meta.tone}
                  testId={`push-analytics-stat-${key}`}
                />
              );
            })}
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Total events in window:{" "}
            <span
              className="font-semibold text-slate-900"
              data-testid="push-analytics-stat-total"
            >
              {summary ? summary.total : "—"}
            </span>
          </div>

          {/* Event-type breakdown */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">
              Event Type Breakdown
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              One row per push event type in the selected window.
            </p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table
                className="min-w-full divide-y divide-slate-200 text-sm"
                data-testid="push-analytics-event-table"
              >
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Event Type</Th>
                    <Th>Sent</Th>
                    <Th>Failed</Th>
                    <Th>Invalid</Th>
                    <Th>Pref Off</Th>
                    <Th>No Device</Th>
                    <Th>Skipped</Th>
                    <Th>Total</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data?.by_event_type && data.by_event_type.length > 0 ? (
                    data.by_event_type.map((row) => (
                      <tr key={row.event_type}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-900">
                          {row.event_type}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.sent}</td>
                        <td className="px-3 py-2 text-slate-700">{row.failed}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.invalid_token}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.preference_disabled}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.no_active_device}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.skipped_other}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {row.total}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-6 text-center text-sm text-slate-500"
                      >
                        {loading
                          ? "Loading…"
                          : "No push events in this window."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent failures / skips */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Failures / Skips
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Latest {data?.recent_failures?.length ?? 0} non-sent rows,
              newest first. Token tails, payload, and recipient phone are
              intentionally not shown — cross-reference{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                recipient_provider_id
              </code>{" "}
              against the Providers tab.
            </p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table
                className="min-w-full divide-y divide-slate-200 text-sm"
                data-testid="push-analytics-failures-table"
              >
                <thead className="bg-slate-50">
                  <tr>
                    <Th>When</Th>
                    <Th>Event</Th>
                    <Th>Status</Th>
                    <Th>Reason</Th>
                    <Th>Provider</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data?.recent_failures && data.recent_failures.length > 0 ? (
                    data.recent_failures.map((row, idx) => (
                      <tr key={`${row.created_at}-${idx}`}>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-900">
                          {row.event_type}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(row.status)}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {row.reason}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {row.recipient_provider_id || "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-sm text-slate-500"
                      >
                        {loading ? "Loading…" : "No failures or skips in this window."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
