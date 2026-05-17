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
