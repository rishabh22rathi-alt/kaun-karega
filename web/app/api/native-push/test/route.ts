import { NextResponse } from "next/server";
import { checkAdminByPhone } from "@/lib/adminAuth";
import { getAuthSession } from "@/lib/auth";
import { isPushConfigured } from "@/lib/push/firebaseAdmin";
import { sendPushToTokens } from "@/lib/push/sendFcm";
import {
  getActiveTokensForPhone,
  normalizeTargetPhone,
} from "@/lib/push/recipients";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "@/lib/push/invalidateTokens";
import { testPayload } from "@/lib/push/payloads";
import { appendPushLog, tokenTail } from "@/lib/push/pushLogStore";

export const runtime = "nodejs";

type TestPushBody = {
  targetPhone?: unknown;
};

export async function POST(request: Request) {
  // ─── 1. Env gates — fail safe with 503 when push is not configured for
  //          this environment. Order matters: we check the route's own
  //          NATIVE_PUSH_TEST_SECRET FIRST so a misconfigured Firebase env
  //          doesn't leak through admin-only assertions.
  const expectedSecret = process.env.NATIVE_PUSH_TEST_SECRET ?? "";
  if (expectedSecret.length < 16) {
    return NextResponse.json(
      { ok: false, error: "Push test route not configured" },
      { status: 503 }
    );
  }
  if (!isPushConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Firebase Admin not configured" },
      { status: 503 }
    );
  }

  // ─── 2. Header secret — opaque per-deploy. Matches the gating pattern
  //          used by process-task-notifications' x-kk-internal-secret.
  const headerSecret = request.headers.get("x-kk-test-secret") ?? "";
  if (
    headerSecret.length < 16 ||
    headerSecret.length !== expectedSecret.length ||
    headerSecret !== expectedSecret
  ) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // ─── 3. Cookie session.
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
    validateVersion: true,
  });
  if (!session?.phone) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ─── 4. Admin identity gate. The secret alone is not enough — a leaked
  //          secret without an admin cookie still cannot fire a push.
  const adminResult = await checkAdminByPhone(session.phone);
  if (!adminResult.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: admin only" },
      { status: 403 }
    );
  }

  // ─── 5. Body.
  let body: TestPushBody;
  try {
    body = (await request.json()) as TestPushBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const targetPhone = normalizeTargetPhone(body.targetPhone);
  if (!targetPhone) {
    return NextResponse.json(
      { ok: false, error: "targetPhone required (10-digit Indian mobile)" },
      { status: 400 }
    );
  }

  // ─── 6. Resolve active devices for the target phone. May be 0 — that's
  //          a legitimate "no device registered" outcome, not an error.
  const devices = await getActiveTokensForPhone(targetPhone);
  if (devices.length === 0) {
    return NextResponse.json({
      ok: true,
      targetedDevices: 0,
      sent: 0,
      failed: 0,
      invalidated: 0,
    });
  }

  // ─── 7. Send. A throw here means the SDK itself failed (bad credentials,
  //          network); we DO NOT log per-token rows in that case because
  //          no token was actually attempted.
  const payload = testPayload();
  let sendResult;
  try {
    sendResult = await sendPushToTokens(
      devices.map((d) => d.fcmToken),
      payload
    );
  } catch (err) {
    console.error("[native-push/test] sendEachForMulticast threw", {
      message: err instanceof Error ? err.message : String(err),
      targetedDevices: devices.length,
    });
    return NextResponse.json(
      { ok: false, error: "Push send failed" },
      { status: 500 }
    );
  }

  // ─── 8. Per-token log + invalid-token cleanup. Soft-fail throughout —
  //          a failing log insert must not poison the user-visible counts.
  const invalidTokens: string[] = [];
  const deviceByToken = new Map(devices.map((d) => [d.fcmToken, d] as const));

  for (const r of sendResult.results) {
    const device = deviceByToken.get(r.token);
    const status: "sent" | "invalid_token" | "failed" = r.ok
      ? "sent"
      : isInvalidTokenError(r.errorCode)
        ? "invalid_token"
        : "failed";
    if (status === "invalid_token") {
      invalidTokens.push(r.token);
    }
    const logResult = await appendPushLog({
      eventType: "test",
      recipientPhone: device?.phone ?? targetPhone,
      recipientProviderId: device?.providerId ?? null,
      fcmTokenTail: tokenTail(r.token),
      status,
      fcmMessageId: r.messageId || null,
      errorCode: r.errorCode || null,
      errorMessage: r.errorMessage || null,
      payloadJson: {
        eventType: payload.eventType,
        deepLink: payload.deepLink,
      },
    });
    if (!logResult.ok) {
      console.warn("[native-push/test] push_logs insert failed", {
        tokenTail: tokenTail(r.token),
        error: logResult.error,
      });
    }
  }

  let invalidated = 0;
  if (invalidTokens.length > 0) {
    const deact = await deactivateInvalidTokens(invalidTokens);
    invalidated = deact.deactivated;
  }

  // Counts only — never echo tokens, payload, or admin identity back.
  return NextResponse.json({
    ok: true,
    targetedDevices: devices.length,
    sent: sendResult.successCount,
    failed: sendResult.failureCount,
    invalidated,
  });
}
