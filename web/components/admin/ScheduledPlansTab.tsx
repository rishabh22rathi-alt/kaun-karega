"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Admin dashboard tab — Scheduled Plan Activation.
 *
 * Vercel Hobby caps cron frequency at once per day, so frequent
 * automatic activation isn't available. Until the team upgrades to
 * Pro, admins trigger activation manually from this tab. The button
 * delegates to POST /api/admin/provider-plans/activate-scheduled which
 * delegates to the same shared runner as the bearer-auth cron route;
 * activation behaviour is identical regardless of trigger.
 *
 * Layout follows the SystemHealthTab accordion pattern: collapsed by
 * default, recent activations loaded on open, button-triggered POST
 * shows a result summary with optional failure details.
 *
 * Read-only safe defaults:
 *   - No auto-run on page load or on open.
 *   - Confirmation prompt before the POST fires.
 *   - One click = one batch. Repeated clicks are blocked while a
 *     request is in flight.
 */

type ActivationFailure = {
  provider_id: string;
  outcome: "skipped" | "failed";
  error_code: string | null;
  error_message: string | null;
};

type RunResult = {
  scanned: number;
  activated: number;
  skipped: number;
  failed: number;
  failures: ActivationFailure[];
};

type RecentActivation = {
  id: number;
  provider_id: string;
  attempted_at: string;
  activated_plan_code: string | null;
  outcome: "success" | "skipped" | "failed" | string;
  scheduled_payment_order_id: string | null;
  region_count: number | null;
  error_code: string | null;
  error_message: string | null;
  push_status: string | null;
};

type RunResponse = {
  ok?: boolean;
  scanned?: number;
  activated?: number;
  skipped?: number;
  failed?: number;
  failures?: ActivationFailure[];
  error?: string;
  message?: string;
};

type RecentResponse = {
  ok?: boolean;
  recent?: RecentActivation[];
  error?: string;
  message?: string;
};

type CoverageNote = { providerId: string; message: string };

type CoverageResult = {
  checked: number;
  fixed: number;
  warnings: CoverageNote[];
  errors: CoverageNote[];
};

type CoverageResponse = {
  ok?: boolean;
  checked?: number;
  fixed?: number;
  warnings?: CoverageNote[];
  errors?: CoverageNote[];
  error?: string;
  message?: string;
};

type ExpiredFailure = { provider_id: string; message: string };

type ExpiredResult = {
  scanned: number;
  reconciled: number;
  fixed: number;
  failed: number;
  failures: ExpiredFailure[];
};

type ExpiredResponse = {
  ok?: boolean;
  scanned?: number;
  reconciled?: number;
  fixed?: number;
  failed?: number;
  failures?: ExpiredFailure[];
  error?: string;
  message?: string;
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

const OUTCOME_PILL: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
  skipped: "bg-slate-100 text-slate-700 border-slate-300",
};

const PUSH_PILL: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  invalid_token: "bg-amber-50 text-amber-800 border-amber-200",
  skipped: "bg-slate-50 text-slate-600 border-slate-200",
  no_tokens: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function ScheduledPlansTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [recent, setRecent] = useState<RecentActivation[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [coverageProviderId, setCoverageProviderId] = useState("");
  const [coverageRunning, setCoverageRunning] = useState(false);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(
    null
  );
  const [coverageError, setCoverageError] = useState<string | null>(null);

  const [expiredRunning, setExpiredRunning] = useState(false);
  const [expiredResult, setExpiredResult] = useState<ExpiredResult | null>(null);
  const [expiredError, setExpiredError] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const res = await fetch(
        "/api/admin/provider-plans/activate-scheduled",
        {
          method: "GET",
          credentials: "same-origin",
        }
      );
      const data = (await res.json().catch(() => null)) as RecentResponse | null;
      if (!res.ok || !data?.ok) {
        setRecentError(
          data?.message ||
            data?.error ||
            `Failed to load recent activations (${res.status}).`
        );
        setRecent([]);
        return;
      }
      setRecent(Array.isArray(data.recent) ? data.recent : []);
    } catch {
      setRecentError("Network error while loading recent activations.");
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Re-fetch every time the accordion opens so a recent run is
    // reflected without a page reload.
    void fetchRecent();
  }, [isOpen, fetchRecent]);

  const handleRunActivation = useCallback(async () => {
    if (running) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "This will activate all due scheduled provider plans now. Continue?"
      );
      if (!ok) return;
    }
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const res = await fetch(
        "/api/admin/provider-plans/activate-scheduled",
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const data = (await res.json().catch(() => null)) as RunResponse | null;
      if (!res.ok || !data?.ok) {
        setRunError(
          data?.message ||
            data?.error ||
            `Activation run failed (${res.status}).`
        );
        return;
      }
      setRunResult({
        scanned: Number(data.scanned ?? 0),
        activated: Number(data.activated ?? 0),
        skipped: Number(data.skipped ?? 0),
        failed: Number(data.failed ?? 0),
        failures: Array.isArray(data.failures) ? data.failures : [],
      });
      // Refresh the audit table so the just-recorded rows show up.
      void fetchRecent();
    } catch {
      setRunError("Network error while running activation.");
    } finally {
      setRunning(false);
    }
  }, [running, fetchRecent]);

  const handleRebuildCoverage = useCallback(async () => {
    if (coverageRunning) return;
    const targetId = coverageProviderId.trim();
    if (typeof window !== "undefined") {
      const scope = targetId
        ? `provider ${targetId}`
        : "ALL providers with a plan row";
      const ok = window.confirm(
        `This will rebuild provider_areas coverage for ${scope} to match each plan (all_jodhpur → all regions; regions_5 → max 5; free/expired → 1). Continue?`
      );
      if (!ok) return;
    }
    setCoverageRunning(true);
    setCoverageError(null);
    setCoverageResult(null);
    try {
      const res = await fetch("/api/admin/provider-coverage/rebuild", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetId ? { providerId: targetId } : {}),
      });
      const data = (await res.json().catch(() => null)) as CoverageResponse | null;
      if (!res.ok || !data?.ok) {
        setCoverageError(
          data?.message || data?.error || `Coverage rebuild failed (${res.status}).`
        );
        return;
      }
      setCoverageResult({
        checked: Number(data.checked ?? 0),
        fixed: Number(data.fixed ?? 0),
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
      });
    } catch {
      setCoverageError("Network error while rebuilding coverage.");
    } finally {
      setCoverageRunning(false);
    }
  }, [coverageRunning, coverageProviderId]);

  const handleReconcileExpired = useCallback(async () => {
    if (expiredRunning) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "This will trim provider_areas for every provider whose paid plan has EXPIRED down to the free cap (1 region), so expired providers stop receiving premium matches. Active providers are not touched. Continue?"
      );
      if (!ok) return;
    }
    setExpiredRunning(true);
    setExpiredError(null);
    setExpiredResult(null);
    try {
      const res = await fetch("/api/admin/provider-coverage/reconcile-expired", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => null)) as ExpiredResponse | null;
      if (!res.ok || !data?.ok) {
        setExpiredError(
          data?.message ||
            data?.error ||
            `Expired coverage reconcile failed (${res.status}).`
        );
        return;
      }
      setExpiredResult({
        scanned: Number(data.scanned ?? 0),
        reconciled: Number(data.reconciled ?? 0),
        fixed: Number(data.fixed ?? 0),
        failed: Number(data.failed ?? 0),
        failures: Array.isArray(data.failures) ? data.failures : [],
      });
    } catch {
      setExpiredError("Network error while reconciling expired coverage.");
    } finally {
      setExpiredRunning(false);
    }
  }, [expiredRunning]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="scheduled-plans-tab-body"
        data-testid="scheduled-plans-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            Scheduled Plan Activation
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Manually run activation for scheduled provider plan changes whose
            date has arrived.
          </p>
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
          id="scheduled-plans-tab-body"
          className="space-y-5 border-t border-slate-200 px-5 py-5"
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Run this when you want to activate provider plan changes whose
              scheduled date has arrived. The system will scan due plans and
              activate each one — replacing regions, sending the
              plan-activated push, and writing an audit row.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleRunActivation}
                disabled={running}
                data-testid="scheduled-plans-run-button"
                className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running ? "Running…" : "Run activation now"}
              </button>
              <p className="text-xs text-slate-500">
                One click = one batch (max 500 providers).
              </p>
            </div>

            {runError ? (
              <div
                role="alert"
                data-testid="scheduled-plans-run-error"
                className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {runError}
              </div>
            ) : null}

            {runResult ? (
              <div
                role="status"
                data-testid="scheduled-plans-run-result"
                className="mt-4 space-y-3"
              >
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Scanned
                    </p>
                    <p
                      data-testid="scheduled-plans-stat-scanned"
                      className="mt-1 text-2xl font-bold text-slate-900"
                    >
                      {runResult.scanned}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Activated
                    </p>
                    <p
                      data-testid="scheduled-plans-stat-activated"
                      className="mt-1 text-2xl font-bold text-emerald-800"
                    >
                      {runResult.activated}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      Skipped
                    </p>
                    <p
                      data-testid="scheduled-plans-stat-skipped"
                      className="mt-1 text-2xl font-bold text-slate-800"
                    >
                      {runResult.skipped}
                    </p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                      Failed
                    </p>
                    <p
                      data-testid="scheduled-plans-stat-failed"
                      className="mt-1 text-2xl font-bold text-rose-800"
                    >
                      {runResult.failed}
                    </p>
                  </div>
                </div>

                {runResult.failures.length > 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Per-provider outcomes
                    </p>
                    <ul
                      data-testid="scheduled-plans-failures-list"
                      className="divide-y divide-slate-100"
                    >
                      {runResult.failures.map((f, i) => (
                        <li
                          key={`${f.provider_id}-${i}`}
                          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs"
                        >
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${
                              f.outcome === "failed"
                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                : "border-slate-300 bg-slate-50 text-slate-600"
                            }`}
                          >
                            {f.outcome}
                          </span>
                          <span className="font-mono text-slate-700">
                            {f.provider_id}
                          </span>
                          {f.error_code ? (
                            <span className="text-slate-700">
                              <strong>{f.error_code}</strong>
                            </span>
                          ) : null}
                          {f.error_message ? (
                            <span className="break-all text-slate-500">
                              {f.error_message}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    {runResult.scanned === 0
                      ? "No due scheduled plans were found in this run."
                      : "All scanned providers activated successfully."}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Rebuild Provider Coverage
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Repairs <code>provider_areas</code> so coverage matches each
              provider&rsquo;s plan: all_jodhpur fills every active region,
              regions_5 trims to 5, free/expired trims to 1. Leave the box empty
              to scan all providers, or enter one Provider ID.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={coverageProviderId}
                onChange={(e) => setCoverageProviderId(e.target.value)}
                placeholder="Provider ID (optional)"
                disabled={coverageRunning}
                data-testid="coverage-rebuild-provider-input"
                className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-800 focus:border-[#003d20] focus:outline-none focus:ring-1 focus:ring-[#003d20] disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={handleRebuildCoverage}
                disabled={coverageRunning}
                data-testid="coverage-rebuild-button"
                className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {coverageRunning ? "Rebuilding…" : "Rebuild Provider Coverage"}
              </button>
            </div>

            {coverageError ? (
              <div
                role="alert"
                data-testid="coverage-rebuild-error"
                className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {coverageError}
              </div>
            ) : null}

            {coverageResult ? (
              <div
                role="status"
                data-testid="coverage-rebuild-result"
                className="mt-4 space-y-3"
              >
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Checked
                    </p>
                    <p
                      data-testid="coverage-stat-checked"
                      className="mt-1 text-2xl font-bold text-slate-900"
                    >
                      {coverageResult.checked}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Fixed
                    </p>
                    <p
                      data-testid="coverage-stat-fixed"
                      className="mt-1 text-2xl font-bold text-emerald-800"
                    >
                      {coverageResult.fixed}
                    </p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      Warnings
                    </p>
                    <p
                      data-testid="coverage-stat-warnings"
                      className="mt-1 text-2xl font-bold text-amber-800"
                    >
                      {coverageResult.warnings.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                      Errors
                    </p>
                    <p
                      data-testid="coverage-stat-errors"
                      className="mt-1 text-2xl font-bold text-rose-800"
                    >
                      {coverageResult.errors.length}
                    </p>
                  </div>
                </div>

                {coverageResult.warnings.length > 0 ||
                coverageResult.errors.length > 0 ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {coverageResult.errors.map((n, i) => (
                      <li
                        key={`err-${n.providerId}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs"
                      >
                        <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-rose-700">
                          error
                        </span>
                        <span className="font-mono text-slate-700">
                          {n.providerId}
                        </span>
                        <span className="break-all text-slate-500">
                          {n.message}
                        </span>
                      </li>
                    ))}
                    {coverageResult.warnings.map((n, i) => (
                      <li
                        key={`warn-${n.providerId}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs"
                      >
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-amber-700">
                          warning
                        </span>
                        <span className="font-mono text-slate-700">
                          {n.providerId}
                        </span>
                        <span className="break-all text-slate-500">
                          {n.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">
                    {coverageResult.checked === 0
                      ? "No providers with a plan row were found."
                      : "All checked providers already had correct coverage or were repaired cleanly."}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Reconcile Expired Provider Coverage
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Scans every provider whose paid plan has <strong>expired</strong>{" "}
              and trims <code>provider_areas</code> to the free cap (1 region),
              so expired providers stop receiving premium (regions_5 /
              all_jodhpur) matches. Active providers are never touched. Safe to
              re-run.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleReconcileExpired}
                disabled={expiredRunning}
                data-testid="reconcile-expired-button"
                className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {expiredRunning
                  ? "Reconciling…"
                  : "Reconcile expired provider coverage"}
              </button>
              <p className="text-xs text-slate-500">
                One click = one batch (max 500 expired providers).
              </p>
            </div>

            {expiredError ? (
              <div
                role="alert"
                data-testid="reconcile-expired-error"
                className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {expiredError}
              </div>
            ) : null}

            {expiredResult ? (
              <div
                role="status"
                data-testid="reconcile-expired-result"
                className="mt-4 space-y-3"
              >
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Scanned
                    </p>
                    <p
                      data-testid="reconcile-expired-stat-scanned"
                      className="mt-1 text-2xl font-bold text-slate-900"
                    >
                      {expiredResult.scanned}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Fixed
                    </p>
                    <p
                      data-testid="reconcile-expired-stat-fixed"
                      className="mt-1 text-2xl font-bold text-emerald-800"
                    >
                      {expiredResult.fixed}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Reconciled
                    </p>
                    <p
                      data-testid="reconcile-expired-stat-reconciled"
                      className="mt-1 text-2xl font-bold text-slate-900"
                    >
                      {expiredResult.reconciled}
                    </p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                      Failed
                    </p>
                    <p
                      data-testid="reconcile-expired-stat-failed"
                      className="mt-1 text-2xl font-bold text-rose-800"
                    >
                      {expiredResult.failed}
                    </p>
                  </div>
                </div>

                {expiredResult.failures.length > 0 ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {expiredResult.failures.map((n, i) => (
                      <li
                        key={`exp-fail-${n.provider_id}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs"
                      >
                        <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-rose-700">
                          failed
                        </span>
                        <span className="font-mono text-slate-700">
                          {n.provider_id}
                        </span>
                        <span className="break-all text-slate-500">
                          {n.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">
                    {expiredResult.scanned === 0
                      ? "No expired-plan providers found."
                      : "All expired providers reconciled cleanly."}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-800">
                Recent activations
              </p>
              <button
                type="button"
                onClick={() => void fetchRecent()}
                disabled={recentLoading}
                data-testid="scheduled-plans-refresh-recent"
                className="text-xs font-semibold text-[#003d20] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recentLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {recentError ? (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {recentError}
              </div>
            ) : recent === null ? (
              <p className="text-xs text-slate-500">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="text-xs text-slate-500">
                No activations yet. Run activation above to record the first
                entries.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table
                  data-testid="scheduled-plans-recent-table"
                  className="min-w-full text-left text-xs"
                >
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Attempted</th>
                      <th className="px-3 py-2 font-semibold">Provider</th>
                      <th className="px-3 py-2 font-semibold">Outcome</th>
                      <th className="px-3 py-2 font-semibold">Plan</th>
                      <th className="px-3 py-2 font-semibold">Regions</th>
                      <th className="px-3 py-2 font-semibold">Push</th>
                      <th className="px-3 py-2 font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recent.map((row) => {
                      const outcome = String(row.outcome ?? "");
                      const outcomePill =
                        OUTCOME_PILL[outcome] ??
                        "bg-slate-100 text-slate-700 border-slate-300";
                      const push = row.push_status ?? "";
                      const pushPill =
                        PUSH_PILL[push] ??
                        "bg-slate-50 text-slate-600 border-slate-200";
                      return (
                        <tr
                          key={row.id}
                          className="bg-white hover:bg-slate-50"
                        >
                          <td className="px-3 py-2 text-slate-600">
                            {formatDate(row.attempted_at)}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-800">
                            {row.provider_id}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${outcomePill}`}
                            >
                              {outcome}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {row.activated_plan_code ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {row.region_count ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {push ? (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${pushPill}`}
                              >
                                {push}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {row.error_code ? (
                              <span>
                                <strong>{row.error_code}</strong>
                                {row.error_message ? (
                                  <span className="block break-all text-slate-500">
                                    {row.error_message}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
