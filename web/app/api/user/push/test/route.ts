import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { isPushConfigured } from "@/lib/push/firebaseAdmin";
import { sendPushToTokens } from "@/lib/push/sendFcm";
import {
  getActiveUserTokensForPhone,
  normalizeTargetPhone,
} from "@/lib/push/recipients";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "@/lib/push/invalidateTokens";
import { testPayload } from "@/lib/push/payloads";
import { appendPushLog, tokenTail } from "@/lib/push/pushLogStore";

/**
 * User Push Phase 1 — user web test push.
 *
 *   POST /api/user/push/test — any valid logged-in session.
 *
 * Sends a generic test notification to the CURRENT user's own active
 * USER-actor devices (resolved from the verified session phone, filtered to
 * actor_type='user' so a phone that's also a provider/admin never gets the
 * test on the wrong tokens). Reuses the existing FCM send path + push_logs +
 * invalid-token cleanup. Fully soft-fail; never crashes; returns safe counts.
 * Does NOT require NATIVE_PUSH_ENABLED.
 *
 * Returns: { ok, sent, failed, inactive, totalTokens, message }.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  // 1. Any logged-in session is a "user" for push purposes.
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
    validateVersion: true,
  });
  if (!session?.phone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Session required." },
      { status: 401 }
    );
  }

  // 2. Push must be configured server-side.
  if (!isPushConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "PUSH_NOT_CONFIGURED",
        message: "Push is not configured on this deployment.",
      },
      { status: 503 }
    );
  }

  // 3. Resolve THIS user's active USER-actor tokens. The helper filters
  //    actor_type='user', so provider/admin tokens on the same phone are
  //    never targeted. Soft-fails to [] on DB error.
  const phone = normalizeTargetPhone(session.phone);
  const devices = await getActiveUserTokensForPhone(phone);
  const tokens = devices
    .map((d) => String(d.fcmToken ?? "").trim())
    .filter((t) => t.length >= 20);

  if (tokens.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      inactive: 0,
      totalTokens: 0,
      message: "No push device registered. Tap Enable Push Notifications first.",
    });
  }

  // 4. Send (data-only; sw.js renders it). A throw = SDK/credentials/network
  //    failure → safe JSON, no per-token log (nothing was attempted).
  const payload = testPayload();
  let sendResult;
  try {
    sendResult = await sendPushToTokens(tokens, payload);
  } catch (err) {
    console.error("[user/push/test] send threw", {
      message: err instanceof Error ? err.message : String(err),
      totalTokens: tokens.length,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "PUSH_SEND_FAILED",
        sent: 0,
        failed: tokens.length,
        inactive: 0,
        totalTokens: tokens.length,
        message: "Push send failed.",
      },
      { status: 500 }
    );
  }

  // 5. Per-token log + invalid-token cleanup. Soft-fail throughout.
  const invalidTokens: string[] = [];
  for (const r of sendResult.results) {
    const status: "sent" | "invalid_token" | "failed" = r.ok
      ? "sent"
      : isInvalidTokenError(r.errorCode)
        ? "invalid_token"
        : "failed";
    if (status === "invalid_token") invalidTokens.push(r.token);
    const logResult = await appendPushLog({
      eventType: "test",
      recipientPhone: phone,
      recipientProviderId: null,
      fcmTokenTail: tokenTail(r.token),
      status,
      fcmMessageId: r.messageId || null,
      errorCode: r.errorCode || null,
      errorMessage: r.errorMessage || null,
      payloadJson: { eventType: payload.eventType, deepLink: payload.deepLink },
    });
    if (!logResult.ok) {
      console.warn("[user/push/test] push_logs insert failed", {
        tokenTail: tokenTail(r.token),
        error: logResult.error,
      });
    }
  }

  let inactive = 0;
  if (invalidTokens.length > 0) {
    const deact = await deactivateInvalidTokens(invalidTokens);
    inactive = deact.deactivated;
  }

  return NextResponse.json({
    ok: true,
    sent: sendResult.successCount,
    failed: sendResult.failureCount,
    inactive,
    totalTokens: tokens.length,
    message:
      sendResult.successCount > 0
        ? "Test push sent."
        : "No push delivered (the token may be invalid or expired).",
  });
}
