"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDown } from "lucide-react";
import UnreadBadge, { type UnreadIndicator } from "./UnreadBadge";

type KaamTabProps = {
  // Wired by the dashboard page (see useAdminUnread). Optional so
  // standalone embeds — no current callers, but easy to add later —
  // still work without the indicator.
  unread?: UnreadIndicator | null;
  onMarkRead?: () => void;
};

// Kaam accordion for /admin/dashboard.
//
// Reads:   GET  /api/admin/kaam
// Mutates: POST /api/admin/kaam/reprocess
//   — admin-initiated only, scoped to a single previously-pending Kaam
//   whose category has been approved later. The downstream pipeline
//   (process-task-notifications) handles all DB writes; this component
//   only triggers it. Chat threads are never closed by this UI.
//
// Status cell rendering rules:
//   - isNewServiceCategory === true → amber/orange attention badge
//     ("New Service Category") + the lifecycle step/bar beneath +
//     a "Reprocess Kaam" button. The button calls the reprocess
//     endpoint and, on success, refetches /api/admin/kaam so the
//     status moves forward (e.g. 1/5 → 3/5) and the badge naturally
//     disappears once the row no longer satisfies the new-category
//     evidence.
//   - otherwise → step badge + progress bar only. Raw tasks.status
//     (rawStatus) is never rendered as the primary cell.

type LifecycleStatus =
  | "Task Created"
  | "Matched"
  | "Providers Notified"
  | "Provider Responded"
  | "Completed / Closed";

type MonthlyKaamPoint = {
  month: string;
  monthKey: string;
  count: number;
};

type KaamRow = {
  taskId: string;
  kaamNo: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  rawStatus: string | null;
  lifecycleStatus: LifecycleStatus;
  lifecycleStep: number;
  lifecycleTotalSteps: number;
  isNewServiceCategory: boolean;
  statusAttentionLabel: string | null;
  created_at: string | null;
  whenRequired: string | null;
};

type LoadResponse = {
  success?: boolean;
  totalKaam?: number;
  monthlyKaam?: MonthlyKaamPoint[];
  analyticsTruncated?: boolean;
  kaam?: KaamRow[];
  error?: string;
};

type ReprocessResponse = {
  success?: boolean;
  taskId?: string;
  kaamNo?: string;
  category?: string;
  area?: string;
  matchedCount?: number;
  notifiedCount?: number;
  skippedExistingCount?: number;
  status?: string | null;
  skipped?: boolean;
  skippedReason?: string | null;
  reason?: string;
  message?: string;
  error?: string;
};

// Per-row reprocess feedback message — keyed by taskId so multiple
// rows can hold independent inline statuses without a global banner.
type ReprocessStatus = {
  kind: "success" | "error";
  message: string;
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

// Tailwind palette per stage. Bar colour shifts to green at the
// "Completed / Closed" milestone so it reads as success at a glance.
function progressBarColor(row: KaamRow): string {
  if (row.lifecycleStatus === "Completed / Closed") return "bg-emerald-500";
  if (row.isNewServiceCategory) return "bg-amber-500";
  return "bg-[#003d20]";
}

// Step text styling — Completed gets the success green, regular rows
// stay neutral, attention rows pick up the amber muted treatment.
function stepTextClass(row: KaamRow): string {
  if (row.lifecycleStatus === "Completed / Closed") {
    return "text-emerald-700 font-semibold";
  }
  if (row.isNewServiceCategory) return "text-amber-900";
  return "text-slate-700";
}

// ───────────────────────────────────────────────────────────────────
// Analytics block — 4 summary cards (Total / This Month / Last Month
// / Growth) sourced from /api/admin/kaam. The monthly bar chart and
// the Category-wise Kaam Allocation donut that used to live here are
// gone: the donut now renders inside ReportsTab via
// CategoryKaamAllocationCard, and the monthly bars were removed
// because the stat cards already convey the same trend at a glance.
// The monthlyKaam array is still consumed here to compute the
// "This Month", "Last Month", and "Growth" values.
// ───────────────────────────────────────────────────────────────────

function KaamAnalytics({
  totalKaam,
  monthlyKaam,
  analyticsTruncated,
}: {
  totalKaam: number | null;
  monthlyKaam: MonthlyKaamPoint[];
  analyticsTruncated: boolean;
}): ReactElement {
  const thisMonth = monthlyKaam.length > 0
    ? monthlyKaam[monthlyKaam.length - 1]
    : null;
  const lastMonth = monthlyKaam.length > 1
    ? monthlyKaam[monthlyKaam.length - 2]
    : null;

  const thisMonthCount = thisMonth?.count ?? 0;
  const lastMonthCount = lastMonth?.count ?? 0;
  const growthAbs = thisMonthCount - lastMonthCount;
  const growthPct =
    lastMonthCount > 0
      ? Math.round((growthAbs / lastMonthCount) * 100)
      : null;

  let growthLabel = "—";
  if (lastMonth) {
    const sign = growthAbs > 0 ? "+" : growthAbs < 0 ? "" : "±";
    if (growthPct === null) {
      growthLabel = `${sign}${growthAbs}`;
    } else {
      growthLabel = `${sign}${growthAbs} (${sign}${growthPct}%)`;
    }
  }
  const growthClass =
    growthAbs > 0
      ? "text-emerald-700"
      : growthAbs < 0
        ? "text-red-700"
        : "text-slate-700";

  return (
    <div className="mb-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Total Kaam
          </p>
          <p
            data-testid="kaam-stat-total"
            className="mt-1 text-2xl font-bold text-[#003d20]"
          >
            {totalKaam !== null ? totalKaam : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            This Month
          </p>
          <p
            data-testid="kaam-stat-this-month"
            className="mt-1 text-2xl font-bold text-slate-900"
          >
            {thisMonthCount}
          </p>
          {thisMonth && (
            <p className="text-[11px] text-slate-500">{thisMonth.month}</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Last Month
          </p>
          <p
            data-testid="kaam-stat-last-month"
            className="mt-1 text-2xl font-bold text-slate-900"
          >
            {lastMonthCount}
          </p>
          {lastMonth && (
            <p className="text-[11px] text-slate-500">{lastMonth.month}</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Growth
          </p>
          <p
            data-testid="kaam-stat-growth"
            className={`mt-1 text-2xl font-bold ${growthClass}`}
          >
            {growthLabel}
          </p>
          <p className="text-[11px] text-slate-500">vs last month</p>
        </div>
      </div>

      {analyticsTruncated && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing analytics for the most recent task window only. Older
          rows fall outside the scan limit.
        </p>
      )}

      {/*
        Area-wise Category Demand matrix is intentionally not rendered
        in the in-page KaamTab right now — admin UI stays compact. The
        backend keeps shipping `areaCategoryDemand` so the upcoming
        Monthly Report (GET /api/admin/reports/monthly-demand) can
        reuse the aggregation pipeline server-side.
      */}
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────
// Monthly Report panel — admin picks a YYYY-MM, calls
// /api/admin/reports/monthly-demand, and renders the response as
// compact summary cards + tables. First-pass UI: no PDF/CSV export
// yet (Phase 2 lands those + email + scheduled sends).
// ───────────────────────────────────────────────────────────────────

type MonthlyReport = {
  month: string;
  summary: {
    totalKaam: number;
    topCategory: string | null;
    topArea: string | null;
    topRegion: string | null;
    noProviderMatchedCount: number;
    newCategoryRequestsCount: number;
  };
  categoryDemand: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  areaDemand: Array<{
    area: string;
    region: string;
    count: number;
  }>;
  regionDemand: Array<{ region: string; count: number }>;
  regionCategoryDemand: Array<{
    region: string;
    category: string;
    count: number;
  }>;
  operationalIssues: Array<{
    type: string;
    count: number;
    note: string;
  }>;
};

type MonthlyReportResponse = {
  success?: boolean;
  month?: string;
  error?: string;
} & Partial<MonthlyReport>;

function defaultMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function MonthlyReportPanel(): ReactElement {
  const [month, setMonth] = useState<string>(defaultMonthKey());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(
        `/api/admin/reports/monthly-demand?month=${encodeURIComponent(month)}`,
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        }
      );
      const json = (await res
        .json()
        .catch(() => ({}))) as MonthlyReportResponse;
      if (!res.ok || !json?.success) {
        setError(json?.error || `Failed to load report (${res.status})`);
        return;
      }
      setReport({
        month: String(json.month ?? month),
        summary: json.summary ?? {
          totalKaam: 0,
          topCategory: null,
          topArea: null,
          topRegion: null,
          noProviderMatchedCount: 0,
          newCategoryRequestsCount: 0,
        },
        categoryDemand: Array.isArray(json.categoryDemand)
          ? json.categoryDemand
          : [],
        areaDemand: Array.isArray(json.areaDemand) ? json.areaDemand : [],
        regionDemand: Array.isArray(json.regionDemand)
          ? json.regionDemand
          : [],
        regionCategoryDemand: Array.isArray(json.regionCategoryDemand)
          ? json.regionCategoryDemand
          : [],
        operationalIssues: Array.isArray(json.operationalIssues)
          ? json.operationalIssues
          : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      data-testid="kaam-monthly-report"
      className="mt-5 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            Monthly Report
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Pick a month, then generate the live report from current
            Supabase data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-700">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              data-testid="kaam-monthly-report-month-input"
              className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading || !month}
            data-testid="kaam-monthly-report-generate"
            className="inline-flex items-center rounded-lg bg-[#003d20] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005533] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating…" : "Generate Report"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {report && (
        <div
          data-testid="kaam-monthly-report-result"
          className="mt-4 space-y-4"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Month
              </p>
              <p
                data-testid="kaam-monthly-report-summary-month"
                className="mt-1 text-base font-bold text-slate-900"
              >
                {report.month}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total Kaam
              </p>
              <p
                data-testid="kaam-monthly-report-summary-total"
                className="mt-1 text-base font-bold text-[#003d20]"
              >
                {report.summary.totalKaam}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Top Category
              </p>
              <p
                data-testid="kaam-monthly-report-summary-top-category"
                className="mt-1 text-base font-semibold text-slate-900"
              >
                {report.summary.topCategory ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Top Area
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {report.summary.topArea ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Top Region
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {report.summary.topRegion ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                No Providers
              </p>
              <p className="mt-1 text-base font-bold text-amber-900">
                {report.summary.noProviderMatchedCount}
              </p>
            </div>
          </div>

          {report.categoryDemand.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <caption className="bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Category Demand
                </caption>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-right">Count</th>
                    <th className="px-3 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.categoryDemand.map((c) => (
                    <tr key={c.category}>
                      <td className="px-3 py-1.5 text-slate-800">
                        {c.category}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {c.count}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {c.percentage}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function KaamTab({
  unread,
  onMarkRead,
}: KaamTabProps = {}) {
  // Open-transition guard so mark-read fires exactly once per
  // closed → open cycle, not on every re-render while open.
  const markReadFiredRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [kaam, setKaam] = useState<KaamRow[] | null>(null);
  const [totalKaam, setTotalKaam] = useState<number | null>(null);
  const [monthlyKaam, setMonthlyKaam] = useState<MonthlyKaamPoint[]>([]);
  const [analyticsTruncated, setAnalyticsTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-fetch trigger — bumping the key forces the data effect to re-run
  // after a successful reprocess so the row's lifecycleStep/badge state
  // moves forward without a full page reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [reprocessStatus, setReprocessStatus] = useState<
    Record<string, ReprocessStatus>
  >({});
  // Show-more toggle for the kaam table. Defaults to the top 5 most
  // recent rows; admin can opt into the full list. Resets to false
  // when the accordion is closed so reopening starts compact again.
  const [showAllKaam, setShowAllKaam] = useState(false);

  useEffect(() => {
    // Reset the show-more toggle when the accordion closes so the
    // next reopen starts compact.
    if (!isOpen) setShowAllKaam(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      markReadFiredRef.current = false;
      return;
    }
    if (markReadFiredRef.current) return;
    markReadFiredRef.current = true;
    onMarkRead?.();
  }, [isOpen, onMarkRead]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/admin/kaam", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as LoadResponse;
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(json?.error || `Failed to load Kaam (${res.status})`);
          setKaam([]);
          setTotalKaam(0);
          setMonthlyKaam([]);
          setAnalyticsTruncated(false);
          return;
        }
        setKaam(Array.isArray(json.kaam) ? json.kaam : []);
        setTotalKaam(
          typeof json.totalKaam === "number" ? json.totalKaam : 0
        );
        setMonthlyKaam(
          Array.isArray(json.monthlyKaam) ? json.monthlyKaam : []
        );
        setAnalyticsTruncated(Boolean(json.analyticsTruncated));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setKaam([]);
        setTotalKaam(0);
        setMonthlyKaam([]);
        setAnalyticsTruncated(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshKey]);

  const summary =
    totalKaam !== null
      ? `${totalKaam} Kaam created`
      : "Created requests and Kaam numbers";

  async function handleReprocess(row: KaamRow): Promise<void> {
    if (!row.taskId) return;
    setReprocessing(row.taskId);
    setReprocessStatus((prev) => {
      const next = { ...prev };
      delete next[row.taskId];
      return next;
    });
    try {
      const res = await fetch("/api/admin/kaam/reprocess", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: row.taskId }),
      });
      const json = (await res
        .json()
        .catch(() => ({}))) as ReprocessResponse;

      if (json?.reason === "category_not_approved") {
        setReprocessStatus((prev) => ({
          ...prev,
          [row.taskId]: {
            kind: "error",
            message:
              "Category is still not approved. Approve it first, then reprocess.",
          },
        }));
        return;
      }

      if (!res.ok || !json?.success) {
        setReprocessStatus((prev) => ({
          ...prev,
          [row.taskId]: {
            kind: "error",
            message:
              json?.error ||
              json?.message ||
              `Reprocess failed (${res.status}).`,
          },
        }));
        return;
      }

      const matched = json.matchedCount ?? 0;
      const notified = json.notifiedCount ?? 0;
      const message = json.skipped
        ? `Already processed (${json.skippedReason || "no changes"}).`
        : `Matched ${matched} provider${matched === 1 ? "" : "s"}, notified ${notified}.`;

      setReprocessStatus((prev) => ({
        ...prev,
        [row.taskId]: { kind: "success", message },
      }));
      // Refetch so lifecycleStep / badge / status all update.
      setRefreshKey((v) => v + 1);
    } catch (err) {
      setReprocessStatus((prev) => ({
        ...prev,
        [row.taskId]: {
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      }));
    } finally {
      setReprocessing(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="kaam-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="flex items-center text-base font-semibold text-slate-900">
            Kaam
            <UnreadBadge unread={unread} testId="kaam-unread-badge" />
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{summary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div id="kaam-tab-body" className="border-t border-slate-200 px-5 py-5">
          <KaamAnalytics
            totalKaam={totalKaam}
            monthlyKaam={monthlyKaam}
            analyticsTruncated={analyticsTruncated}
          />
          <MonthlyReportPanel />

          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading && !kaam && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              Loading Kaam…
            </p>
          )}

          {!loading && kaam && kaam.length === 0 && !error && (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              No Kaam found yet.
            </p>
          )}

          {kaam && kaam.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Kaam No
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Phone
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Category
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Area
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Created
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      When Required
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {(showAllKaam ? kaam : kaam.slice(0, 5)).map((row, index) => {
                    const total = row.lifecycleTotalSteps || 5;
                    const step = Math.max(
                      1,
                      Math.min(total, row.lifecycleStep || 1)
                    );
                    const progressPct = Math.round((step / total) * 100);
                    const isReprocessing = reprocessing === row.taskId;
                    const reprocessFeedback = reprocessStatus[row.taskId];
                    const rowAttentionClass = row.isNewServiceCategory
                      ? "bg-amber-50/60"
                      : "";

                    return (
                      <tr
                        key={row.taskId || row.kaamNo || `kaam-${index}`}
                        className={rowAttentionClass}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-900">
                          {row.kaamNo ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">
                          {row.phone ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {row.category ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {row.area ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 align-top">
                          <div className="flex min-w-[180px] flex-col gap-1.5">
                            {row.isNewServiceCategory && (
                              <span
                                data-testid="kaam-new-service-category-badge"
                                className="inline-flex w-fit items-center rounded-full border-2 border-amber-500 bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-900"
                              >
                                {row.statusAttentionLabel ??
                                  "New Service Category"}
                              </span>
                            )}
                            <span
                              data-testid={`kaam-lifecycle-${row.taskId || index}`}
                              className={`text-sm ${stepTextClass(row)}`}
                            >
                              {step}/{total} {row.lifecycleStatus}
                            </span>
                            <div
                              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={total}
                              aria-valuenow={step}
                              aria-label={`Lifecycle step ${step} of ${total}`}
                            >
                              <div
                                className={`h-full rounded-full transition-all ${progressBarColor(row)}`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            {row.isNewServiceCategory && (
                              <div className="mt-1 flex flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleReprocess(row)}
                                  disabled={isReprocessing}
                                  data-testid={`kaam-reprocess-${row.taskId}`}
                                  className="inline-flex w-fit items-center rounded-md border border-amber-600 bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isReprocessing
                                    ? "Reprocessing…"
                                    : "Reprocess Kaam"}
                                </button>
                                {reprocessFeedback && (
                                  <p
                                    data-testid={`kaam-reprocess-feedback-${row.taskId}`}
                                    className={`text-xs ${
                                      reprocessFeedback.kind === "success"
                                        ? "text-emerald-700"
                                        : "text-red-700"
                                    }`}
                                  >
                                    {reprocessFeedback.message}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                          {formatDate(row.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                          {row.whenRequired ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {kaam && kaam.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllKaam((v) => !v)}
              data-testid="kaam-show-toggle"
              className="mt-3 inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {showAllKaam
                ? "Show less"
                : `Show all Kaam (${kaam.length - 5} more)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
