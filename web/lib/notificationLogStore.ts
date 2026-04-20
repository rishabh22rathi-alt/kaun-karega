import { adminSupabase } from "./supabase/admin";

export type NotificationLogInput = {
  logId?: string;
  taskId: string;
  displayId?: string;
  providerId: string;
  providerPhone?: string;
  category?: string;
  area?: string;
  serviceTime?: string;
  templateName?: string;
  status: string;
  statusCode?: number | null;
  messageId?: string;
  errorMessage?: string;
  rawResponse?: string;
};

function buildLogId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `LOG-${timestamp}-${random}`;
}

export async function appendNotificationLog(
  input: NotificationLogInput
): Promise<{ ok: true; logId: string } | { ok: false; error: string }> {
  try {
    // This store backs the admin task-notification dashboard, so callers must only
    // write truthful task-linked delivery attempts/results.
    const logId = String(input.logId || "").trim() || buildLogId();

    const { error } = await adminSupabase.from("notification_logs").insert({
      log_id: logId,
      task_id: String(input.taskId || "").trim(),
      display_id: String(input.displayId || "").trim() || null,
      provider_id: String(input.providerId || "").trim(),
      provider_phone: String(input.providerPhone || "").trim(),
      category: String(input.category || "").trim() || null,
      area: String(input.area || "").trim() || null,
      service_time: String(input.serviceTime || "").trim() || null,
      template_name: String(input.templateName || "").trim() || null,
      status: String(input.status || "").trim(),
      status_code:
        typeof input.statusCode === "number" && Number.isFinite(input.statusCode)
          ? input.statusCode
          : null,
      message_id: String(input.messageId || "").trim(),
      error_message: String(input.errorMessage || "").trim(),
      raw_response: String(input.rawResponse || "").trim() || null,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, logId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to append notification log",
    };
  }
}
