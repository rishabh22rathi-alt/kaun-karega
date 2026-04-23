import { adminSupabase } from "../supabase/admin";

type IssueReportRow = {
  issue_id: string;
  created_at: string;
  reporter_role: string;
  reporter_phone: string;
  reporter_name: string | null;
  issue_type: string;
  issue_page: string;
  description: string;
  status: string;
  priority: string;
  admin_notes: string | null;
  resolved_at: string | null;
};

export type IssueReportPayload = {
  IssueID: string;
  CreatedAt: string;
  ReporterRole: string;
  ReporterPhone: string;
  ReporterName: string;
  IssueType: string;
  IssuePage: string;
  Description: string;
  Status: string;
  Priority: string;
  AdminNotes: string;
  ResolvedAt: string;
};

export type SubmitIssueReportPayload =
  | { ok: true; status: "success"; issueId: string; message: string }
  | { ok: false; status: "error"; error: string };

export type GetIssueReportsPayload =
  | { ok: true; status: "success"; reports: IssueReportPayload[] }
  | { ok: false; status: "error"; error: string };

export type UpdateIssueReportStatusPayload =
  | { ok: true; status: "success"; issueId: string; nextStatus: string }
  | { ok: false; status: "error"; error: string };

function buildIssueId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `IR-${timestamp}-${random}`;
}

function formatIssueTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function mapIssueReportRow(row: IssueReportRow): IssueReportPayload {
  return {
    IssueID: row.issue_id,
    CreatedAt: formatIssueTimestamp(row.created_at),
    ReporterRole: row.reporter_role || "user",
    ReporterPhone: row.reporter_phone || "",
    ReporterName: row.reporter_name || "",
    IssueType: row.issue_type || "",
    IssuePage: row.issue_page || "",
    Description: row.description || "",
    Status: row.status || "open",
    Priority: row.priority || "normal",
    AdminNotes: row.admin_notes || "",
    ResolvedAt: formatIssueTimestamp(row.resolved_at),
  };
}

export async function submitIssueReportToSupabase(params: {
  reporterPhone: string;
  reporterRole: string;
  reporterName: string;
  issueType: string;
  issuePage: string;
  description: string;
}): Promise<SubmitIssueReportPayload> {
  try {
    const issueId = buildIssueId();
    const nowIso = new Date().toISOString();

    const { error } = await adminSupabase.from("issue_reports").insert({
      issue_id: issueId,
      created_at: nowIso,
      reporter_role: params.reporterRole,
      reporter_phone: params.reporterPhone,
      reporter_name: params.reporterName || null,
      issue_type: params.issueType,
      issue_page: params.issuePage,
      description: params.description,
      status: "open",
      priority: "normal",
      admin_notes: null,
      resolved_at: null,
    });

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    return { ok: true, status: "success", issueId, message: "Issue reported successfully" };
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
      .select("*")
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
    const issueId =
      typeof data.IssueID === "string"
        ? data.IssueID.trim()
        : typeof data.issueId === "string"
          ? data.issueId.trim()
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
    if (!["open", "in_progress", "resolved"].includes(nextStatus)) {
      return { ok: false, status: "error", error: "Invalid status" };
    }

    const { data: existing, error: fetchError } = await adminSupabase
      .from("issue_reports")
      .select("issue_id")
      .eq("issue_id", issueId)
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
      resolved_at: nextStatus === "resolved" ? nowIso : null,
    };

    const { error: updateError } = await adminSupabase
      .from("issue_reports")
      .update(updatePayload)
      .eq("issue_id", issueId);

    if (updateError) {
      return { ok: false, status: "error", error: updateError.message };
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
