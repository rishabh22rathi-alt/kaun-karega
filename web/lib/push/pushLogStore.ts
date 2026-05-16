import { adminSupabase } from "@/lib/supabase/admin";

export type PushLogEventType = "job_matched" | "chat_message" | "test";

export type PushLogStatus = "sent" | "failed" | "invalid_token" | "skipped";

export type PushLogInput = {
  eventType: PushLogEventType;
  taskId?: string | null;
  threadId?: string | null;
  recipientPhone?: string | null;
  recipientProviderId?: string | null;
  fcmTokenTail?: string | null;
  status: PushLogStatus;
  fcmMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  payloadJson?: Record<string, unknown> | null;
};

// Tail-8 chars only — the full FCM token is a credential and must never
// land in logs, dashboards, or error traces. Callers should ALWAYS go
// through this helper instead of slicing inline.
export function tokenTail(token: string): string {
  const t = String(token ?? "");
  if (t.length === 0) return "";
  return t.length <= 8 ? t : t.slice(-8);
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function appendPushLog(
  input: PushLogInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await adminSupabase.from("push_logs").insert({
      event_type: input.eventType,
      task_id: trimOrNull(input.taskId ?? null),
      thread_id: trimOrNull(input.threadId ?? null),
      recipient_phone: trimOrNull(input.recipientPhone ?? null),
      recipient_provider_id: trimOrNull(input.recipientProviderId ?? null),
      fcm_token_tail: trimOrNull(input.fcmTokenTail ?? null),
      status: input.status,
      fcm_message_id: trimOrNull(input.fcmMessageId ?? null),
      error_code: trimOrNull(input.errorCode ?? null),
      error_message: trimOrNull(input.errorMessage ?? null),
      payload_json: input.payloadJson ?? null,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to append push log",
    };
  }
}
