"use client";

import { CheckCircle2 } from "lucide-react";

import { useAdminPush, type AdminPushPermission } from "@/lib/push/useAdminPush";

/**
 * Phase B — Admin Push Alerts panel.
 *
 * Step 1: gated shell. Step 5: "Enable Push Alerts" now requests
 * Notification permission and registers an admin web FCM token via
 * useAdminPush (soft-fail). "Send Test Push" stays disabled until Step 6.
 *
 * Visibility is controlled entirely by NEXT_PUBLIC_ADMIN_PUSH_ENABLED:
 * the panel renders only when it is exactly "true"; otherwise nothing.
 */

/** Pure gate — the panel shows only when the flag is exactly "true". */
export function shouldShowAdminPushShell(flag: string | undefined): boolean {
  return flag === "true";
}

export type AdminPushStatusTone = "neutral" | "success" | "error";

/**
 * Pure status derivation — drives the visible message AND its tone so the
 * enabled state reads as a clear success (not the same muted gray as the
 * "please enable" prompt). Order matters: capability problems first, then
 * the enabled confirmation, then a blocked-permission hint.
 */
export function adminPushStatus(state: {
  supported: boolean;
  configured: boolean;
  registered: boolean;
  permission: AdminPushPermission;
}): { text: string; tone: AdminPushStatusTone } {
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
    return { text: "Push alerts enabled on this device.", tone: "success" };
  }
  if (state.permission === "denied") {
    return {
      text: "Notifications are blocked. Allow them in your browser settings, then try again.",
      tone: "error",
    };
  }
  return {
    text: "Enable push alerts to receive admin notifications on this device.",
    tone: "neutral",
  };
}

/** Send Test Push is available the moment this device is registered. */
export function adminPushTestDisabled(state: {
  registered: boolean;
  testLoading: boolean;
}): boolean {
  return !state.registered || state.testLoading;
}

/** Enable is offered until registered (and only when usable / not busy). */
export function adminPushEnableDisabled(state: {
  supported: boolean;
  configured: boolean;
  loading: boolean;
  registered: boolean;
}): boolean {
  return (
    !state.supported || !state.configured || state.loading || state.registered
  );
}

export default function AdminPushControls() {
  // Next inlines this NEXT_PUBLIC_* member access at build time.
  if (!shouldShowAdminPushShell(process.env.NEXT_PUBLIC_ADMIN_PUSH_ENABLED)) {
    return null;
  }
  return <AdminPushPanel />;
}

function AdminPushPanel() {
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
  } = useAdminPush();

  const enableDisabled = adminPushEnableDisabled({
    supported,
    configured,
    loading,
    registered,
  });
  const testDisabled = adminPushTestDisabled({ registered, testLoading });
  const status = adminPushStatus({ supported, configured, registered, permission });

  const statusClass =
    status.tone === "success"
      ? "mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-700"
      : status.tone === "error"
        ? "mt-1 text-sm text-rose-600"
        : "mt-1 text-sm text-slate-500";

  return (
    <section
      data-testid="admin-push-controls"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-[#003d20]">Admin Push Alerts</h2>
      <p
        data-testid="admin-push-status"
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
          data-testid="admin-push-error"
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
          data-testid="admin-push-enable-btn"
          className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {registered ? "Enabled" : loading ? "Enabling…" : "Enable Push Alerts"}
        </button>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testDisabled}
          data-testid="admin-push-test-btn"
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
          data-testid="admin-push-test-message"
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
