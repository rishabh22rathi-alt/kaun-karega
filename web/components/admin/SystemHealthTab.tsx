"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// System Health accordion for /admin/dashboard.
//
// Reads:   GET /api/admin/system-health
// Mutates: none — first-pass read-only monitoring. No resolve buttons,
//   no auto-fix, no admin notifications fired. Alert objects come from
//   the server-side classifier in app/api/admin/system-health/route.ts
//   which folds notification_logs / tasks / provider_task_matches /
//   area_review_queue / issue_reports / pending_category_requests into
//   a unified critical/warning/info feed.

type Severity = "critical" | "warning" | "info";

type Alert = {
  id: string;
  severity: Severity;
  type: string;
  title: string;
  message: string;
  source: string;
  relatedId: string | null;
  created_at: string | null;
  status: "open" | "observed" | "resolved" | null;
};

type Summary = {
  critical: number;
  warning: number;
  info: number;
  total: number;
};

type LoadResponse = {
  success?: boolean;
  summary?: Summary;
  alerts?: Alert[];
  error?: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

const SEVERITY_PILL: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  warning: "bg-amber-100 text-amber-900 border-amber-400",
  info: "bg-sky-100 text-sky-900 border-sky-300",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export default function SystemHealthTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Show-more toggle for the alerts table. Defaults to top-5 severity-
  // ranked alerts; admin opts into the full list. Resets when the
  // accordion is closed so reopening starts compact again.
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  useEffect(() => {
    // Reset the show-more toggle when the accordion closes so the
    // next reopen starts compact.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isOpen) setShowAllAlerts(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch("/api/admin/system-health", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as LoadResponse;
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(
            json?.error || `Failed to load system health (${res.status})`
          );
          setAlerts([]);
          setSummary({ critical: 0, warning: 0, info: 0, total: 0 });
          return;
        }
        setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
        setSummary(
          json.summary
            ? json.summary
            : { critical: 0, warning: 0, info: 0, total: 0 }
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setAlerts([]);
        setSummary({ critical: 0, warning: 0, info: 0, total: 0 });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const subtitleSummary = summary
    ? `${summary.critical} critical · ${summary.warning} warnings`
    : "Issues, failures, and operational alerts";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="system-health-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            System Health
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{subtitleSummary}</p>
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
          id="system-health-tab-body"
          className="border-t border-slate-200 px-5 py-5"
        >
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
                Critical
              </p>
              <p
                data-testid="system-health-stat-critical"
                className="mt-1 text-2xl font-bold text-red-800"
              >
                {summary?.critical ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Warnings
              </p>
              <p
                data-testid="system-health-stat-warning"
                className="mt-1 text-2xl font-bold text-amber-900"
              >
                {summary?.warning ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">
                Info
              </p>
              <p
                data-testid="system-health-stat-info"
                className="mt-1 text-2xl font-bold text-sky-900"
              >
                {summary?.info ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Total
              </p>
              <p
                data-testid="system-health-stat-total"
                className="mt-1 text-2xl font-bold text-slate-900"
              >
                {summary?.total ?? "—"}
              </p>
            </div>
          </div>

          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading && !alerts && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              Checking system health…
            </p>
          )}

          {!loading && alerts && alerts.length === 0 && !error && (
            <p
              data-testid="system-health-empty"
              className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              No active system issues found.
            </p>
          )}

          {alerts && alerts.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Severity
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Issue
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Source
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Related ID
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {(showAllAlerts ? alerts : alerts.slice(0, 5)).map((alert) => (
                    <tr
                      key={alert.id}
                      data-testid={`system-health-alert-${alert.id}`}
                      data-severity={alert.severity}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${SEVERITY_PILL[alert.severity]}`}
                        >
                          {SEVERITY_LABEL[alert.severity]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-600">
                        {alert.type}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900">
                            {alert.title}
                          </span>
                          <span className="text-xs text-slate-600">
                            {alert.message}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-600">
                        {alert.source}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-700">
                        {alert.relatedId ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">
                        {formatDate(alert.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {alerts && alerts.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllAlerts((v) => !v)}
              data-testid="system-health-show-toggle"
              className="mt-3 inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {showAllAlerts
                ? "Show less"
                : `Show all issues (${alerts.length - 5} more)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
