import { getActiveTokensForProviderIds } from "./recipients";
import { sendPushToTokens } from "./sendFcm";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "./invalidateTokens";
import { appendPushLog, tokenTail } from "./pushLogStore";
import type { PushDataPayload } from "./payloads";

/**
 * Phase 3.2B: per-provider push wrapper around the existing FCM rails.
 *
 * Used by /api/cron/activate-scheduled-plans after a successful
 * activate_scheduled_plan() RPC call. The activation is the source of
 * truth — push delivery is best-effort:
 *   - No active tokens? Return 'no_tokens'; cron audits and moves on.
 *   - FCM call throws? Return 'failed'; cron audits and moves on.
 *   - One bad token among many? Return 'sent' if any token succeeded,
 *     'invalid_token' if every failure was a permanent-token error,
 *     else 'failed'. Always invalidate permanently-bad tokens via the
 *     existing deactivateInvalidTokens() helper.
 *
 * Never throws. All Supabase / FCM errors are logged but surfaced via
 * the returned status. The cron route writes the status into the
 * scheduled_plan_activations.push_status column.
 *
 * Reuses existing helpers verbatim — no new push log schema, no new
 * FCM transport, no new token invalidation logic.
 */

export type PlanActivatedSendStatus =
  | "sent"
  | "failed"
  | "invalid_token"
  | "skipped"
  | "no_tokens";

export type PlanActivatedSendResult = {
  status: PlanActivatedSendStatus;
  tokensTried: number;
};

// Provider chat-reply send result. Same status vocabulary as the
// plan-activated wrapper so callers/log readers stay uniform.
export type ChatReplySendStatus = PlanActivatedSendStatus;

export type ChatReplySendResult = {
  status: ChatReplySendStatus;
  tokensTried: number;
};

export async function sendPlanActivatedPush(
  providerId: string,
  payload: PushDataPayload
): Promise<PlanActivatedSendResult> {
  const trimmedId = String(providerId ?? "").trim();
  if (!trimmedId) {
    return { status: "skipped", tokensTried: 0 };
  }

  // Resolve active provider-actor tokens for this provider_id.
  // getActiveTokensForProviderIds soft-fails to [] on DB error so we
  // don't need a separate try/catch here.
  const devices = await getActiveTokensForProviderIds([trimmedId]);
  if (devices.length === 0) {
    // Audit so the support read of "did this provider get notified?"
    // returns a deterministic answer rather than nothing.
    await appendPushLog({
      eventType: "plan_activated",
      recipientProviderId: trimmedId,
      status: "skipped",
      errorCode: "NO_ACTIVE_TOKENS",
      payloadJson: payload as unknown as Record<string, unknown>,
    });
    return { status: "no_tokens", tokensTried: 0 };
  }

  const tokens = devices.map((d) => d.fcmToken);

  // sendPushToTokens throws only on missing Firebase Admin config
  // (development without service-account JSON). In prod, it returns a
  // SendBatchResult whose per-token results encode FCM errors.
  let batch: Awaited<ReturnType<typeof sendPushToTokens>>;
  try {
    batch = await sendPushToTokens(tokens, payload);
  } catch (err) {
    // Treat any throw as a complete send failure for this provider.
    // Audit one row per token so the per-device record stays consistent
    // with the success path.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[push/sendPlanActivatedPush] sendPushToTokens threw",
      { providerId: trimmedId, message }
    );
    for (const token of tokens) {
      await appendPushLog({
        eventType: "plan_activated",
        recipientProviderId: trimmedId,
        fcmTokenTail: tokenTail(token),
        status: "failed",
        errorCode: "FCM_THREW",
        errorMessage: message,
        payloadJson: payload as unknown as Record<string, unknown>,
      });
    }
    return { status: "failed", tokensTried: tokens.length };
  }

  // Walk per-token results: log every attempt; collect invalid tokens
  // for soft-deactivation; tally success/failure outcomes.
  const invalidTokens: string[] = [];
  let succeeded = 0;
  let failedNonInvalid = 0;
  let failedInvalid = 0;

  for (const result of batch.results) {
    if (result.ok) {
      succeeded += 1;
      await appendPushLog({
        eventType: "plan_activated",
        recipientProviderId: trimmedId,
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
        eventType: "plan_activated",
        recipientProviderId: trimmedId,
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
      eventType: "plan_activated",
      recipientProviderId: trimmedId,
      fcmTokenTail: tokenTail(result.token),
      status: "failed",
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      payloadJson: payload as unknown as Record<string, unknown>,
    });
  }

  // Soft-deactivate permanently-bad tokens so subsequent sends don't
  // re-try them. deactivateInvalidTokens never throws.
  if (invalidTokens.length > 0) {
    const { error } = await deactivateInvalidTokens(invalidTokens);
    if (error) {
      console.warn(
        "[push/sendPlanActivatedPush] token deactivation reported error",
        { providerId: trimmedId, error }
      );
    }
  }

  // Outcome rollup:
  //   - At least one success → 'sent' (best effort succeeded for some
  //     device; provider sees the push on that device).
  //   - All failures, all invalid-token → 'invalid_token' (caller can
  //     surface "their app is uninstalled" if needed).
  //   - Otherwise mixed/all-non-invalid failures → 'failed'.
  let status: PlanActivatedSendStatus;
  if (succeeded > 0) {
    status = "sent";
  } else if (failedInvalid > 0 && failedNonInvalid === 0) {
    status = "invalid_token";
  } else {
    status = "failed";
  }

  return { status, tokensTried: tokens.length };
}

/**
 * Provider chat-reply push wrapper around the same FCM rails as
 * sendPlanActivatedPush. Called from the chat persistence path when a
 * customer replies, in lockstep with the existing provider_notifications
 * 'chat_message' feed row (so it inherits that block's unseen-per-thread
 * dedupe). Preference + NATIVE_PUSH_ENABLED gating is the CALLER's job — by
 * the time we get here the decision to send has been made.
 *
 * Best-effort, identical semantics to sendPlanActivatedPush:
 *   - No active tokens? Log 'skipped'/NO_ACTIVE_TOKENS, return 'no_tokens'.
 *   - FCM throws? Log one 'failed' row per token, return 'failed'.
 *   - Otherwise roll up sent / invalid_token / failed and soft-deactivate
 *     permanently-bad tokens.
 *
 * Never throws — every Supabase / FCM error is logged and surfaced via the
 * returned status, so the chat flow that calls this can ignore the result.
 */
export async function sendChatReplyPush(
  providerId: string,
  payload: PushDataPayload
): Promise<ChatReplySendResult> {
  const trimmedId = String(providerId ?? "").trim();
  if (!trimmedId) {
    return { status: "skipped", tokensTried: 0 };
  }

  const devices = await getActiveTokensForProviderIds([trimmedId]);
  if (devices.length === 0) {
    await appendPushLog({
      eventType: "chat_message",
      recipientProviderId: trimmedId,
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
    console.error("[push/sendChatReplyPush] sendPushToTokens threw", {
      providerId: trimmedId,
      message,
    });
    for (const token of tokens) {
      await appendPushLog({
        eventType: "chat_message",
        recipientProviderId: trimmedId,
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
        eventType: "chat_message",
        recipientProviderId: trimmedId,
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
        eventType: "chat_message",
        recipientProviderId: trimmedId,
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
      eventType: "chat_message",
      recipientProviderId: trimmedId,
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
      console.warn(
        "[push/sendChatReplyPush] token deactivation reported error",
        { providerId: trimmedId, error }
      );
    }
  }

  let status: ChatReplySendStatus;
  if (succeeded > 0) {
    status = "sent";
  } else if (failedInvalid > 0 && failedNonInvalid === 0) {
    status = "invalid_token";
  } else {
    status = "failed";
  }

  return { status, tokensTried: tokens.length };
}
