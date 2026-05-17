import { adminSupabase } from "@/lib/supabase/admin";
import { scrubLongTokens } from "./scrub";

// Keep in sync with the push_logs.event_type CHECK constraint. Phase 4B
// added "new_service_request" via 20260516200000_push_logs_event_types.sql.
// Phase 2 (notification preferences) added "job_match" — written when a
// matched-service push is skipped because the provider opted out via the
// "job_match" preference toggle. The migration that widened the CHECK is
// 20260518120000_notification_preferences.sql.
export type PushLogEventType =
  | "new_service_request"
  | "job_match"
  | "job_matched"
  | "chat_message"
  | "test";

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
      // Defense-in-depth: scrub any token-shaped run before persisting.
      // FCM occasionally embeds the offending token in error_message, and
      // this table is read by the admin dashboard — a leak here would
      // surface a credential in the UI.
      error_message: scrubLongTokens(input.errorMessage ?? null),
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
