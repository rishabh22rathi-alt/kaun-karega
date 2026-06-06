import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/firebaseAdmin";
import { sendPushToTokens } from "@/lib/push/sendFcm";
import {
  getActiveTokensForProviderIds,
  normalizeTargetPhone,
} from "@/lib/push/recipients";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "@/lib/push/invalidateTokens";
import { providerTestPayload } from "@/lib/push/payloads";
import { appendPushLog, tokenTail } from "@/lib/push/pushLogStore";

/**
 * Provider Push Phase 1 — provider web test push.
 *
 *   POST /api/provider/push/test — provider session only.
 *
 * Sends a generic provider test notification to the CURRENT provider's own
 * active devices (actor_type='provider', resolved by provider_id). The
 * provider_id is resolved server-side from the verified session phone — the
 * client cannot target anyone else. Reuses the existing FCM send path +
 * push_logs + invalid-token cleanup. Fully soft-fail: never crashes; returns
 * safe counts. Does NOT wire any business event to push, does NOT require
 * NATIVE_PUSH_ENABLED.
 *
 * Returns: { ok, sent, failed, inactive, totalTokens, message }.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

export async function POST(request: Request) {
  // 1. Provider session. Resolve the provider's own phone.
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
    validateVersion: true,
  });
  if (!session?.phone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Provider session required." },
      { status: 401 }
    );
  }

  // 2. Resolve provider_id server-side from the verified phone. Mirrors the
  //    provider lookup in /api/native-push/devices resolveActor(): match on
  //    the last-10-digit phone in either stored form ("91XXXXXXXXXX" or
  //    "XXXXXXXXXX"). A non-provider session is rejected.
  const phone10 = normalizePhone10(session.phone);
  if (phone10.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND", message: "Not a provider account." },
      { status: 403 }
    );
  }

  let providerId = "";
  try {
    const { data, error } = await adminSupabase
      .from("providers")
      .select("provider_id, phone")
      .or(`phone.eq.${phone10},phone.eq.91${phone10}`)
      .limit(5);
    if (error) {
      console.error("[provider/push/test] provider lookup failed", {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_FAILED",
          message: "Could not verify your provider account.",
        },
        { status: 500 }
      );
    }
    const provider = (data || []).find(
      (row) =>
        typeof row.provider_id === "string" &&
        row.provider_id.trim().length > 0 &&
        normalizePhone10(row.phone) === phone10
    );
    if (!provider) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_NOT_FOUND",
          message: "Not a provider account.",
        },
        { status: 403 }
      );
    }
    providerId = String(provider.provider_id || "").trim();
  } catch (err) {
    console.error("[provider/push/test] provider lookup threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "PROVIDER_LOOKUP_FAILED",
        message: "Could not verify your provider account.",
      },
      { status: 500 }
    );
  }

  // 3. Push must be configured server-side.
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

  // 4. Resolve THIS provider's active provider-actor tokens. The helper
  //    filters actor_type='provider' so an admin/user token sharing the
  //    phone is never targeted. Soft-fails to [] on DB error.
  const devices = await getActiveTokensForProviderIds([providerId]);
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

  // 5. Send (data-only; sw.js renders it). A throw = SDK/credentials/network
  //    failure → safe JSON, no per-token log (nothing was attempted).
  const phone = normalizeTargetPhone(session.phone);
  const payload = providerTestPayload();
  let sendResult;
  try {
    sendResult = await sendPushToTokens(tokens, payload);
  } catch (err) {
    console.error("[provider/push/test] send threw", {
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

  // 6. Per-token log + invalid-token cleanup. Soft-fail throughout.
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
      recipientProviderId: providerId,
      fcmTokenTail: tokenTail(r.token),
      status,
      fcmMessageId: r.messageId || null,
      errorCode: r.errorCode || null,
      errorMessage: r.errorMessage || null,
      payloadJson: { eventType: payload.eventType, deepLink: payload.deepLink },
    });
    if (!logResult.ok) {
      console.warn("[provider/push/test] push_logs insert failed", {
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
