import { adminSupabase } from "@/lib/supabase/admin";
import {
  buildAdminNotification,
  runAdminNotifyWithPush,
  type AdminNotificationInput,
  type NotifyAdminsResult,
} from "@/lib/notifications/adminNotifyCore";
import { sendAdminAlertPush } from "@/lib/push/sendAdminAlert";

/**
 * Phase A — unified soft-fail admin notifier.
 *
 *   notifyAdmins(eventType, payload)
 *
 * Inserts one row into admin_notifications (the in-app Admin Notification
 * Centre that powers the bell + /admin/alerts), with CHECK-FIRST dedupe on
 * (type, related_id) so a Razorpay webhook retry never creates a second
 * alert. It NEVER throws and NEVER rejects: every failure (build, lookup,
 * insert, exception) resolves to a typed result and a console.warn. Safe
 * to `await` inside payment / provider-registration / task / report flows
 * — a notification problem can never break the host transaction.
 *
 * The table has no metadata/payload column, so `payload` is used only to
 * build title/message/related_id; nothing extra is persisted.
 *
 * Returns { ok:true, inserted, deduped } or { ok:false, error }.
 */
export async function notifyAdmins(
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<NotifyAdminsResult> {
  try {
    const input = buildAdminNotification(eventType, payload);
    if (!input) {
      console.warn("[notifyAdmins] unknown event type (ignored)", { eventType });
      return { ok: false, error: "UNKNOWN_EVENT" };
    }

    return await runAdminNotifyWithPush(
      input,
      {
        findExisting: async (type, relatedId) => {
          const { count, error } = await adminSupabase
            .from("admin_notifications")
            .select("id", { count: "exact", head: true })
            .eq("type", type)
            .eq("related_id", relatedId);
          if (error) return { exists: false, error: error.message };
          return { exists: (count ?? 0) > 0 };
        },
        insert: async (n: AdminNotificationInput) => {
          const { error } = await adminSupabase
            .from("admin_notifications")
            .insert({
              type: n.type,
              title: n.title,
              message: n.message,
              severity: n.severity,
              source: n.source,
              related_id: n.relatedId,
              action_url: n.actionUrl,
            });
          return {
            errorCode: (error as { code?: string } | null)?.code ?? null,
            errorMessage: error?.message ?? null,
          };
        },
      },
      // Best-effort PWA push to admin WEB devices for the opted-in events.
      // Fired ONLY on a fresh insert (never a deduped webhook retry) and
      // fully soft-fail — it can never break the host flow or change the
      // returned notification-centre result.
      (dispatch) => sendAdminAlertPush(dispatch)
    );
  } catch (err) {
    // Absolute backstop — notifyAdmins must never throw into a caller.
    console.warn("[notifyAdmins] outer guard caught (non-fatal)", {
      eventType,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
