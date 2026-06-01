/**
 * Phase B Step 7 — admin business-alert → PWA push wiring (pure).
 *
 * The push fan-out itself (FCM, push_logs, token cleanup) is exercised
 * manually on a device — see the report. Here we pin the pure decision +
 * orchestration that owns every requirement:
 *   - which events push now (provider_paid_plan_subscribed / payment_failed
 *     / invoice_pdf_failed) and which stay centre-only,
 *   - push fires only on a FRESH insert (dedupe blocks webhook-retry pushes),
 *   - a push failure never throws and never changes the centre-insert result,
 *   - the notification-centre insert still happens regardless of push.
 */

import { test, expect } from "@playwright/test";

import {
  buildAdminNotification,
  runAdminNotifyWithPush,
  adminPushForEvent,
  shouldSendAdminPush,
  type AdminNotifyPorts,
  type AdminPushDispatch,
} from "../../lib/notifications/adminNotifyCore";

// A ports double whose insert always succeeds and records that it ran.
function okPorts(): AdminNotifyPorts & { inserted: number; existed: boolean } {
  const state = { inserted: 0, existed: false };
  return Object.assign(state, {
    findExisting: async () => ({ exists: state.existed }),
    insert: async () => {
      state.inserted += 1;
      return { errorCode: null, errorMessage: null };
    },
  });
}

const PAID = () =>
  buildAdminNotification("provider_paid_plan_subscribed", {
    provider_name: "Test Provider",
    phone: "919462098100",
    plan_code: "all_jodhpur",
    amount_paise: 10100,
    payment_order_id: "order_ABC123",
  })!;

test.describe("admin push — event selection (PII-free copy)", () => {
  test("the three opted-in events have push copy; others do not", () => {
    expect(adminPushForEvent("provider_paid_plan_subscribed")).toEqual({
      title: "New plan subscribed",
      body: "A provider purchased a paid plan.",
    });
    expect(adminPushForEvent("payment_failed")).toEqual({
      title: "Payment failed",
      body: "A provider payment failed and may need review.",
    });
    expect(adminPushForEvent("invoice_pdf_failed")).toEqual({
      title: "Invoice PDF failed",
      body: "An invoice PDF could not be generated.",
    });

    for (const centreOnly of [
      "new_provider_registered",
      "issue_report_submitted",
      "task_zero_match",
      "invoice_generated",
    ]) {
      expect(adminPushForEvent(centreOnly)).toBeNull();
    }
  });

  test("push copy carries no PII (no phone / amount / name)", () => {
    for (const e of [
      "provider_paid_plan_subscribed",
      "payment_failed",
      "invoice_pdf_failed",
    ]) {
      const copy = adminPushForEvent(e)!;
      const text = `${copy.title} ${copy.body}`;
      expect(text).not.toMatch(/\d{6,}/); // no phone / long numbers
      expect(text.toLowerCase()).not.toContain("rs.");
    }
  });

  test("shouldSendAdminPush: only opted-in AND freshly inserted", () => {
    const inserted = { ok: true as const, inserted: true, deduped: false };
    const deduped = { ok: true as const, inserted: false, deduped: true };
    const failed = { ok: false as const, error: "boom" };

    expect(shouldSendAdminPush("provider_paid_plan_subscribed", inserted)).toBe(true);
    expect(shouldSendAdminPush("provider_paid_plan_subscribed", deduped)).toBe(false);
    expect(shouldSendAdminPush("provider_paid_plan_subscribed", failed)).toBe(false);
    expect(shouldSendAdminPush("new_provider_registered", inserted)).toBe(false);
  });
});

test.describe("admin push — orchestration wiring", () => {
  test("provider_paid_plan_subscribed calls the push helper once", async () => {
    const calls: AdminPushDispatch[] = [];
    const result = await runAdminNotifyWithPush(PAID(), okPorts(), async (d) => {
      calls.push(d);
    });

    expect(result).toEqual({ ok: true, inserted: true, deduped: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe("New plan subscribed");
    expect(calls[0]!.body).toBe("A provider purchased a paid plan.");
    // deepLink mirrors the admin_notifications.action_url for this event.
    expect(calls[0]!.deepLink).toBe("/admin/dashboard?tab=payments");
    expect(calls[0]!.relatedId).toBe("order_ABC123");
  });

  test("deduped (webhook retry) does NOT send a second push", async () => {
    const ports = okPorts();
    ports.existed = true; // simulate an already-existing alert row
    const calls: AdminPushDispatch[] = [];

    const result = await runAdminNotifyWithPush(PAID(), ports, async (d) => {
      calls.push(d);
    });

    expect(result).toEqual({ ok: true, inserted: false, deduped: true });
    expect(calls).toHaveLength(0);
    expect(ports.inserted).toBe(0);
  });

  test("non-push event (new_provider_registered) does not push", async () => {
    const calls: AdminPushDispatch[] = [];
    const input = buildAdminNotification("new_provider_registered", {
      provider_name: "X",
      provider_id: "prov_1",
    })!;

    const result = await runAdminNotifyWithPush(input, okPorts(), async (d) => {
      calls.push(d);
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("push failure does not throw and centre insert still succeeds", async () => {
    const ports = okPorts();
    const result = await runAdminNotifyWithPush(PAID(), ports, async () => {
      throw new Error("FCM exploded");
    });

    // Insert ran exactly once and the returned result reflects the insert,
    // unaffected by the push throw.
    expect(ports.inserted).toBe(1);
    expect(result).toEqual({ ok: true, inserted: true, deduped: false });
  });
});
