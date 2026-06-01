"use client";

import { useAdminPush } from "@/lib/push/useAdminPush";

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

  const enableDisabled = !supported || !configured || loading || registered;
  const testDisabled = !registered || testLoading;

  let status = "Enable push alerts to receive admin notifications on this device.";
  if (!supported) {
    status = "Push notifications aren't supported in this browser.";
  } else if (!configured) {
    status = "Push isn't configured on this deployment yet.";
  } else if (registered) {
    status = "Push alerts are enabled on this device.";
  } else if (permission === "denied") {
    status =
      "Notifications are blocked. Allow them in your browser settings, then try again.";
  }

  return (
    <section
      data-testid="admin-push-controls"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-[#003d20]">Admin Push Alerts</h2>
      <p data-testid="admin-push-status" className="mt-1 text-sm text-slate-500">
        {status}
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
