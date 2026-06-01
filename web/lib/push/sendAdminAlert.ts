import { getActiveAdminWebTokens } from "./recipients";
import { sendPushToTokens } from "./sendFcm";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "./invalidateTokens";
import { appendPushLog, tokenTail } from "./pushLogStore";
import { adminAlertPayload } from "./payloads";

/**
 * Phase B Step 7 — admin business-alert push (admin WEB devices only).
 *
 * Best-effort fan-out of a high-priority admin event to every active admin
 * web token. Reuses the existing FCM rails verbatim — same send transport,
 * same push_logs writer, same invalid-token deactivation helper. NEVER
 * throws: every Supabase / FCM failure is logged and swallowed, so a push
 * problem can never break the host payment / webhook / invoice / PDF flow.
 *
 * Dedupe is the CALLER's responsibility — notifyAdmins only invokes this on
 * a freshly-inserted notification, so a webhook retry (deduped insert) never
 * reaches here and never double-pushes.
 *
 * Title/body are already PII-free (see adminAlertPayload); deepLink mirrors
 * the admin_notifications.action_url passed in by the caller.
 */
export type AdminAlertInput = {
  /** The business event type (provider_paid_plan_subscribed, etc.). */
  eventType: string;
  title: string;
  body: string;
  /** Same as the admin_notifications.action_url for this event. */
  deepLink: string;
  /** The notification's related_id (internal id only — never PII). */
  relatedId: string | null;
};

export async function sendAdminAlertPush(input: AdminAlertInput): Promise<void> {
  try {
    const devices = await getActiveAdminWebTokens();
    if (devices.length === 0) {
      // Req 10: no admin web token → do nothing safely (no log noise).
      return;
    }

    const tokens = devices.map((d) => d.fcmToken);
    const tokenToPhone = new Map(devices.map((d) => [d.fcmToken, d.phone]));
    const payload = adminAlertPayload({
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
      relatedId: input.relatedId,
    });
    // PII-free audit blob for push_logs (no provider name / phone / amount).
    const logPayload: Record<string, unknown> = {
      businessEvent: input.eventType,
      deepLink: payload.deepLink,
      relatedId: input.relatedId ?? "",
    };

    let batch: Awaited<ReturnType<typeof sendPushToTokens>>;
    try {
      batch = await sendPushToTokens(tokens, payload);
    } catch (err) {
      // Missing Firebase Admin config / SDK / network throw → record one
      // failed row per token so the audit trail stays consistent, then
      // swallow. Host flow is unaffected.
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[push/sendAdminAlert] sendPushToTokens threw (non-fatal)", {
        eventType: input.eventType,
        message,
      });
      for (const device of devices) {
        await appendPushLog({
          eventType: "admin_alert",
          recipientPhone: device.phone,
          fcmTokenTail: tokenTail(device.fcmToken),
          status: "failed",
          errorCode: "FCM_THREW",
          errorMessage: message,
          payloadJson: logPayload,
        });
      }
      return;
    }

    const invalidTokens: string[] = [];
    for (const r of batch.results) {
      const status: "sent" | "invalid_token" | "failed" = r.ok
        ? "sent"
        : isInvalidTokenError(r.errorCode)
          ? "invalid_token"
          : "failed";
      if (status === "invalid_token") invalidTokens.push(r.token);
      await appendPushLog({
        eventType: "admin_alert",
        recipientPhone: tokenToPhone.get(r.token) ?? null,
        fcmTokenTail: tokenTail(r.token),
        status,
        fcmMessageId: r.messageId || null,
        errorCode: r.errorCode || null,
        errorMessage: r.errorMessage || null,
        payloadJson: logPayload,
      });
    }

    if (invalidTokens.length > 0) {
      await deactivateInvalidTokens(invalidTokens);
    }
  } catch (err) {
    // Absolute backstop — this function must never throw into notifyAdmins.
    console.warn("[push/sendAdminAlert] outer guard caught (non-fatal)", {
      eventType: input.eventType,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
