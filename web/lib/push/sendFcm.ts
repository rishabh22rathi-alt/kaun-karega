import { getPushMessaging, isPushConfigured } from "./firebaseAdmin";
import type { PushDataPayload } from "./payloads";

export type SendTokenResult = {
  token: string;
  ok: boolean;
  messageId: string;
  errorCode: string;
  errorMessage: string;
};

export type SendBatchResult = {
  successCount: number;
  failureCount: number;
  results: SendTokenResult[];
};

// Data-only sends. The Android client builds the system notification itself
// from `data` so we keep full control over foreground vs background UX —
// FCM's `notification` block would pre-render the system tray entry before
// the app sees it.
export async function sendPushToTokens(
  tokens: string[],
  payload: PushDataPayload,
  options: { dryRun?: boolean } = {}
): Promise<SendBatchResult> {
  if (!isPushConfigured()) {
    throw new Error("Firebase Admin is not configured");
  }

  const uniqueTokens = Array.from(
    new Set(
      tokens.filter((t) => typeof t === "string" && t.trim().length >= 20)
    )
  );
  if (uniqueTokens.length === 0) {
    return { successCount: 0, failureCount: 0, results: [] };
  }

  // FCM data values must be strings. payloads.ts already enforces that at the
  // type level, but coerce defensively in case a future field slips through.
  const dataRecord: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      dataRecord[key] = value;
    } else if (value !== null && value !== undefined) {
      dataRecord[key] = String(value);
    }
  }

  const messaging = getPushMessaging();
  const response = await messaging.sendEachForMulticast(
    {
      tokens: uniqueTokens,
      data: dataRecord,
      android: {
        priority: "high",
        ttl: 60 * 60 * 1000,
      },
    },
    options.dryRun === true
  );

  const results: SendTokenResult[] = response.responses.map((r, idx) => ({
    token: uniqueTokens[idx]!,
    ok: r.success,
    messageId: r.success ? r.messageId ?? "" : "",
    errorCode: r.error?.code ?? "",
    errorMessage: r.error?.message ?? "",
  }));

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    results,
  };
}
