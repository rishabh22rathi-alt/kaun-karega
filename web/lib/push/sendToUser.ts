import { getActiveUserTokensForPhone, normalizeTargetPhone } from "./recipients";
import { sendPushToTokens } from "./sendFcm";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "./invalidateTokens";
import { appendPushLog, tokenTail } from "./pushLogStore";
import type { PushDataPayload } from "./payloads";

/**
 * User Push Phase 1: per-user push wrapper around the existing FCM rails.
 *
 * Mirrors sendToProvider's wrapper but targets USER-actor tokens for a phone
 * (getActiveUserTokensForPhone filters actor_type='user', so a phone that is
 * also a provider/admin never gets a user push on the wrong tokens).
 *
 * Best-effort, never throws — every Supabase / FCM error is logged and
 * surfaced via the returned status, so callers (e.g. /api/tasks/respond) can
 * ignore the result and never let push failure affect their own flow.
 *   - No active tokens? Log 'skipped'/NO_ACTIVE_TOKENS, return 'no_tokens'.
 *   - FCM throws? Log one 'failed' row per token, return 'failed'.
 *   - Otherwise roll up sent / invalid_token / failed and soft-deactivate
 *     permanently-bad tokens.
 *
 * eventType for push_logs is taken from the payload so the log row matches
 * the notification that was sent (e.g. 'task_update').
 */

export type UserSendStatus =
  | "sent"
  | "failed"
  | "invalid_token"
  | "skipped"
  | "no_tokens";

export type UserSendResult = {
  status: UserSendStatus;
  tokensTried: number;
};

export async function sendUserPush(
  phone: string,
  payload: PushDataPayload
): Promise<UserSendResult> {
  const canonicalPhone = normalizeTargetPhone(phone);
  if (!canonicalPhone) {
    return { status: "skipped", tokensTried: 0 };
  }

  const eventType = payload.eventType;

  const devices = await getActiveUserTokensForPhone(canonicalPhone);
  if (devices.length === 0) {
    await appendPushLog({
      eventType,
      recipientPhone: canonicalPhone,
      status: "skipped",
      errorCode: "NO_ACTIVE_TOKENS",
      payloadJson: payload as unknown as Record<string, unknown>,
    });
    return { status: "no_tokens", tokensTried: 0 };
  }

  const tokens = devices.map((d) => d.fcmToken);

  let batch: Awaited<ReturnType<typeof sendPushToTokens>>;
  try {
    batch = await sendPushToTokens(tokens, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[push/sendUserPush] sendPushToTokens threw", {
      phone: canonicalPhone,
      message,
    });
    for (const token of tokens) {
      await appendPushLog({
        eventType,
        recipientPhone: canonicalPhone,
        fcmTokenTail: tokenTail(token),
        status: "failed",
        errorCode: "FCM_THREW",
        errorMessage: message,
        payloadJson: payload as unknown as Record<string, unknown>,
      });
    }
    return { status: "failed", tokensTried: tokens.length };
  }

  const invalidTokens: string[] = [];
  let succeeded = 0;
  let failedNonInvalid = 0;
  let failedInvalid = 0;

  for (const result of batch.results) {
    if (result.ok) {
      succeeded += 1;
      await appendPushLog({
        eventType,
        recipientPhone: canonicalPhone,
        fcmTokenTail: tokenTail(result.token),
        status: "sent",
        fcmMessageId: result.messageId || null,
        payloadJson: payload as unknown as Record<string, unknown>,
      });
      continue;
    }
    if (isInvalidTokenError(result.errorCode)) {
      failedInvalid += 1;
      invalidTokens.push(result.token);
      await appendPushLog({
        eventType,
        recipientPhone: canonicalPhone,
        fcmTokenTail: tokenTail(result.token),
        status: "invalid_token",
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        payloadJson: payload as unknown as Record<string, unknown>,
      });
      continue;
    }
    failedNonInvalid += 1;
    await appendPushLog({
      eventType,
      recipientPhone: canonicalPhone,
      fcmTokenTail: tokenTail(result.token),
      status: "failed",
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      payloadJson: payload as unknown as Record<string, unknown>,
    });
  }

  if (invalidTokens.length > 0) {
    const { error } = await deactivateInvalidTokens(invalidTokens);
    if (error) {
      console.warn("[push/sendUserPush] token deactivation reported error", {
        phone: canonicalPhone,
        error,
      });
    }
  }

  let status: UserSendStatus;
  if (succeeded > 0) {
    status = "sent";
  } else if (failedInvalid > 0 && failedNonInvalid === 0) {
    status = "invalid_token";
  } else {
    status = "failed";
  }

  return { status, tokensTried: tokens.length };
}
