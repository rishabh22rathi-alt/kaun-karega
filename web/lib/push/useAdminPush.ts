"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { getFcmWebToken, isFirebaseWebConfigured } from "@/lib/push/firebaseClient";
import {
  adminWebDeviceBody,
  describeTestPushResult,
  registerAdminPush,
  type TestPushMessage,
} from "@/lib/push/adminPushCore";

/**
 * Phase B Step 5 — admin web-push registration hook.
 *
 * Permission + token registration ONLY. No test send, no business-event
 * push. `register()` is meant to be called from a user button click; it
 * never throws (delegates to the soft-fail core). Nothing runs on mount.
 */

export type AdminPushPermission = NotificationPermission | "unsupported";

// Stable no-op subscribe — `mounted/client` detection without setState in
// an effect (avoids the react-hooks/set-state-in-effect rule).
const emptySubscribe = () => () => {};

// Client-local "this device was registered" flag. A page reload cannot
// re-read the FCM token (and we deliberately add no GET route), so we
// remember a successful registration here to keep the enabled state — and
// the Send Test Push button — across reloads. Best-effort only: if the
// server-side token was later revoked, the test send simply reports that
// nothing was delivered (handled by describeTestPushResult).
const REGISTERED_KEY = "kk.adminPush.registered";

function readPersistedRegistered(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(REGISTERED_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function persistRegistered(): void {
  try {
    window.localStorage.setItem(REGISTERED_KEY, "1");
  } catch {
    // Private mode / disabled storage — non-fatal; in-session state still set.
  }
}

// Cross-tab sync only (the `storage` event never fires in the writing tab);
// same-tab updates come from setRegisteredState re-rendering the hook.
function subscribeStorage(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function detectSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.Notification !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

// Ensure a SW registration exists so getToken has one to bind to. Does NOT
// modify the SW file — registers the existing /sw.js if not already active
// (PwaServiceWorkerRegister does this in production; this is a safety net).
async function ensureSwRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }
  let reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
  if (!reg) {
    reg = await navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => undefined);
  }
  await navigator.serviceWorker.ready.catch(() => undefined);
  if (reg) return reg;
  return (
    (await navigator.serviceWorker.getRegistration("/").catch(() => undefined)) ??
    undefined
  );
}

export function useAdminPush() {
  // false during SSR, true on the client — no setState, hydration-safe.
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const supported = isClient && detectSupported();
  const configured = isFirebaseWebConfigured();
  // Read live each render; register() triggers a re-render via setLoading,
  // so this reflects the post-prompt value without separate state.
  const permission: AdminPushPermission = supported
    ? window.Notification.permission
    : "unsupported";

  // SSR/first-paint snapshot is false; after hydration the client snapshot
  // reflects a prior successful registration on this device.
  const persistedRegistered = useSyncExternalStore(
    subscribeStorage,
    readPersistedRegistered,
    () => false
  );
  const [registeredState, setRegisteredState] = useState(false);
  const registered = registeredState || persistedRegistered;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testLoading, setTestLoading] = useState(false);
  const [testMessage, setTestMessage] = useState<TestPushMessage | null>(null);

  const register = useCallback(async () => {
    setLoading(true);
    setError(null);

    const outcome = await registerAdminPush({
      isSupported: detectSupported,
      isConfigured: isFirebaseWebConfigured,
      requestPermission: () => window.Notification.requestPermission(),
      getToken: async () => getFcmWebToken(await ensureSwRegistration()),
      postDevice: async (token) => {
        try {
          const res = await fetch("/api/native-push/devices", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(adminWebDeviceBody(token)),
          });
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; error?: string }
            | null;
          if (!res.ok || !data?.ok) {
            return {
              ok: false,
              error: data?.error || `Registration failed (${res.status}).`,
            };
          }
          return { ok: true };
        } catch {
          return { ok: false, error: "Network error while registering." };
        }
      },
    });

    if (outcome.status === "registered") {
      setRegisteredState(true);
      persistRegistered();
    } else if (outcome.status === "denied") {
      setError(
        "Notifications are blocked. Allow them in your browser settings, then try again."
      );
    } else if (outcome.status === "unsupported") {
      setError("Push is not supported in this browser.");
    } else if (outcome.status === "unconfigured") {
      setError("Push is not configured on this deployment.");
    } else {
      setError(outcome.error);
    }
    setLoading(false);
  }, []);

  // Step 6: send a test push to the admin's own registered web device(s).
  // Never throws; result is surfaced as a message. No business event.
  const sendTest = useCallback(async () => {
    setTestLoading(true);
    setTestMessage(null);
    try {
      const res = await fetch("/api/admin/push/test", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; sent?: number; message?: string; error?: string }
        | null;
      setTestMessage(describeTestPushResult(res.ok, data));
    } catch {
      setTestMessage({ kind: "error", text: "Network error sending test push." });
    } finally {
      setTestLoading(false);
    }
  }, []);

  return {
    supported,
    configured,
    permission,
    registered,
    loading,
    error,
    register,
    testLoading,
    testMessage,
    sendTest,
  };
}
