// Push payload builders. All values that end up in FCM `data` MUST be strings;
// FCM rejects non-string values. Keep that invariant inside this module so
// callers cannot accidentally violate it.

// Naming convention: eventType doubles as the future notification-preference
// key. Provider-facing event types use the same string the preferences UI
// will toggle ("new_service_request", "chat_message", "general_announcement",
// "jodhpur_need", "new_category_addition"). Phase 4B introduces
// "new_service_request"; "job_matched" stays in the union for any historical
// callers/rows that may exist from earlier audits. Phase 7B adds "general"
// for admin platform announcements (mandatory, cannot be opted out of).
export type PushEventType =
  | "new_service_request"
  | "job_matched"
  | "chat_message"
  | "general"
  // Phase 3.1 reserves the type for the future Phase 3.2 activation
  // worker. The push send is NOT wired in this phase — the union
  // entry exists so the planActivatedPayload() builder below
  // type-checks, and so push_logs writers can reference the literal
  // without a downstream cast once Phase 3.2 lands. The DB
  // push_logs.event_type CHECK already admits 'plan_activated' from
  // the Phase 1 widening migration.
  | "plan_activated"
  // Phase B Step 7: high-priority admin business alerts fanned out to admin
  // WEB devices (provider_paid_plan_subscribed / payment_failed /
  // invoice_pdf_failed). The push_logs.event_type CHECK already admits
  // 'admin_alert' (20260518120000_notification_preferences.sql).
  | "admin_alert"
  | "test";

export type PushDataPayload = {
  title: string;
  body: string;
  deepLink: string;
  eventType: PushEventType;
  sentAt: string;
  // Open record so per-event builders can add typed string fields
  // (taskId, threadId, displayId, etc.) without changing this base type.
  [extra: string]: string;
};

export function testPayload(): PushDataPayload {
  return {
    title: "Kaun Karega test",
    body: "Native push is working",
    deepLink: "/",
    eventType: "test",
    sentAt: new Date().toISOString(),
  };
}

// Phase B Step 6: admin WEB test push. deepLink lands on /admin/alerts so
// the service-worker notificationclick opens the alerts feed. Data-only
// (FCM `data` is Map<string,string>) — sw.js renders the notification.
export function adminTestPayload(): PushDataPayload {
  return {
    title: "Kaun Karega Admin Alert",
    body: "Test push notification received.",
    deepLink: "/admin/alerts",
    eventType: "test",
    sentAt: new Date().toISOString(),
  };
}

// Provider Push Phase 1: provider WEB test push. deepLink lands on
// /provider/dashboard so the service-worker notificationclick opens the
// provider's home screen. Title/body are PII-free (no name / phone / job
// detail). Data-only (FCM `data` is Map<string,string>) — sw.js renders it.
export function providerTestPayload(): PushDataPayload {
  return {
    title: "Kaun Karega",
    body: "Test notification received. Push is working.",
    deepLink: "/provider/dashboard",
    eventType: "test",
    sentAt: new Date().toISOString(),
  };
}

// Phase B Step 7: admin business-alert push (admin WEB devices only). The
// title/body are intentionally PII-free (no provider name / phone / amount)
// — the in-app notification centre carries the detail; the push is just a
// nudge. deepLink mirrors the admin_notifications.action_url so a tap lands
// on the same admin screen. businessEvent preserves which event fired (the
// FCM eventType itself is the generic 'admin_alert' so sw.js + push_logs
// stay uniform). All values MUST be strings (FCM data is Map<string,string>).
export type AdminAlertPayloadInput = {
  eventType: string;
  title: string;
  body: string;
  deepLink: string;
  relatedId?: string | null;
};

export function adminAlertPayload(input: AdminAlertPayloadInput): PushDataPayload {
  return {
    title: String(input.title ?? "").trim(),
    body: String(input.body ?? "").trim(),
    deepLink: String(input.deepLink ?? "").trim(),
    eventType: "admin_alert",
    sentAt: new Date().toISOString(),
    businessEvent: String(input.eventType ?? "").trim(),
    relatedId: String(input.relatedId ?? "").trim(),
  };
}

// Title-case for the push body only. Categories/areas elsewhere in the app
// (WhatsApp template, bell, DB) keep their raw casing — we don't want a
// helper in this file to change behavior outside of native push.
//
// "plumbing"       -> "Plumbing"
// "pratap nagar"   -> "Pratap Nagar"
// "AC repair"      -> "Ac Repair"  (acronyms get flattened; acceptable for now)
// ""               -> "" (caller decides fallback)
export function titleCase(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Phase 4B: provider-facing matched-job push. The eventType maps 1:1 to the
// future "new_service_requests" preference toggle so preference filtering
// can short-circuit fan-out by eventType once preferences ship.
export type NewServiceRequestPayloadInput = {
  taskId: string;
  // `unknown` so callers can pass a raw `task.display_id` (typed as unknown
  // out of Supabase) without an extra narrow. The helper string-coerces.
  displayId?: unknown;
  category: string;
  area: string;
  workTag?: string | null;
  matchTier?: string | null;
};

function coerceToStringField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function newServiceRequestPayload(
  input: NewServiceRequestPayloadInput
): PushDataPayload {
  const category = titleCase(input.category);
  const area = titleCase(input.area);
  const bodyCategory = category || "Service";
  const bodyArea = area || "your area";

  // All values MUST be strings — FCM `data` is Map<string,string>.
  const payload: PushDataPayload = {
    title: "New service request",
    body: `${bodyCategory} request in ${bodyArea}`,
    deepLink: "/provider/my-jobs",
    eventType: "new_service_request",
    sentAt: new Date().toISOString(),
    taskId: String(input.taskId ?? "").trim(),
    displayId: coerceToStringField(input.displayId),
    category: String(input.category ?? "").trim(),
    area: String(input.area ?? "").trim(),
    workTag: String(input.workTag ?? "").trim(),
    matchTier: String(input.matchTier ?? "").trim(),
  };
  return payload;
}

// Phase 7B: admin platform announcement payload. eventType='general' is
// the mandatory category — recipients cannot opt out via notification
// preferences. The Android wrapper opens `deepLink` on tap; empty
// string is acceptable and yields no navigation.
//
// All values MUST be strings (FCM data is Map<string,string>); the
// helper coerces nullable inputs to empty strings rather than omitting
// them so payload keys stay stable across announcements.
export type AnnouncementPayloadInput = {
  announcementId: string;
  title: string;
  body: string;
  deepLink?: string | null;
  audience: string;
  // Phase 7C: present in the FCM data map only when the broadcast
  // targets a single category. Empty string for every other audience
  // so the data map shape stays stable (FCM requires Map<string,string>;
  // omitting the key would still satisfy that, but stable shapes
  // simplify Android-side parsing).
  targetCategory?: string | null;
};

// Provider chat-reply push. Fired when a customer replies in a chat thread
// (in lockstep with the existing provider_notifications 'chat_message' feed
// row + its unseen-per-thread dedupe). Title/body are PII-free — no customer
// name / phone / message text; the body carries only the task label
// (e.g. "Kaam No. 123"). deepLink lands on the shared chat thread route so
// the service worker opens the exact conversation on tap. Data-only (FCM
// `data` is Map<string,string>) — sw.js renders the notification.
export type ChatMessagePayloadInput = {
  threadId: string;
  taskLabel: string;
};

export function chatMessagePayload(
  input: ChatMessagePayloadInput
): PushDataPayload {
  const threadId = String(input.threadId ?? "").trim();
  const taskLabel = String(input.taskLabel ?? "").trim() || "your job";
  return {
    title: "Customer replied",
    body: `Customer replied on ${taskLabel}.`,
    deepLink: `/chat/thread/${encodeURIComponent(threadId)}`,
    eventType: "chat_message",
    sentAt: new Date().toISOString(),
    threadId,
  };
}

export function announcementPayload(
  input: AnnouncementPayloadInput
): PushDataPayload {
  return {
    title: String(input.title ?? "").trim(),
    body: String(input.body ?? "").trim(),
    deepLink: String(input.deepLink ?? "").trim(),
    eventType: "general",
    sentAt: new Date().toISOString(),
    announcementId: String(input.announcementId ?? "").trim(),
    audience: String(input.audience ?? "").trim(),
    targetCategory: String(input.targetCategory ?? "").trim(),
  };
}

// Phase 3.1: payload for the post-activation push. NOT yet sent by any
// route — added here so the Phase 3.2 activation worker can import a
// stable builder rather than constructing the payload inline.
//
// `planCode` is the internal code ("free" / "regions_5" / "all_jodhpur");
// `planLabel` is the provider-facing display ("Free plan" / "₹31 plan" /
// "₹101 plan"). Caller resolves both so wording stays consistent with
// the dashboard banner copy. `regionCount` is included as a string for
// FCM (data values must be strings); 0 is a valid value for the free
// activation edge case where the provider had no provider_areas rows.
//
// deepLink lands the provider on the dashboard so they can verify the
// new plan state immediately. The dashboard refetch picks up the new
// active plan from /api/provider/dashboard-profile on mount.
export type PlanActivatedPayloadInput = {
  planCode: string;
  planLabel: string;
  regionCount: number;
  activatedAt: string;
};

export function planActivatedPayload(
  input: PlanActivatedPayloadInput
): PushDataPayload {
  const planCode = String(input.planCode ?? "").trim();
  const planLabel = String(input.planLabel ?? "").trim();
  const isFree = planCode === "free";
  const title = isFree
    ? "You're now on the Free plan"
    : "Your new plan is now active";
  const body = isFree
    ? "Your Free plan started. Tap to manage your region."
    : `Your ${planLabel || "new"} plan started. Tap to see updates.`;

  return {
    title,
    body,
    deepLink: "/provider/dashboard",
    eventType: "plan_activated",
    sentAt: new Date().toISOString(),
    planCode,
    planLabel,
    regionCount: String(Math.max(0, Math.trunc(input.regionCount ?? 0))),
    activatedAt: String(input.activatedAt ?? "").trim(),
  };
}
