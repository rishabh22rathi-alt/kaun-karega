/**
 * User Push Phase 1 — pure orchestration for user web-push registration.
 *
 * Self-contained mirror of providerPushCore so the provider/admin paths stay
 * untouched. No DOM, no Firebase, no React — the browser/SDK pieces are
 * injected as `deps` so the decision flow is unit-testable and the React hook
 * (useUserPush) stays a thin wiring layer. NEVER throws: any failure resolves
 * to a typed outcome.
 *
 * Flow: supported? → configured? → request permission → get token →
 * POST to /api/native-push/devices. A POST only happens AFTER permission is
 * granted AND a token was obtained. The server resolves actor_type='user'
 * from the session — the client never sends actor_type.
 */

export type UserPushOutcome =
  | { status: "unsupported" }
  | { status: "unconfigured" }
  | { status: "denied" }
  | { status: "error"; error: string }
  | { status: "registered" };

/**
 * Body posted to /api/native-push/devices for a user web registration.
 * actor_type is NOT sent — the server resolves it from the session, so the
 * client cannot forge it. Pure, so the platform:"web" contract is testable.
 */
export function userWebDeviceBody(token: string): {
  fcmToken: string;
  platform: "web";
} {
  return { fcmToken: token, platform: "web" };
}

/** User-facing message for a test-push response (pure → unit-testable). */
export type UserTestPushMessage = {
  kind: "success" | "error" | "info";
  text: string;
};

export function describeUserTestPushResult(
  httpOk: boolean,
  data: { ok?: boolean; sent?: number; message?: string; error?: string } | null
): UserTestPushMessage {
  if (!httpOk || !data?.ok) {
    return {
      kind: "error",
      text: data?.message || data?.error || "Test push failed.",
    };
  }
  const sent = Number(data.sent ?? 0);
  if (sent > 0) {
    return { kind: "success", text: data.message || "Test push sent." };
  }
  return { kind: "info", text: data.message || "No push delivered yet." };
}

export type UserPushDeps = {
  /** Notification + serviceWorker available in this browser. */
  isSupported: () => boolean;
  /** All NEXT_PUBLIC_FIREBASE_* values present. */
  isConfigured: () => boolean;
  /** Prompt for (or read) Notification permission. */
  requestPermission: () => Promise<NotificationPermission>;
  /** Ensure SW + mint an FCM web token; null on any failure. */
  getToken: () => Promise<string | null>;
  /** POST the token to the registration route. */
  postDevice: (token: string) => Promise<{ ok: boolean; error?: string }>;
};

export async function registerUserPush(
  deps: UserPushDeps
): Promise<UserPushOutcome> {
  try {
    if (!deps.isSupported()) return { status: "unsupported" };
    if (!deps.isConfigured()) return { status: "unconfigured" };

    const permission = await deps.requestPermission();
    if (permission !== "granted") return { status: "denied" };

    const token = await deps.getToken();
    if (!token) {
      return { status: "error", error: "Could not obtain a push token." };
    }

    const res = await deps.postDevice(token);
    if (!res.ok) {
      return {
        status: "error",
        error: res.error || "Failed to register this device.",
      };
    }
    return { status: "registered" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
