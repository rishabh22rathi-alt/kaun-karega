"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { useUserPush, type UserPushPermission } from "@/lib/push/useUserPush";

/**
 * User Push Phase 1 — user push enable panel.
 *
 * "Enable Push Notifications" requests Notification permission and registers
 * a user web FCM token via useUserPush (soft-fail). "Send Test Push" appears
 * once this device is registered and hits /api/user/push/test.
 *
 * Self-contained mirror of ProviderPushControls; provider/admin push code is
 * untouched. No env flag gates this panel — it relies on browser support +
 * Firebase web config (isFirebaseWebConfigured), surfaced via the status line.
 *
 * Render gate: the panel renders ONLY for a valid logged-in session. We probe
 * GET /api/notification-preferences/user (ok:true for any logged-in user, 401
 * otherwise). The /dashboard layout already redirects logged-out visitors, so
 * this is a belt-and-suspenders guard. Fails closed: any uncertainty hides it.
 */

type UserGate = "checking" | "user" | "anonymous";

export type UserPushStatusTone = "neutral" | "success" | "error";

/**
 * Pure status derivation — drives the visible message AND its tone. Order
 * matters: capability problems first, then the enabled confirmation, then a
 * blocked-permission hint, then the default prompt.
 */
export function userPushStatus(state: {
  supported: boolean;
  configured: boolean;
  registered: boolean;
  permission: UserPushPermission;
}): { text: string; tone: UserPushStatusTone } {
  if (!state.supported) {
    return {
      text: "Push notifications aren't supported in this browser.",
      tone: "error",
    };
  }
  if (!state.configured) {
    return {
      text: "Push isn't configured on this deployment yet.",
      tone: "error",
    };
  }
  if (state.registered) {
    return {
      text: "Push notifications enabled on this device.",
      tone: "success",
    };
  }
  if (state.permission === "denied") {
    return {
      text: "Notifications are blocked. Allow them in your browser settings, then try again.",
      tone: "error",
    };
  }
  return {
    text: "Enable push to get updates on your requests on this device.",
    tone: "neutral",
  };
}

/** Send Test Push is available the moment this device is registered. */
export function userPushTestDisabled(state: {
  registered: boolean;
  testLoading: boolean;
}): boolean {
  return !state.registered || state.testLoading;
}

/** Enable is offered until registered (and only when usable / not busy). */
export function userPushEnableDisabled(state: {
  supported: boolean;
  configured: boolean;
  loading: boolean;
  registered: boolean;
}): boolean {
  return (
    !state.supported || !state.configured || state.loading || state.registered
  );
}

/**
 * Pure mapping from the user-gate probe result to a gate state. Anything that
 * isn't a confirmed logged-in user (ok:true) fails closed to "anonymous".
 */
export function userGateFromProbe(
  httpOk: boolean,
  data: { ok?: boolean } | null
): UserGate {
  return httpOk && data?.ok === true ? "user" : "anonymous";
}

export default function UserPushControls() {
  const [gate, setGate] = useState<UserGate>("checking");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/notification-preferences/user", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean }
          | null;
        if (!cancelled) setGate(userGateFromProbe(res.ok, data));
      } catch {
        // Network error — fail closed: do not show the panel.
        if (!cancelled) setGate("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While checking, and for any anonymous session, render nothing.
  if (gate !== "user") return null;
  return <UserPushPanel />;
}

function UserPushPanel() {
  const {
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
  } = useUserPush();

  const enableDisabled = userPushEnableDisabled({
    supported,
    configured,
    loading,
    registered,
  });
  const testDisabled = userPushTestDisabled({ registered, testLoading });
  const status = userPushStatus({ supported, configured, registered, permission });

  const statusClass =
    status.tone === "success"
      ? "mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-700"
      : status.tone === "error"
        ? "mt-1 text-sm text-rose-600"
        : "mt-1 text-sm text-slate-500";

  return (
    <section
      data-testid="user-push-controls"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-[#003d20]">
        Push Notifications
      </h2>
      <p
        data-testid="user-push-status"
        data-tone={status.tone}
        className={statusClass}
      >
        {status.tone === "success" ? (
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" />
        ) : null}
        {status.text}
      </p>

      {error ? (
        <p
          data-testid="user-push-error"
          role="alert"
          className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void register()}
          disabled={enableDisabled}
          data-testid="user-push-enable-btn"
          className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {registered
            ? "Enabled"
            : loading
              ? "Enabling…"
              : "Enable Push Notifications"}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testDisabled}
          data-testid="user-push-test-btn"
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {testLoading ? "Sending…" : "Send Test Push"}
        </button>
        {!registered ? (
          <span className="text-[11px] text-slate-400">
            Enable push first to send a test.
          </span>
        ) : null}
      </div>

      {testMessage ? (
        <p
          data-testid="user-push-test-message"
          data-kind={testMessage.kind}
          role={testMessage.kind === "error" ? "alert" : "status"}
          className={
            testMessage.kind === "error"
              ? "mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              : testMessage.kind === "success"
                ? "mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                : "mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
          }
        >
          {testMessage.text}
        </p>
      ) : null}
    </section>
  );
}
