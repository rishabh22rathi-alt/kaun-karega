"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import UnreadBadge, { type UnreadIndicator } from "./UnreadBadge";

// User-reported issues accordion for /admin/dashboard.
//
// Reads:   POST /api/kk  { action: "admin_get_issue_reports" }
// Mutates: POST /api/kk  { action: "admin_update_issue_report_status",
//                          IssueID, Status }
//          — admin-driven status transitions (in_progress / resolved /
//          closed) via the per-row Actions column.
//
// Data source: lib/admin/adminIssueReports.ts → issue_reports table.
// The IssueReportPayload shape is documented there and is the same
// shape the existing /api/kk action returns, so this component reads
// it verbatim without re-mapping. The same helper's
// `updateIssueReportStatusFromSupabase` powers the Actions column;
// it bumps `updated_at` and writes the new `status` value to the
// existing column (no new migration — the `closed` literal was just
// added to the helper whitelist).
//
// Why a new tab (not a reuse of ReportsTab):
//   ReportsTab is the PDF "Report Generation" surface — monthly /
//   business summaries built off Supabase aggregates. User-submitted
//   issue reports are a different domain (per-user bug/feedback rows
//   with their own status lifecycle) and must not be mixed in.

type IssueReportRow = {
  IssueID: string;
  IssueNo: number;
  CreatedAt: string;
  UpdatedAt: string;
  ReporterRole: string;
  ReporterPhone: string;
  ReporterName: string;
  IssueType: string;
  // Optional legacy/extended fields some mocks and pre-canonical rows
  // still ship. The canonical schema doesn't store these, so we treat
  // them as "show if present, skip otherwise" — no fallback required.
  IssuePage?: string;
  Category?: string;
  Area?: string;
  Description: string;
  Status: string;
  AdminNotes: string;
};

type GetIssueReportsResponse = {
  ok?: boolean;
  status?: string;
  reports?: IssueReportRow[];
  error?: string;
};

type IssueReportsTabProps = {
  // When true on mount (or when it flips to true via the URL ?tab=
  // query), the accordion auto-opens. Sidebar deep-links flow through
  // this prop — see app/admin/dashboard/page.tsx.
  defaultOpen?: boolean;
  // Per-tab unread state surfaced from useAdminUnread on the dashboard
  // page. When `unread.hasUnread` is true, an orange "NEW" pill renders
  // next to the title; opening the accordion fires `onMarkRead`, which
  // optimistically clears the dot and POSTs /api/admin/mark-tab-read.
  unread?: UnreadIndicator | null;
  onMarkRead?: () => void;
};

function formatDate(value: string | null | undefined): string {
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

// Normalises the assorted status spellings the backend might emit
// ("Open", "open", "In Progress", "in_progress", "Resolved",
// "Closed", "rejected") into the four UX buckets we render.
type StatusBucket = "open" | "in_progress" | "resolved" | "closed";

function bucketStatus(raw: string | null | undefined): StatusBucket {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "in_progress" || normalized === "inprogress") {
    return "in_progress";
  }
  if (normalized === "resolved") return "resolved";
  if (normalized === "closed" || normalized === "rejected") return "closed";
  return "open";
}

const STATUS_BADGE_CLASS: Record<StatusBucket, string> = {
  open:
    "border-amber-300 bg-amber-100 text-amber-800",
  in_progress:
    "border-blue-300 bg-blue-100 text-blue-800",
  resolved:
    "border-emerald-300 bg-emerald-100 text-emerald-800",
  closed: "border-slate-300 bg-slate-100 text-slate-700",
};

const STATUS_LABEL: Record<StatusBucket, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

function StatusBadge({ status }: { status: string }) {
  const bucket = bucketStatus(status);
  return (
    <span
      data-testid={`issue-reports-status-${bucket}`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_BADGE_CLASS[bucket]}`}
    >
      {STATUS_LABEL[bucket]}
    </span>
  );
}

function ReporterCell({ row }: { row: IssueReportRow }) {
  const phone = row.ReporterPhone?.trim() || "—";
  const role = row.ReporterRole?.trim() || "user";
  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-mono text-slate-900">{phone}</span>
      <span className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">
        {role}
      </span>
    </div>
  );
}

function ContextCell({ row }: { row: IssueReportRow }) {
  // Only render context lines that exist on the row. Canonical schema
  // doesn't carry Category/Area/IssuePage, but some legacy mocks and
  // older rows do — surface them when present so the admin doesn't
  // lose information.
  const lines: Array<{ label: string; value: string }> = [];
  if (row.Category && row.Category.trim()) {
    lines.push({ label: "Category", value: row.Category.trim() });
  }
  if (row.Area && row.Area.trim()) {
    lines.push({ label: "Area", value: row.Area.trim() });
  }
  if (row.IssuePage && row.IssuePage.trim()) {
    lines.push({ label: "Page", value: row.IssuePage.trim() });
  }
  if (lines.length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs text-slate-700">
      {lines.map((l) => (
        <span key={l.label}>
          <span className="font-semibold text-slate-500">{l.label}:</span>{" "}
          {l.value}
        </span>
      ))}
    </div>
  );
}

// Allowed admin-driven status transitions, keyed by current bucket.
// `closed` rows are read-only (no entries listed → no buttons).
// `resolved` is intentionally one-way to `closed` here; "reopening"
// to in_progress/open isn't part of the admin actions spec and would
// also clobber `updated_at` for no operational gain.
const ALLOWED_TRANSITIONS: Record<StatusBucket, StatusBucket[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

const ACTION_LABEL: Record<StatusBucket, string> = {
  open: "Reopen",
  in_progress: "Mark In Progress",
  resolved: "Mark Solved",
  closed: "Close",
};

// Per-action button styling — visually echoes the target status badge
// so the admin can scan the row and intuit "this button takes the row
// to that state".
const ACTION_BUTTON_CLASS: Record<StatusBucket, string> = {
  open: "border-amber-600 bg-amber-600 hover:bg-amber-700",
  in_progress: "border-blue-600 bg-blue-600 hover:bg-blue-700",
  resolved: "border-emerald-600 bg-emerald-600 hover:bg-emerald-700",
  closed: "border-slate-600 bg-slate-600 hover:bg-slate-700",
};

// `closed` is the canonical literal we write from the new admin
// actions. Legacy `rejected` rows still display as Closed in the UI
// (see bucketStatus) but the action buttons always write the
// canonical value.
const BUCKET_TO_SERVER_STATUS: Record<StatusBucket, string> = {
  open: "open",
  in_progress: "in_progress",
  resolved: "resolved",
  closed: "closed",
};

type UpdateResponse = {
  ok?: boolean;
  status?: string;
  issueId?: string;
  nextStatus?: string;
  error?: string;
};

export default function IssueReportsTab({
  defaultOpen = false,
  unread,
  onMarkRead,
}: IssueReportsTabProps = {}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // Guard so the mark-read fires once per "false → true" open
  // transition rather than every re-render while the body is open.
  const markReadFiredRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      markReadFiredRef.current = false;
      return;
    }
    if (markReadFiredRef.current) return;
    markReadFiredRef.current = true;
    onMarkRead?.();
  }, [isOpen, onMarkRead]);
  const [reports, setReports] = useState<IssueReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row optimistic update state. `updatingId` is the row whose
  // network update is in flight (used to disable that row's buttons).
  // `actionErrors` is the per-row error map shown inline beneath the
  // action buttons; cleared on the next successful attempt.
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>(
    {}
  );

  // Honour a later flip to defaultOpen=true (sidebar deep-link while
  // the user is already on /admin/dashboard). We never auto-close on
  // a flip to false — the admin may have explicitly opened the tab.
  useEffect(() => {
    if (defaultOpen) setIsOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/kk", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_get_issue_reports" }),
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res
          .json()
          .catch(() => ({}))) as GetIssueReportsResponse;
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setError(
            json?.error || `Failed to load issue reports (${res.status})`
          );
          setReports([]);
          return;
        }
        setReports(Array.isArray(json.reports) ? json.reports : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const summary =
    reports !== null
      ? `${reports.length} issue${reports.length === 1 ? "" : "s"} reported`
      : "User-submitted issues and feedback";

  async function handleStatusAction(
    row: IssueReportRow,
    nextBucket: StatusBucket
  ): Promise<void> {
    if (!row.IssueID) return;
    const issueId = row.IssueID;
    const previousStatus = row.Status;
    const nextServerStatus = BUCKET_TO_SERVER_STATUS[nextBucket];

    // Optimistic update — flip the row's status (and bump UpdatedAt
    // to "now" so the timeline reflects the local action) before the
    // network round-trip lands. Errors below revert this.
    const nowIso = new Date().toISOString();
    setReports((prev) =>
      prev
        ? prev.map((r) =>
            r.IssueID === issueId
              ? { ...r, Status: nextServerStatus, UpdatedAt: nowIso }
              : r
          )
        : prev
    );
    setUpdatingId(issueId);
    setActionErrors((prev) => {
      if (!(issueId in prev)) return prev;
      const next = { ...prev };
      delete next[issueId];
      return next;
    });

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_update_issue_report_status",
          IssueID: issueId,
          Status: nextServerStatus,
        }),
        cache: "no-store",
      });
      const json = (await res
        .json()
        .catch(() => ({}))) as UpdateResponse;

      if (!res.ok || !json?.ok) {
        // Revert the optimistic update — the row didn't actually move.
        setReports((prev) =>
          prev
            ? prev.map((r) =>
                r.IssueID === issueId
                  ? { ...r, Status: previousStatus, UpdatedAt: row.UpdatedAt }
                  : r
              )
            : prev
        );
        setActionErrors((prev) => ({
          ...prev,
          [issueId]:
            json?.error ||
            `Failed to update status (${res.status}). Please retry.`,
        }));
        return;
      }
      // Success path: the optimistic update is correct. If the server
      // echoed a different status string (e.g. it normalised case),
      // adopt that one so the badge matches what was persisted.
      if (
        typeof json.nextStatus === "string" &&
        json.nextStatus &&
        json.nextStatus !== nextServerStatus
      ) {
        setReports((prev) =>
          prev
            ? prev.map((r) =>
                r.IssueID === issueId
                  ? { ...r, Status: String(json.nextStatus) }
                  : r
              )
            : prev
        );
      }
    } catch (err) {
      setReports((prev) =>
        prev
          ? prev.map((r) =>
              r.IssueID === issueId
                ? { ...r, Status: previousStatus, UpdatedAt: row.UpdatedAt }
                : r
            )
          : prev
      );
      setActionErrors((prev) => ({
        ...prev,
        [issueId]: err instanceof Error ? err.message : "Network error",
      }));
    } finally {
      setUpdatingId((curr) => (curr === issueId ? null : curr));
    }
  }

  return (
    <section
      data-testid="issue-reports-tab"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="issue-reports-tab-body"
        data-testid="issue-reports-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="flex items-center text-base font-semibold text-slate-900">
            Reports
            <UnreadBadge unread={unread} testId="reports-unread-badge" />
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
        <div
          id="issue-reports-tab-body"
          className="border-t border-slate-200 px-5 py-5"
        >
          {error && (
            <p
              data-testid="issue-reports-error"
              className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          {loading && !reports && (
            <p
              data-testid="issue-reports-loading"
              className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              Loading issue reports…
            </p>
          )}

          {!loading && reports && reports.length === 0 && !error && (
            <p
              data-testid="issue-reports-empty"
              className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              No issues reported yet.
            </p>
          )}

          {reports && reports.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table
                data-testid="issue-reports-table"
                className="min-w-full divide-y divide-slate-200 text-sm"
              >
                <thead className="bg-slate-50">
                  <tr>
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
                      Reporter
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
                      Context
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Message
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
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {reports.map((row, index) => {
                    const displayNo =
                      row.IssueNo > 0
                        ? `#${row.IssueNo}`
                        : row.IssueID
                          ? row.IssueID.slice(0, 8)
                          : `row-${index}`;
                    return (
                      <tr
                        key={row.IssueID || `issue-${index}`}
                        data-testid={`issue-reports-row-${row.IssueID || index}`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 align-top">
                          <div className="flex min-w-0 flex-col">
                            <span className="font-mono font-semibold text-slate-900">
                              {displayNo}
                            </span>
                            {row.IssueNo > 0 && row.IssueID ? (
                              <span
                                className="mt-0.5 truncate text-[10px] text-slate-400"
                                title={row.IssueID}
                              >
                                {row.IssueID.slice(0, 8)}…
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-top">
                          <ReporterCell row={row} />
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700">
                          {row.IssueType?.trim() || "—"}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <ContextCell row={row} />
                        </td>
                        <td className="max-w-[26rem] px-4 py-3 align-top">
                          <p className="whitespace-pre-wrap break-words text-slate-700">
                            {row.Description?.trim() || "—"}
                          </p>
                          {row.AdminNotes && row.AdminNotes.trim() ? (
                            <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                              <span className="font-semibold">Admin note:</span>{" "}
                              {row.AdminNotes.trim()}
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-top">
                          <StatusBadge status={row.Status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-top text-slate-700">
                          {formatDate(row.CreatedAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 align-top">
                          {(() => {
                            const currentBucket = bucketStatus(row.Status);
                            const allowed =
                              ALLOWED_TRANSITIONS[currentBucket];
                            const isUpdating = updatingId === row.IssueID;
                            const rowError = actionErrors[row.IssueID];

                            if (allowed.length === 0) {
                              // Closed → read-only. We surface the
                              // state explicitly so the column isn't
                              // visually empty (would otherwise read
                              // as "actions failed to render").
                              return (
                                <div className="flex flex-col gap-1">
                                  <span
                                    data-testid={`issue-reports-readonly-${row.IssueID}`}
                                    className="inline-flex w-fit items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500"
                                  >
                                    Read only
                                  </span>
                                  {rowError ? (
                                    <p
                                      data-testid={`issue-reports-action-error-${row.IssueID}`}
                                      className="text-xs text-red-700"
                                    >
                                      {rowError}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            }

                            return (
                              <div className="flex flex-col gap-1.5">
                                {allowed.map((target) => (
                                  <button
                                    key={target}
                                    type="button"
                                    onClick={() =>
                                      void handleStatusAction(row, target)
                                    }
                                    disabled={isUpdating}
                                    data-testid={`issue-reports-action-${target}-${row.IssueID}`}
                                    className={`inline-flex w-fit items-center rounded-md border px-2.5 py-1 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${ACTION_BUTTON_CLASS[target]}`}
                                  >
                                    {isUpdating
                                      ? "Updating…"
                                      : ACTION_LABEL[target]}
                                  </button>
                                ))}
                                {rowError ? (
                                  <p
                                    data-testid={`issue-reports-action-error-${row.IssueID}`}
                                    className="text-xs text-red-700"
                                  >
                                    {rowError}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
