/**
 * Phase A — pure core for admin in-app notifications.
 *
 * No DB/client imports → unit-testable. Holds the only logic worth
 * pinning: the event registry (severity / source / action URL), the
 * dedupe key (related_id) per event, the title/message builders, and the
 * pure orchestration (`runAdminNotify`) that decides inserted vs deduped
 * vs failed WITHOUT ever throwing.
 *
 * The server wrapper (notifyAdmins.ts) supplies the adminSupabase-backed
 * ports; this file never touches the network.
 *
 * Dedupe: admin_notifications has NO unique constraint today (only an
 * index on related_id) — see 20260513183000_admin_notifications.sql — so
 * dedupe is CHECK-FIRST on (type, related_id), with a 23505 swallow as a
 * backstop should a partial unique index be added later.
 */

export type AdminSeverity = "info" | "warning" | "critical";

export type AdminEventType =
  | "provider_paid_plan_subscribed"
  | "payment_failed"
  | "invoice_pdf_failed"
  | "new_provider_registered"
  | "task_zero_match"
  | "issue_report_submitted";

/** The exact shape persisted to admin_notifications (no metadata column). */
export type AdminNotificationInput = {
  type: string;
  title: string;
  message: string;
  severity: AdminSeverity;
  source: string;
  relatedId: string | null;
  actionUrl: string | null;
};

export type NotifyAdminsResult =
  | { ok: true; inserted: boolean; deduped: boolean }
  | { ok: false; error: string };

export type AdminNotifyPorts = {
  // True when an admin_notifications row already exists for (type, relatedId).
  findExisting: (
    type: string,
    relatedId: string
  ) => Promise<{ exists: boolean; error?: string }>;
  // Insert the row. Return the DB error code/message (null on success).
  insert: (
    input: AdminNotificationInput
  ) => Promise<{ errorCode?: string | null; errorMessage?: string | null }>;
};

type Payload = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** paise → "1,234.56" (no currency symbol; callers prepend "Rs."). */
function rupeesFromPaise(paise: unknown): string {
  const n = Number(paise);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const PLAN_LABEL: Record<string, string> = {
  regions_5: "5 Regions plan",
  all_jodhpur: "Full Jodhpur plan",
};

function planLabel(code: unknown): string {
  const c = str(code);
  return PLAN_LABEL[c] ?? (c || "a plan");
}

/** Human label for a provider: name → phone → id → generic. */
function providerLabel(p: Payload): string {
  return (
    str(p.provider_name) ||
    str(p.phone) ||
    str(p.provider_id) ||
    "a provider"
  );
}

/**
 * Build the admin_notifications row for an event, or null for an unknown
 * event type. Pure and deterministic.
 *
 * `relatedId` is the dedupe key — the natural id of the underlying entity
 * (payment order, invoice, provider, issue, task).
 */
export function buildAdminNotification(
  eventType: string,
  payload: Payload = {}
): AdminNotificationInput | null {
  switch (eventType) {
    case "provider_paid_plan_subscribed":
      return {
        type: eventType,
        title: "New plan subscribed",
        message: `Provider ${providerLabel(payload)} purchased ${planLabel(
          payload.plan_code
        )} for Rs. ${rupeesFromPaise(payload.amount_paise)}.`,
        severity: "info",
        source: "payments",
        relatedId: str(payload.payment_order_id) || null,
        actionUrl: "/admin/dashboard?tab=payments",
      };

    case "payment_failed":
      return {
        type: eventType,
        title: "Payment failed",
        message: `Payment failed for provider ${providerLabel(
          payload
        )} on ${planLabel(payload.plan_code)} (order ${str(
          payload.payment_order_id
        )}).`,
        severity: "warning",
        source: "payments",
        relatedId: str(payload.payment_order_id) || null,
        actionUrl: "/admin/dashboard?tab=payments",
      };

    case "invoice_pdf_failed": {
      const num = str(payload.invoice_number) || str(payload.invoice_id);
      const code = str(payload.error_code);
      return {
        type: eventType,
        title: "Invoice PDF generation failed",
        message: `PDF generation failed for invoice ${num}${
          code ? ` (${code})` : ""
        }.`,
        severity: "critical",
        source: "invoices",
        relatedId: str(payload.invoice_id) || null,
        actionUrl: "/admin/dashboard?tab=invoices",
      };
    }

    case "new_provider_registered":
      return {
        type: eventType,
        title: "New provider registered",
        message: `${providerLabel(payload)} registered as a provider (${str(
          payload.provider_id
        )}).`,
        severity: "info",
        source: "providers",
        relatedId: str(payload.provider_id) || null,
        actionUrl: "/admin/dashboard?tab=providers",
      };

    case "task_zero_match":
      return {
        type: eventType,
        title: "Task has no matching providers",
        message: `Task ${str(
          payload.task_id
        )} found no matching providers and needs attention.`,
        severity: "warning",
        source: "tasks",
        relatedId: str(payload.task_id) || null,
        actionUrl: "/admin/dashboard?tab=kaam",
      };

    case "issue_report_submitted": {
      const role = str(payload.reporter_role) || "user";
      const no = str(payload.issue_no);
      return {
        type: eventType,
        title: "New issue reported",
        message: `A ${role} reported an issue${no ? ` (#${no})` : ""} and needs review.`,
        severity: "warning",
        source: "reports",
        relatedId: str(payload.issue_report_id) || null,
        actionUrl: "/admin/dashboard?tab=reports",
      };
    }

    default:
      return null;
  }
}

/**
 * Pure orchestration: check-first dedupe → insert → classify. NEVER
 * throws — a thrown/erroring port resolves to { ok:false } (or deduped
 * for a 23505 unique-violation backstop). The server wrapper passes
 * adminSupabase-backed ports; tests pass fakes.
 *
 * A findExisting error is non-fatal: we fall through and still attempt
 * the insert (best-effort), relying on the 23505 backstop for safety.
 */
export async function runAdminNotify(
  input: AdminNotificationInput,
  ports: AdminNotifyPorts
): Promise<NotifyAdminsResult> {
  try {
    if (input.relatedId) {
      const found = await ports.findExisting(input.type, input.relatedId);
      if (found.exists) {
        return { ok: true, inserted: false, deduped: true };
      }
    }

    const res = await ports.insert(input);
    if (res.errorCode === "23505") {
      // Unique-violation backstop: another caller inserted concurrently.
      return { ok: true, inserted: false, deduped: true };
    }
    if (res.errorMessage) {
      console.warn("[notifyAdmins] insert failed (non-fatal)", {
        type: input.type,
        message: res.errorMessage,
      });
      return { ok: false, error: res.errorMessage };
    }
    return { ok: true, inserted: true, deduped: false };
  } catch (err) {
    console.warn("[notifyAdmins] threw (non-fatal)", {
      type: input.type,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
