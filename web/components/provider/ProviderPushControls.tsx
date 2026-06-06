"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import {
  useProviderPush,
  type ProviderPushPermission,
} from "@/lib/push/useProviderPush";

/**
 * Provider Push Phase 1 — provider push enable panel.
 *
 * "Enable Push Notifications" requests Notification permission and registers
 * a provider web FCM token via useProviderPush (soft-fail). "Send Test Push"
 * appears once this device is registered and hits /api/provider/push/test.
 *
 * Self-contained mirror of AdminPushControls; admin push code is untouched.
 * No env flag gates this panel — it relies on browser support + Firebase web
 * config (isFirebaseWebConfigured), surfaced via the status line below.
 *
 * Provider-only render gate: the panel renders ONLY for a session the server
 * confirms is a provider. We probe GET /api/notification-preferences (the
 * same provider-identity gate this page already trusts: ok:true for a
 * provider, 401 for a guest, 404 for a non-provider). Guests / users / admins
 * never see the panel. This is purely a render gate — server-side protections
 * on /api/native-push/devices and /api/provider/push/test are unchanged and
 * remain the real enforcement. Fails closed: any uncertainty hides the panel.
 */

type ProviderGate = "checking" | "provider" | "not-provider";

export type ProviderPushStatusTone = "neutral" | "success" | "error";

/**
 * Pure status derivation — drives the visible message AND its tone. Order
 * matters: capability problems first, then the enabled confirmation, then a
 * blocked-permission hint, then the default prompt.
 */
export function providerPushStatus(state: {
  supported: boolean;
  configured: boolean;
  registered: boolean;
  permission: ProviderPushPermission;
}): { text: string; tone: ProviderPushStatusTone } {
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
    text: "Enable push to get notified about new jobs and updates on this device.",
    tone: "neutral",
  };
}

/** Send Test Push is available the moment this device is registered. */
export function providerPushTestDisabled(state: {
  registered: boolean;
  testLoading: boolean;
}): boolean {
  return !state.registered || state.testLoading;
}

/** Enable is offered until registered (and only when usable / not busy). */
export function providerPushEnableDisabled(state: {
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
 * Pure mapping from the provider-gate probe result to a gate state. Keeps
 * the fetch-handling branch trivial and unit-testable. Anything that isn't a
 * confirmed provider (ok:true) fails closed to "not-provider".
 */
export function providerGateFromProbe(
  httpOk: boolean,
  data: { ok?: boolean } | null
): ProviderGate {
  return httpOk && data?.ok === true ? "provider" : "not-provider";
}

export default function ProviderPushControls() {
  const [gate, setGate] = useState<ProviderGate>("checking");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/notification-preferences", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean }
          | null;
        if (!cancelled) setGate(providerGateFromProbe(res.ok, data));
      } catch {
        // Network error — fail closed: do not show the provider panel.
        if (!cancelled) setGate("not-provider");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While checking, and for any non-provider session, render nothing so the
  // panel is never shown to guests / users / admins.
  if (gate !== "provider") return null;
  return <ProviderPushPanel />;
}

function ProviderPushPanel() {
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
  } = useProviderPush();

  const enableDisabled = providerPushEnableDisabled({
    supported,
    configured,
    loading,
    registered,
  });
  const testDisabled = providerPushTestDisabled({ registered, testLoading });
  const status = providerPushStatus({
    supported,
    configured,
    registered,
    permission,
  });

  const statusClass =
    status.tone === "success"
      ? "mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-700"
      : status.tone === "error"
        ? "mt-1 text-sm text-rose-600"
        : "mt-1 text-sm text-slate-500";

  return (
    <section
      data-testid="provider-push-controls"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-[#003d20]">
        Push Notifications
      </h2>
      <p
        data-testid="provider-push-status"
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
          data-testid="provider-push-error"
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
          data-testid="provider-push-enable-btn"
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
          data-testid="provider-push-test-btn"
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
          data-testid="provider-push-test-message"
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
