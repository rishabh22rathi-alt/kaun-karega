import { NextResponse } from "next/server";

import { checkAdminByPhone } from "@/lib/adminAuth";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/firebaseAdmin";
import { sendPushToTokens } from "@/lib/push/sendFcm";
import { normalizeTargetPhone } from "@/lib/push/recipients";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "@/lib/push/invalidateTokens";
import { adminTestPayload } from "@/lib/push/payloads";
import { appendPushLog, tokenTail } from "@/lib/push/pushLogStore";

/**
 * Phase B Step 6 — admin web test push.
 *
 *   POST /api/admin/push/test — admin session only (NO x-kk-test-secret).
 *
 * Sends a generic admin test notification to the CURRENT admin's own
 * registered WEB devices (actor_type='admin' AND platform='web'). This is
 * a PWA/web flow — no native-app device assumptions. Reuses the existing
 * FCM send path + push_logs + invalid-token cleanup. Fully soft-fail:
 * never crashes; returns safe counts. Does NOT wire any business event to
 * push, does NOT require NATIVE_PUSH_ENABLED.
 *
 * Returns: { ok, sent, failed, inactive, totalTokens, message }.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  // 1. Admin session (no secret). Resolve the admin's own phone.
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
    validateVersion: true,
  });
  if (!session?.phone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }
  const adminCheck = await checkAdminByPhone(session.phone);
  if (!adminCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Admin only." },
      { status: 403 }
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

  // 3. Resolve THIS admin's active WEB tokens (admin + web only). Direct
  //    query (service-role) so we can filter by platform — the shared
  //    recipients helper doesn't expose platform.
  const phone = normalizeTargetPhone(session.phone);
  let rows: Array<{ fcm_token: string }> = [];
  try {
    const { data, error } = await adminSupabase
      .from("native_push_devices")
      .select("fcm_token")
      .eq("phone", phone)
      .eq("actor_type", "admin")
      .eq("platform", "web")
      .eq("active", true);
    if (error) {
      console.error("[admin/push/test] device lookup failed", {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "DEVICE_LOOKUP_FAILED",
          sent: 0,
          failed: 0,
          inactive: 0,
          totalTokens: 0,
          message: "Could not load your push devices.",
        },
        { status: 500 }
      );
    }
    rows = (data ?? []) as Array<{ fcm_token: string }>;
  } catch (err) {
    console.error("[admin/push/test] device lookup threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "DEVICE_LOOKUP_FAILED",
        sent: 0,
        failed: 0,
        inactive: 0,
        totalTokens: 0,
        message: "Could not load your push devices.",
      },
      { status: 500 }
    );
  }

  const tokens = rows
    .map((r) => String(r.fcm_token ?? "").trim())
    .filter((t) => t.length >= 20);

  if (tokens.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      inactive: 0,
      totalTokens: 0,
      message: "No push device registered. Click Enable Push Alerts first.",
    });
  }

  // 4. Send (data-only; sw.js renders it). A throw = SDK/credentials/network
  //    failure → safe JSON, no per-token log (nothing was attempted).
  const payload = adminTestPayload();
  let sendResult;
  try {
    sendResult = await sendPushToTokens(tokens, payload);
  } catch (err) {
    console.error("[admin/push/test] send threw", {
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
      console.warn("[admin/push/test] push_logs insert failed", {
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
