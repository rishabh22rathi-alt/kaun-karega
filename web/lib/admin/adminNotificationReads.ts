import { adminSupabase } from "../supabase/admin";

type NotificationLogRow = {
  log_id: string;
  created_at: string;
  task_id: string;
  display_id: string | null;
  provider_id: string;
  provider_phone: string | null;
  category: string | null;
  area: string | null;
  service_time: string | null;
  template_name: string | null;
  status: string;
  status_code: number | null;
  message_id: string | null;
  error_message: string | null;
  raw_response: string | null;
};

type TaskDisplayRow = {
  display_id: string | number | null;
};

export type AdminNotificationLogsPayload =
  | {
      ok: true;
      status: "success";
      logs: Array<{
        LogID: string;
        CreatedAt: string;
        TaskID: string;
        DisplayID: string;
        ProviderID: string;
        ProviderPhone: string;
        Category: string;
        Area: string;
        ServiceTime: string;
        TemplateName: string;
        Status: string;
        StatusCode: number | string;
        MessageId: string;
        ErrorMessage: string;
        RawResponse: string;
      }>;
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export type AdminNotificationSummaryPayload =
  | {
      ok: true;
      status: "success";
      summary: {
        taskId: string;
        DisplayID: string;
        total: number;
        accepted: number;
        failed: number;
        error: number;
        latestCreatedAt: string;
      };
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export async function getAdminNotificationLogsFromSupabase(
  limit: number
): Promise<AdminNotificationLogsPayload> {
  try {
    const normalizedLimit = Math.max(1, Math.min(Number(limit || 20) || 20, 100));
    const { data, error } = await adminSupabase
      .from("notification_logs")
      .select(
        "log_id, created_at, task_id, display_id, provider_id, provider_phone, category, area, service_time, template_name, status, status_code, message_id, error_message, raw_response"
      )
      .order("created_at", { ascending: false })
      .limit(normalizedLimit);

    if (error) {
      return { ok: false, status: "error", error: error.message };
    }

    const logs = ((data ?? []) as NotificationLogRow[]).map((row) => ({
      LogID: String(row.log_id || "").trim(),
      CreatedAt: String(row.created_at || "").trim(),
      TaskID: String(row.task_id || "").trim(),
      DisplayID: String(row.display_id || "").trim(),
      ProviderID: String(row.provider_id || "").trim(),
      ProviderPhone: String(row.provider_phone || "").trim(),
      Category: String(row.category || "").trim(),
      Area: String(row.area || "").trim(),
      ServiceTime: String(row.service_time || "").trim(),
      TemplateName: String(row.template_name || "").trim(),
      Status: String(row.status || "").trim(),
      StatusCode:
        typeof row.status_code === "number" && Number.isFinite(row.status_code)
          ? row.status_code
          : "",
      MessageId: String(row.message_id || "").trim(),
      ErrorMessage: String(row.error_message || "").trim(),
      RawResponse: String(row.raw_response || "").trim(),
    }));

    return {
      ok: true,
      status: "success",
      logs,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load notification logs",
    };
  }
}

export async function getAdminNotificationSummaryFromSupabase(
  taskId: string
): Promise<AdminNotificationSummaryPayload> {
  try {
    const normalizedTaskId = String(taskId || "").trim();

    const [{ data: logRows, error: logsError }, { data: taskRow, error: taskError }] =
      await Promise.all([
        normalizedTaskId
          ? adminSupabase
              .from("notification_logs")
              .select("display_id, status, created_at")
              .eq("task_id", normalizedTaskId)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        normalizedTaskId
          ? adminSupabase
              .from("tasks")
              .select("display_id")
              .eq("task_id", normalizedTaskId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

    if (logsError) {
      return { ok: false, status: "error", error: logsError.message };
    }
    if (taskError) {
      return { ok: false, status: "error", error: taskError.message };
    }

    const rows = (logRows ?? []) as Array<{
      display_id: string | null;
      status: string;
      created_at: string;
    }>;
    const displayIdFromTask =
      taskRow && typeof (taskRow as TaskDisplayRow).display_id !== "undefined"
        ? String((taskRow as TaskDisplayRow).display_id || "").trim()
        : "";
    const displayIdFromLog = rows.length > 0 ? String(rows[0]?.display_id || "").trim() : "";

    const summary = {
      taskId: normalizedTaskId,
      DisplayID: displayIdFromTask || displayIdFromLog,
      total: 0,
      accepted: 0,
      failed: 0,
      error: 0,
      latestCreatedAt: rows.length > 0 ? String(rows[0]?.created_at || "").trim() : "",
    };

    for (const row of rows) {
      const status = String(row.status || "").trim().toLowerCase();
      summary.total += 1;
      if (status === "accepted") summary.accepted += 1;
      if (status === "failed") summary.failed += 1;
      if (status === "error") summary.error += 1;
    }

    return {
      ok: true,
      status: "success",
      summary,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Failed to load notification summary",
    };
  }
}
