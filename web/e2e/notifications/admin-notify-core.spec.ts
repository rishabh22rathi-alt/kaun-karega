/**
 * Phase A — adminNotifyCore unit spec.
 *
 * Runs in Node under the Playwright runner WITHOUT a dev server or DB.
 * Imports the pure core via a relative path (no adminSupabase pulled in)
 * so nothing constructs a Supabase client at import time.
 */

import { test, expect } from "@playwright/test";

import {
  buildAdminNotification,
  runAdminNotify,
  type AdminNotificationInput,
  type AdminNotifyPorts,
} from "../../lib/notifications/adminNotifyCore";

test.describe("Phase A — buildAdminNotification", () => {
  test("provider_paid_plan_subscribed: info / payments / order dedupe", () => {
    const n = buildAdminNotification("provider_paid_plan_subscribed", {
      payment_order_id: "order_123",
      provider_id: "PR-3131",
      provider_name: "QA Provider",
      plan_code: "all_jodhpur",
      amount_paise: 11918,
    });
    expect(n).not.toBeNull();
    expect(n!.type).toBe("provider_paid_plan_subscribed");
    expect(n!.severity).toBe("info");
    expect(n!.source).toBe("payments");
    expect(n!.relatedId).toBe("order_123");
    expect(n!.actionUrl).toBe("/admin/dashboard?tab=payments");
    expect(n!.message).toContain("QA Provider");
    expect(n!.message).toContain("Full Jodhpur plan");
    expect(n!.message).toContain("Rs. 119.18");
  });

  test("payment_failed: warning, related_id = order", () => {
    const n = buildAdminNotification("payment_failed", {
      payment_order_id: "order_9",
      provider_id: "PR-1",
      plan_code: "regions_5",
    });
    expect(n!.severity).toBe("warning");
    expect(n!.source).toBe("payments");
    expect(n!.relatedId).toBe("order_9");
  });

  test("invoice_pdf_failed: critical, related_id = invoice_id, code in message", () => {
    const n = buildAdminNotification("invoice_pdf_failed", {
      invoice_id: "1",
      invoice_number: "KK/FY2026-27/000001",
      error_code: "RENDER_FAILED",
    });
    expect(n!.severity).toBe("critical");
    expect(n!.source).toBe("invoices");
    expect(n!.relatedId).toBe("1");
    expect(n!.message).toContain("KK/FY2026-27/000001");
    expect(n!.message).toContain("RENDER_FAILED");
    expect(n!.actionUrl).toBe("/admin/dashboard?tab=invoices");
  });

  test("new_provider_registered: info, related_id = provider_id", () => {
    const n = buildAdminNotification("new_provider_registered", {
      provider_id: "PR-77",
      provider_name: "Asha",
      phone: "9999999999",
    });
    expect(n!.severity).toBe("info");
    expect(n!.source).toBe("providers");
    expect(n!.relatedId).toBe("PR-77");
    expect(n!.message).toContain("Asha");
    expect(n!.actionUrl).toBe("/admin/dashboard?tab=providers");
  });

  test("issue_report_submitted: warning, related_id = issue id", () => {
    const n = buildAdminNotification("issue_report_submitted", {
      issue_report_id: "iss-5",
      issue_no: "12",
      reporter_role: "provider",
    });
    expect(n!.severity).toBe("warning");
    expect(n!.source).toBe("reports");
    expect(n!.relatedId).toBe("iss-5");
    expect(n!.message).toContain("provider");
    expect(n!.actionUrl).toBe("/admin/dashboard?tab=reports");
  });

  test("unknown event type → null", () => {
    expect(buildAdminNotification("nope", {})).toBeNull();
  });

  test("missing related id → relatedId null (no dedupe key)", () => {
    const n = buildAdminNotification("payment_failed", { provider_id: "PR-1" });
    expect(n!.relatedId).toBeNull();
  });
});

const SAMPLE: AdminNotificationInput = {
  type: "provider_paid_plan_subscribed",
  title: "New plan subscribed",
  message: "x",
  severity: "info",
  source: "payments",
  relatedId: "order_1",
  actionUrl: "/admin/dashboard?tab=payments",
};

test.describe("Phase A — runAdminNotify (soft-fail orchestration)", () => {
  test("dedupes when a row already exists (insert never called)", async () => {
    let inserted = 0;
    const ports: AdminNotifyPorts = {
      findExisting: async () => ({ exists: true }),
      insert: async () => {
        inserted += 1;
        return {};
      },
    };
    const r = await runAdminNotify(SAMPLE, ports);
    expect(r).toEqual({ ok: true, inserted: false, deduped: true });
    expect(inserted).toBe(0);
  });

  test("inserts when no existing row", async () => {
    const ports: AdminNotifyPorts = {
      findExisting: async () => ({ exists: false }),
      insert: async () => ({}),
    };
    const r = await runAdminNotify(SAMPLE, ports);
    expect(r).toEqual({ ok: true, inserted: true, deduped: false });
  });

  test("23505 unique-violation on insert is swallowed as deduped", async () => {
    const ports: AdminNotifyPorts = {
      findExisting: async () => ({ exists: false }),
      insert: async () => ({ errorCode: "23505", errorMessage: "duplicate key" }),
    };
    const r = await runAdminNotify(SAMPLE, ports);
    expect(r).toEqual({ ok: true, inserted: false, deduped: true });
  });

  test("other insert error → { ok:false } and does NOT throw", async () => {
    const ports: AdminNotifyPorts = {
      findExisting: async () => ({ exists: false }),
      insert: async () => ({ errorCode: "500", errorMessage: "boom" }),
    };
    const r = await runAdminNotify(SAMPLE, ports);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("boom");
  });

  test("insert that THROWS is caught → { ok:false }, never propagates", async () => {
    const ports: AdminNotifyPorts = {
      findExisting: async () => ({ exists: false }),
      insert: async () => {
        throw new Error("network down");
      },
    };
    const r = await runAdminNotify(SAMPLE, ports);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("network down");
  });

  test("findExisting error is non-fatal → still inserts", async () => {
    const ports: AdminNotifyPorts = {
      findExisting: async () => ({ exists: false, error: "lookup failed" }),
      insert: async () => ({}),
    };
    const r = await runAdminNotify(SAMPLE, ports);
    expect(r).toEqual({ ok: true, inserted: true, deduped: false });
  });

  test("no relatedId → skips dedupe lookup, inserts", async () => {
    let lookups = 0;
    const ports: AdminNotifyPorts = {
      findExisting: async () => {
        lookups += 1;
        return { exists: false };
      },
      insert: async () => ({}),
    };
    const r = await runAdminNotify({ ...SAMPLE, relatedId: null }, ports);
    expect(r).toEqual({ ok: true, inserted: true, deduped: false });
    expect(lookups).toBe(0);
  });
});
