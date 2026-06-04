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
  | "payment_amount_mismatch"
  | "invoice_pdf_failed"
  | "invoice_issue_failed"
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

    case "payment_amount_mismatch": {
      const captured = payload.captured_paise;
      const detail =
        captured === null || captured === undefined || captured === ""
          ? "no captured amount was provided"
          : `captured Rs. ${rupeesFromPaise(captured)} vs expected Rs. ${rupeesFromPaise(
              payload.expected_paise
            )}`;
      return {
        type: eventType,
        title: "Payment amount mismatch — not activated",
        message: `Order ${str(
          payload.payment_order_id
        )} was NOT activated: ${detail}. Manual review required.`,
        severity: "critical",
        source: "payments",
        relatedId: str(payload.payment_order_id) || null,
        actionUrl: "/admin/dashboard?tab=payments",
      };
    }

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

    case "invoice_issue_failed": {
      const oc = str(payload.outcome);
      return {
        type: eventType,
        title: "Invoice issuance failed",
        message: `Invoice was not issued for paid order ${str(
          payload.payment_order_id
        )}${oc ? ` (${oc})` : ""}. The plan is active; run invoice backfill.`,
        severity: "critical",
        source: "invoices",
        relatedId: str(payload.payment_order_id) || null,
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
 * Phase B Step 7 — the ONLY admin events wired to PWA push right now, with
 * their PII-free push copy. Adding an event here (and only here) opts it in;
 * everything else stays notification-centre-only. Copy intentionally omits
 * provider name / phone / amount — the in-app notification carries detail.
 */
const ADMIN_PUSH_EVENTS: Record<string, { title: string; body: string }> = {
  provider_paid_plan_subscribed: {
    title: "New plan subscribed",
    body: "A provider purchased a paid plan.",
  },
  payment_failed: {
    title: "Payment failed",
    body: "A provider payment failed and may need review.",
  },
  invoice_pdf_failed: {
    title: "Invoice PDF failed",
    body: "An invoice PDF could not be generated.",
  },
  payment_amount_mismatch: {
    title: "Payment needs review",
    body: "A payment amount did not match and was not activated.",
  },
  invoice_issue_failed: {
    title: "Invoice issuance failed",
    body: "A paid order has no invoice yet.",
  },
};

/** Push copy for a pushable event, or null if the event is centre-only. */
export function adminPushForEvent(
  eventType: string
): { title: string; body: string } | null {
  return ADMIN_PUSH_EVENTS[eventType] ?? null;
}

/**
 * Push fires only when (a) the event is opted-in AND (b) the notification
 * was freshly INSERTED — never on a deduped webhook retry and never on a
 * failed insert. This single predicate enforces requirements 1/3/4.
 */
export function shouldSendAdminPush(
  eventType: string,
  result: NotifyAdminsResult
): boolean {
  return (
    result.ok &&
    result.inserted === true &&
    adminPushForEvent(eventType) !== null
  );
}

/** What the push port receives — derived purely from the notification row. */
export type AdminPushDispatch = {
  eventType: string;
  title: string;
  body: string;
  deepLink: string;
  relatedId: string | null;
};

export type AdminPushPort = (dispatch: AdminPushDispatch) => Promise<void>;

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

/**
 * Phase B Step 7 — runAdminNotify + best-effort admin push, in one pure,
 * testable step. The notification-centre insert is the source of truth and
 * its result is ALWAYS what we return: the push is fired (only on a fresh
 * insert of an opted-in event) AFTER the insert, and any push failure is
 * swallowed here so it can never alter the returned result or throw into
 * the caller. The server wrapper injects a real `sendPush`; tests inject a
 * spy / a rejecting fake.
 */
export async function runAdminNotifyWithPush(
  input: AdminNotificationInput,
  ports: AdminNotifyPorts,
  sendPush: AdminPushPort
): Promise<NotifyAdminsResult> {
  const result = await runAdminNotify(input, ports);

  if (shouldSendAdminPush(input.type, result)) {
    const copy = adminPushForEvent(input.type)!;
    try {
      await sendPush({
        eventType: input.type,
        title: copy.title,
        body: copy.body,
        // deepLink mirrors the admin_notifications.action_url (req 7).
        deepLink: input.actionUrl ?? "",
        relatedId: input.relatedId,
      });
    } catch (err) {
      console.warn("[notifyAdmins] admin push threw (non-fatal)", {
        type: input.type,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
