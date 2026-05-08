import { adminSupabase } from "../supabase/admin";

/**
 * Issue Reports persistence helper.
 *
 * Canonical schema (live as of 2026-05-09 — user applied):
 *   id              UUID PRIMARY KEY (auto-generated)
 *   created_at      TIMESTAMPTZ      (auto-generated)
 *   updated_at      TIMESTAMPTZ      NOT NULL
 *   reporter_phone  TEXT             NOT NULL
 *   reporter_type   TEXT             NOT NULL  -- user|provider|admin|guest
 *   reporter_name   TEXT             nullable
 *   issue_type      TEXT             NOT NULL
 *   message         TEXT             NOT NULL  -- main body
 *   status          TEXT             NOT NULL DEFAULT 'open'
 *   admin_notes     TEXT             nullable  -- admin status-update only
 *
 * The helper writes ONLY the columns above. No `issue_id`, no
 * `description`, no `issue_page`, no `priority`, no `resolved_at`,
 * no `title`. The previous wave of "Could not find the 'X' column"
 * errors all came from the helper referencing columns the live table
 * did not have.
 */

type IssueReportRow = {
  id: string;
  // BIGINT IDENTITY — the public reference shown to users as
  // "Issue No. 1", "Issue No. 2", etc. Added by the
  // docs/migrations/issue-reports-issue-no.sql migration. Auto-
  // generated on insert; the helper never sends it.
  issue_no: number | string | null;
  created_at: string | null;
  updated_at: string | null;
  reporter_phone: string | null;
  reporter_type: string | null;
  reporter_name: string | null;
  issue_type: string | null;
  message: string | null;
  status: string | null;
  admin_notes: string | null;
};

export type IssueReportPayload = {
  // Kept named "IssueID" so existing admin dashboard binders don't
  // break. Sourced from the row's UUID `id`.
  IssueID: string;
  // Public sequential reference. 0 when the migration hasn't been
  // applied yet (column missing → null → coerced to 0); UI surfaces
  // should treat 0 as "no public reference yet" and fall back to
  // the UUID.
  IssueNo: number;
  CreatedAt: string;
  UpdatedAt: string;
  // Kept named "ReporterRole" for the same reason; sourced from
  // `reporter_type`.
  ReporterRole: string;
  ReporterPhone: string;
  ReporterName: string;
  IssueType: string;
  // Kept named "Description" so dashboard rendering doesn't change;
  // sourced from `message`.
  Description: string;
  Status: string;
  AdminNotes: string;
};

export type SubmitIssueReportPayload =
  | {
      ok: true;
      status: "success";
      issueId: string;
      issueNo: number;
      message: string;
    }
  | { ok: false; status: "error"; error: string };

export type GetIssueReportsPayload =
  | { ok: true; status: "success"; reports: IssueReportPayload[] }
  | { ok: false; status: "error"; error: string };

export type UpdateIssueReportStatusPayload =
  | { ok: true; status: "success"; issueId: string; nextStatus: string }
  | { ok: false; status: "error"; error: string };

function formatIssueTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/**
 * On resolved-status update, fire an in-app notification to the
 * reporter when possible.
 *
 * Provider reporters → `provider_notifications` row (same surface
 * the bell uses for chat/job notifications).
 *
 * User reporters → no in-app surface exists yet. There is no
 * `user_notifications` table, no per-user bell, and no SMS/email
 * pipeline that user-side notifications can hook into. We log the
 * skip with a clear marker so it's grep-able when the user-side
 * notification surface is added later.
 *
 * WhatsApp templates are NOT used here — there is no approved
 * "issue_resolved" template provisioned with the WA provider. When
 * one is approved, route through `lib/whatsappTemplates` similarly
 * to the chat reply notifications.
 */
async function dispatchResolutionNotification(params: {
  reporterPhone: string;
  reporterType: string;
  issueNo: number;
  issueType: string;
}): Promise<void> {
  const phone10 = String(params.reporterPhone || "")
    .replace(/\D/g, "")
    .slice(-10);
  if (phone10.length !== 10) return;

  const reporterType = (params.reporterType || "").toLowerCase();
  const reference =
    params.issueNo > 0 ? `Issue No. ${params.issueNo}` : "Your issue";

  if (reporterType !== "provider") {
    console.info(
      "[adminIssueReports] resolution notification skipped — no user-side notification surface yet",
      {
        reference,
        reporterType,
        marker: "MISSING:user_notifications",
      }
    );
    return;
  }

  // Provider path. Look up the provider_id by phone (same pattern
  // used elsewhere — supports both 10-digit and 91XXXXXXXXXX storage).
  const { data: providerRows, error: providerLookupErr } = await adminSupabase
    .from("providers")
    .select("provider_id, phone")
    .or(`phone.eq.${phone10},phone.eq.91${phone10}`)
    .limit(5);
  if (providerLookupErr) {
    console.warn(
      "[adminIssueReports] provider lookup failed; skipping notification",
      providerLookupErr.message
    );
    return;
  }
  const providerRow = (providerRows || []).find(
    (row) => String(row.phone || "").replace(/\D/g, "").slice(-10) === phone10
  );
  const providerId = String(providerRow?.provider_id || "").trim();
  if (!providerId) {
    console.info(
      "[adminIssueReports] reporter is marked provider but no providers row resolved — skipping notification",
      { reference, phone10 }
    );
    return;
  }

  const issueLabel =
    params.issueType && params.issueType.trim()
      ? `: "${params.issueType.trim()}"`
      : "";
  const { error: insertErr } = await adminSupabase
    .from("provider_notifications")
    .insert({
      provider_id: providerId,
      type: "issue_resolved",
      title: "Your issue was resolved",
      message: `${reference} marked resolved by admin${issueLabel}.`,
      href: "/provider/dashboard",
      payload_json: {
        issueNo: params.issueNo,
        issueType: params.issueType,
      },
    });
  if (insertErr) {
    console.warn(
      "[adminIssueReports] provider_notifications insert failed",
      insertErr.message
    );
  }
}

function toIssueNo(raw: IssueReportRow["issue_no"]): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapIssueReportRow(row: IssueReportRow): IssueReportPayload {
  return {
    IssueID: String(row.id || ""),
    IssueNo: toIssueNo(row.issue_no),
    CreatedAt: formatIssueTimestamp(row.created_at),
    UpdatedAt: formatIssueTimestamp(row.updated_at),
    ReporterRole: row.reporter_type || "user",
    ReporterPhone: row.reporter_phone || "",
    ReporterName: row.reporter_name || "",
    IssueType: row.issue_type || "",
    Description: row.message || "",
    Status: row.status || "open",
    AdminNotes: row.admin_notes || "",
  };
}

export async function submitIssueReportToSupabase(params: {
  reporterPhone: string;
  reporterRole: string;
  reporterName: string;
  issueType: string;
  message: string;
}): Promise<SubmitIssueReportPayload> {
  try {
    const nowIso = new Date().toISOString();

    // `id` and `created_at` rely on column defaults; we don't send
    // them. `updated_at` is bumped explicitly so it tracks the row's
    // last write time.
    const { data, error } = await adminSupabase
      .from("issue_reports")
      .insert({
        updated_at: nowIso,
        reporter_phone: params.reporterPhone,
        reporter_type: params.reporterRole,
        reporter_name: params.reporterName || null,
        issue_type: params.issueType,
        message: params.message,
        status: "open",
      })
      .select("id, issue_no")
      .single();

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return {
      ok: true,
      status: "success",
      issueId: String(data?.id || ""),
      issueNo: toIssueNo((data as { issue_no?: IssueReportRow["issue_no"] })?.issue_no ?? null),
      message: "Issue reported successfully",
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to submit issue report",
    };
  }
}

export async function getIssueReportsFromSupabase(): Promise<GetIssueReportsPayload> {
  try {
    const { data, error } = await adminSupabase
      .from("issue_reports")
      .select(
        "id, issue_no, created_at, updated_at, reporter_phone, reporter_type, reporter_name, issue_type, message, status, admin_notes"
      )
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return {
      ok: true,
      status: "success",
      reports: ((data ?? []) as IssueReportRow[]).map(mapIssueReportRow),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load issue reports",
    };
  }
}

export async function updateIssueReportStatusFromSupabase(
  data: Record<string, unknown>
): Promise<UpdateIssueReportStatusPayload> {
  try {
    // The PK is now a UUID `id`. Accept either field name from
    // callers; they're interchangeable.
    const issueId =
      typeof data.IssueID === "string"
        ? data.IssueID.trim()
        : typeof data.issueId === "string"
          ? data.issueId.trim()
          : typeof data.id === "string"
            ? data.id.trim()
            : "";
    const nextStatus =
      typeof data.Status === "string"
        ? data.Status.trim().toLowerCase()
        : typeof data.status === "string"
          ? data.status.trim().toLowerCase()
          : "";
    const adminNotes =
      typeof data.AdminNotes === "string"
        ? data.AdminNotes.trim()
        : typeof data.adminNotes === "string"
          ? data.adminNotes.trim()
          : "";

    if (!issueId) {
      return { ok: false, status: "error", error: "IssueID required" };
    }
    if (!["open", "in_progress", "resolved", "rejected"].includes(nextStatus)) {
      return { ok: false, status: "error", error: "Invalid status" };
    }

    const { data: existing, error: fetchError } = await adminSupabase
      .from("issue_reports")
      .select("id, issue_no, reporter_phone, reporter_type, issue_type")
      .eq("id", issueId)
      .maybeSingle();

    if (fetchError) {
      return { ok: false, status: "error", error: fetchError.message };
    }
    if (!existing) {
      return { ok: false, status: "error", error: "Issue report not found" };
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      admin_notes: adminNotes || null,
      updated_at: nowIso,
    };

    const { error: updateError } = await adminSupabase
      .from("issue_reports")
      .update(updatePayload)
      .eq("id", issueId);

    if (updateError) {
      return { ok: false, status: "error", error: updateError.message };
    }

    // Soft-fail resolution notification — fires only when:
    //   - the new status is "resolved"
    //   - the reporter is a registered provider (phone resolves to a
    //     providers row)
    //   - the provider_notifications insert succeeds
    // Failures are logged but never block the admin status update.
    // For non-provider reporters we have no in-app user-notification
    // surface today (no `user_notifications` table) — we silently
    // skip and document the gap below.
    if (nextStatus === "resolved") {
      try {
        await dispatchResolutionNotification({
          reporterPhone: String((existing as { reporter_phone?: unknown }).reporter_phone || ""),
          reporterType: String((existing as { reporter_type?: unknown }).reporter_type || ""),
          issueNo: toIssueNo(
            (existing as { issue_no?: IssueReportRow["issue_no"] }).issue_no ?? null
          ),
          issueType: String((existing as { issue_type?: unknown }).issue_type || ""),
        });
      } catch (notifError) {
        console.warn(
          "[adminIssueReports] resolution notification failed",
          notifError instanceof Error ? notifError.message : notifError
        );
      }
    }

    return { ok: true, status: "success", issueId, nextStatus };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to update issue report status",
    };
  }
}
