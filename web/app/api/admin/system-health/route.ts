import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/system-health
//
// First-pass operational monitoring tile. Surfaces critical/warning/info
// alerts derived from existing Supabase tables — no new logging
// framework, no mutations, no auto-fixes.
//
// Source tables (all confirmed in use elsewhere):
//   - notification_logs           — WhatsApp send statuses ("accepted" /
//                                   "error" / "failed"). Critical when
//                                   recent rows landed in error/failed.
//   - tasks                       — status field. Warning when stuck in
//                                   "no_providers_matched" /
//                                   "pending_category_review" / a
//                                   "notified" row that hasn't received
//                                   a provider response within
//                                   RESPONSE_TIMEOUT_HOURS (mirroring
//                                   web/app/api/admin/task-monitor).
//   - provider_task_matches       — used to detect tasks that were
//                                   matched but whose entire WhatsApp
//                                   fan-out errored (critical).
//   - area_review_queue           — unresolved area review items
//                                   (warning).
//   - issue_reports               — user-reported issues with open
//                                   status (info).
//   - pending_category_requests   — open category requests (info).
//
// Alert objects are produced read-only — this endpoint never writes to
// any table. The `status` field on each alert mirrors the source row's
// own lifecycle (e.g. notification_log.status, tasks.status) so the
// admin can tell which alerts are still actionable.

const ALERT_LIMIT = 100;

// Mirrors the constant used by web/app/api/admin/task-monitor/route.ts
// so "notified but provider hasn't responded" alerts fire on the same
// window as the existing traffic-light surface.
const RESPONSE_TIMEOUT_HOURS = 2;

// "pending_category_review" tasks created within this window are
// treated as still-fresh — only older ones surface as warnings so the
// admin's queue doesn't fill up the moment a new request lands.
const PENDING_CATEGORY_FRESH_MIN = 30;

const NOTIFICATION_LOG_LOOKBACK_DAYS = 7;

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

// Severity ranking for the final sort.
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

type NotificationLogRow = {
  log_id: string | null;
  created_at: string | null;
  task_id: string | null;
  display_id: string | number | null;
  provider_id: string | null;
  category: string | null;
  area: string | null;
  status: string | null;
  status_code: number | null;
  error_message: string | null;
};

type TaskRow = {
  task_id: string | null;
  display_id: string | number | null;
  category: string | null;
  area: string | null;
  status: string | null;
  created_at: string | null;
};

type AreaReviewRow = {
  review_id: string | null;
  raw_area: string | null;
  status: string | null;
  occurrences: number | null;
  source_type: string | null;
  last_seen_at: string | null;
};

type IssueReportRow = {
  id: string | null;
  issue_no: string | number | null;
  created_at: string | null;
  reporter_type: string | null;
  issue_type: string | null;
  message: string | null;
  status: string | null;
};

type PendingCategoryRow = {
  id: string | null;
  requested_category: string | null;
  area: string | null;
  created_at: string | null;
  status: string | null;
};

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function displayLabelForTask(taskId: string | null, displayId: unknown): string {
  const raw = String(displayId ?? "").trim();
  if (raw) return `Kaam No. ${raw}`;
  return strOrNull(taskId) ?? "—";
}

// Truncate verbose provider/Meta error strings before surfacing in the
// UI so a raw stack/Meta payload never leaks. The admin sees the
// trimmed sentence; the full string stays in notification_logs for
// engineering debugging.
function sanitizeErrorMessage(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "WhatsApp delivery failed.";
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return "WhatsApp delivery failed.";
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const now = Date.now();
  const lookbackIso = new Date(
    now - NOTIFICATION_LOG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const responseTimeoutMs = RESPONSE_TIMEOUT_HOURS * 60 * 60 * 1000;
  const pendingCategoryFreshMs = PENDING_CATEGORY_FRESH_MIN * 60 * 1000;

  // Six parallel reads — each is non-fatal. A failure on one table
  // simply omits that alert family rather than blanking the tile.
  const [
    notifLogsRes,
    tasksRes,
    matchesRes,
    areaReviewsRes,
    issueReportsRes,
    pendingCategoryRes,
  ] = await Promise.all([
    adminSupabase
      .from("notification_logs")
      .select(
        "log_id, created_at, task_id, display_id, provider_id, category, area, status, status_code, error_message"
      )
      .in("status", ["error", "failed"])
      .gte("created_at", lookbackIso)
      .order("created_at", { ascending: false })
      .limit(50),
    adminSupabase
      .from("tasks")
      .select(
        "task_id, display_id, category, area, status, created_at"
      )
      .in("status", [
        "no_providers_matched",
        "pending_category_review",
        "notified",
        "matched",
      ])
      .order("created_at", { ascending: false })
      .limit(200),
    adminSupabase
      .from("provider_task_matches")
      .select("task_id"),
    adminSupabase
      .from("area_review_queue")
      .select(
        "review_id, raw_area, status, occurrences, source_type, last_seen_at"
      )
      .eq("status", "pending")
      .order("last_seen_at", { ascending: false })
      .limit(30),
    adminSupabase
      .from("issue_reports")
      .select(
        "id, issue_no, created_at, reporter_type, issue_type, message, status"
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(30),
    adminSupabase
      .from("pending_category_requests")
      .select("id, requested_category, area, created_at, status")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (notifLogsRes.error) {
    console.warn(
      "[admin/system-health] notification_logs read failed:",
      notifLogsRes.error
    );
  }
  if (tasksRes.error) {
    console.warn(
      "[admin/system-health] tasks read failed:",
      tasksRes.error
    );
  }
  if (matchesRes.error) {
    console.warn(
      "[admin/system-health] provider_task_matches read failed:",
      matchesRes.error
    );
  }
  if (areaReviewsRes.error) {
    console.warn(
      "[admin/system-health] area_review_queue read failed:",
      areaReviewsRes.error
    );
  }
  if (issueReportsRes.error) {
    console.warn(
      "[admin/system-health] issue_reports read failed:",
      issueReportsRes.error
    );
  }
  if (pendingCategoryRes.error) {
    console.warn(
      "[admin/system-health] pending_category_requests read failed:",
      pendingCategoryRes.error
    );
  }

  const notifLogs = (notifLogsRes.data ?? []) as NotificationLogRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const matches = (matchesRes.data ?? []) as Array<{ task_id: string | null }>;
  const areaReviews = (areaReviewsRes.data ?? []) as AreaReviewRow[];
  const issueReports = (issueReportsRes.data ?? []) as IssueReportRow[];
  const pendingCategoryRequests = (pendingCategoryRes.data ??
    []) as PendingCategoryRow[];

  const alerts: Alert[] = [];

  // ─── CRITICAL: per-log WhatsApp send failures in the last 7 days ──
  for (const log of notifLogs) {
    const id = strOrNull(log.log_id);
    if (!id) continue;
    alerts.push({
      id: `notif_log:${id}`,
      severity: "critical",
      type: "whatsapp_send_failed",
      title: "WhatsApp send failed",
      message: sanitizeErrorMessage(log.error_message),
      source: "notification_logs",
      relatedId: strOrNull(log.task_id),
      created_at: strOrNull(log.created_at),
      status: lower(log.status) === "failed" ? "open" : "open",
    });
  }

  // ─── CRITICAL: matched tasks whose every notification errored ─────
  // A task is considered "matched" for this rule if at least one
  // provider_task_matches row exists for it. A failure for that task
  // means EVERY notification_log row we've seen for it is in error/
  // failed (no "accepted" row). This is the strongest signal that the
  // fan-out died completely.
  if (notifLogs.length > 0) {
    const matchedTaskIds = new Set(
      matches.map((m) => strOrNull(m.task_id)).filter(Boolean) as string[]
    );
    const taskAcceptedStatus = new Map<string, boolean>();
    // Re-read accepted notifications across the same lookback window
    // so we can tell "all errored" apart from "errored but other sends
    // succeeded." This is a separate cheap read — non-fatal.
    const acceptedRes = await adminSupabase
      .from("notification_logs")
      .select("task_id")
      .eq("status", "accepted")
      .gte("created_at", lookbackIso)
      .limit(1000);
    if (!acceptedRes.error) {
      for (const row of (acceptedRes.data ?? []) as Array<{
        task_id: string | null;
      }>) {
        const t = strOrNull(row.task_id);
        if (t) taskAcceptedStatus.set(t, true);
      }
    } else {
      console.warn(
        "[admin/system-health] accepted-notifications side read failed:",
        acceptedRes.error
      );
    }
    // Distinct task_ids that appeared in the failed-logs set.
    const failedTaskIds = new Set(
      notifLogs.map((l) => strOrNull(l.task_id)).filter(Boolean) as string[]
    );
    for (const taskId of failedTaskIds) {
      if (!matchedTaskIds.has(taskId)) continue;
      if (taskAcceptedStatus.get(taskId)) continue;
      alerts.push({
        id: `task_all_notifs_failed:${taskId}`,
        severity: "critical",
        type: "task_notifications_all_failed",
        title: "All provider notifications failed",
        message:
          "Task was matched but every WhatsApp send to its providers errored. Investigate template/Meta status.",
        source: "provider_task_matches+notification_logs",
        relatedId: taskId,
        created_at: null,
        status: "open",
      });
    }
  }

  // ─── WARNING: tasks stuck in problem statuses ─────────────────────
  for (const task of tasks) {
    const taskId = strOrNull(task.task_id);
    if (!taskId) continue;
    const status = lower(task.status);
    const createdAtMs = task.created_at
      ? new Date(task.created_at).getTime()
      : 0;
    const ageMs = createdAtMs ? now - createdAtMs : 0;

    if (status === "no_providers_matched") {
      alerts.push({
        id: `task_no_providers:${taskId}`,
        severity: "warning",
        type: "no_providers_matched",
        title: "No providers matched",
        message: `${displayLabelForTask(taskId, task.display_id)} in ${strOrNull(task.area) ?? "—"} (${strOrNull(task.category) ?? "—"}) found no eligible providers.`,
        source: "tasks",
        relatedId: taskId,
        created_at: strOrNull(task.created_at),
        status: "open",
      });
    } else if (
      status === "pending_category_review" &&
      ageMs >= pendingCategoryFreshMs
    ) {
      alerts.push({
        id: `task_pending_category:${taskId}`,
        severity: "warning",
        type: "pending_category_review",
        title: "Pending category review",
        message: `${displayLabelForTask(taskId, task.display_id)} requested category "${strOrNull(task.category) ?? "—"}" — awaiting admin approval.`,
        source: "tasks",
        relatedId: taskId,
        created_at: strOrNull(task.created_at),
        status: "open",
      });
    } else if (
      status === "notified" &&
      createdAtMs &&
      ageMs >= responseTimeoutMs
    ) {
      alerts.push({
        id: `task_no_response:${taskId}`,
        severity: "warning",
        type: "task_no_provider_response",
        title: "No provider response yet",
        message: `${displayLabelForTask(taskId, task.display_id)} notified providers more than ${RESPONSE_TIMEOUT_HOURS}h ago with no response.`,
        source: "tasks",
        relatedId: taskId,
        created_at: strOrNull(task.created_at),
        status: "open",
      });
    } else if (status === "matched" && createdAtMs && ageMs >= responseTimeoutMs) {
      // Matched but never moved to notified — the WhatsApp fan-out
      // didn't run or didn't land. Surface it so admin can rerun.
      alerts.push({
        id: `task_matched_not_notified:${taskId}`,
        severity: "warning",
        type: "task_matched_not_notified",
        title: "Matched but not notified",
        message: `${displayLabelForTask(taskId, task.display_id)} has matched providers but no notification went out.`,
        source: "tasks",
        relatedId: taskId,
        created_at: strOrNull(task.created_at),
        status: "open",
      });
    }
  }

  // ─── WARNING: unresolved area_review_queue items ──────────────────
  for (const review of areaReviews) {
    const reviewId = strOrNull(review.review_id);
    if (!reviewId) continue;
    const occurrences = Number(review.occurrences ?? 0);
    alerts.push({
      id: `area_review:${reviewId}`,
      severity: "warning",
      type: "area_review_pending",
      title: "Unmapped area awaiting review",
      message: `"${strOrNull(review.raw_area) ?? "—"}" seen ${occurrences} time${occurrences === 1 ? "" : "s"} from ${strOrNull(review.source_type) ?? "providers"} — not yet mapped to a canonical area.`,
      source: "area_review_queue",
      relatedId: reviewId,
      created_at: strOrNull(review.last_seen_at),
      status: "open",
    });
  }

  // ─── INFO: open issue reports ─────────────────────────────────────
  for (const report of issueReports) {
    const reportId = strOrNull(report.id);
    if (!reportId) continue;
    alerts.push({
      id: `issue_report:${reportId}`,
      severity: "info",
      type: "user_issue_report",
      title: `Issue reported by ${strOrNull(report.reporter_type) ?? "user"}`,
      message:
        strOrNull(report.message)?.slice(0, 200) ??
        strOrNull(report.issue_type) ??
        "Issue report submitted.",
      source: "issue_reports",
      relatedId: strOrNull(report.issue_no as unknown) ?? reportId,
      created_at: strOrNull(report.created_at),
      status: "open",
    });
  }

  // ─── INFO: open pending category requests ─────────────────────────
  for (const pcr of pendingCategoryRequests) {
    const pcrId = strOrNull(pcr.id);
    if (!pcrId) continue;
    alerts.push({
      id: `pending_category:${pcrId}`,
      severity: "info",
      type: "pending_category_request",
      title: "Category awaiting admin review",
      message: `"${strOrNull(pcr.requested_category) ?? "—"}" requested for ${strOrNull(pcr.area) ?? "—"}.`,
      source: "pending_category_requests",
      relatedId: pcrId,
      created_at: strOrNull(pcr.created_at),
      status: "open",
    });
  }

  // Sort: severity asc (critical→warning→info), then created_at desc
  // within each band (newest first; rows without timestamps land last).
  alerts.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity];
    const sb = SEVERITY_ORDER[b.severity];
    if (sa !== sb) return sa - sb;
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca !== cb) return ca < cb ? 1 : -1;
    return 0;
  });

  const limitedAlerts = alerts.slice(0, ALERT_LIMIT);

  const summary = {
    critical: limitedAlerts.filter((a) => a.severity === "critical").length,
    warning: limitedAlerts.filter((a) => a.severity === "warning").length,
    info: limitedAlerts.filter((a) => a.severity === "info").length,
    total: limitedAlerts.length,
  };

  return NextResponse.json({
    success: true,
    summary,
    alerts: limitedAlerts,
  });
}
