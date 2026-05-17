// Notification preferences — shared backend helper (Phase 1).
//
// Contract:
//   - Absence of a row in notification_preferences ⇒ ENABLED.
//   - event_type='general' is ALWAYS enabled. Trying to disable it is
//     rejected by setPreferences(), and the DB trigger
//     trg_notif_prefs_general_always_enabled is the canonical gate.
//   - Lookup failures fail OPEN (allow the push) and log a warning, so a
//     transient Supabase error never silently kills production sends. This
//     matches the soft-fail philosophy of the existing push fan-out in
//     /api/process-task-notifications.
//
// This module is NOT wired into the production push fan-out yet. Phase 2
// will add the call in process-task-notifications/route.ts.

import { adminSupabase } from "@/lib/supabase/admin";

export type ActorType = "user" | "provider" | "admin";

// Mirror of push_logs.event_type CHECK (see migration
// 20260518120000_notification_preferences.sql). 'job_matched' is omitted
// from the catalogue because it is legacy-only (kept in the CHECK for
// historical rows, not for new preference toggles).
export type NotificationEventType =
  | "general"
  | "job_match"
  | "chat_message"
  | "task_update"
  | "admin_alert"
  | "marketing"
  | "new_category"
  | "need_post"
  | "system"
  | "test"
  | "new_service_request";

export type EventTypeMeta = {
  eventType: NotificationEventType;
  label: string;
  description: string;
  // Which actor types this event is meaningful for. The preferences UI
  // uses this to decide which toggle rows to render per surface.
  actors: ReadonlyArray<ActorType>;
  // 'general' is mandatory — UI renders it locked, backend rejects any
  // attempt to disable it. No other event_type uses this flag today.
  mandatory?: boolean;
};

// Single source of truth for which events are toggleable on each surface.
// Keep label/description short — they render directly in the preferences
// card. Adding a new event: add a row here, expand the type union above,
// and add the value to the push_logs CHECK migration.
export const EVENT_TYPE_CATALOGUE: ReadonlyArray<EventTypeMeta> = [
  {
    eventType: "general",
    label: "General Notifications",
    description: "Important account and service updates. Cannot be turned off.",
    actors: ["user", "provider", "admin"],
    mandatory: true,
  },
  {
    eventType: "new_service_request",
    label: "New Service Requests",
    description: "Sent to providers when a matching customer request comes in.",
    actors: ["provider", "admin"],
  },
  {
    eventType: "job_match",
    label: "Job Match Updates",
    description: "Status updates on jobs that were matched to you.",
    actors: ["provider"],
  },
  {
    eventType: "chat_message",
    label: "Chat Messages",
    description: "Alerts when you receive a new message in a chat.",
    actors: ["user", "provider", "admin"],
  },
  {
    eventType: "task_update",
    label: "Task Updates",
    description: "Updates on tasks you have created.",
    actors: ["user", "admin"],
  },
  {
    eventType: "new_category",
    label: "New Service Categories",
    description: "When new service categories are added on Kaun Karega.",
    actors: ["provider", "admin"],
  },
  {
    eventType: "need_post",
    label: "Jodhpur Ko Chahiye Posts",
    description: "Alerts for new posts in the Jodhpur ko chahiye feed.",
    actors: ["user", "admin"],
  },
  {
    eventType: "admin_alert",
    label: "Admin Alerts",
    description: "Operational alerts and system events for admins.",
    actors: ["admin"],
  },
  {
    eventType: "marketing",
    label: "Marketing & Promotions",
    description: "Occasional offers and feature announcements.",
    actors: ["user", "provider", "admin"],
  },
  {
    eventType: "system",
    label: "System Notifications",
    description: "Maintenance, downtime, and platform-level notices.",
    actors: ["user", "provider", "admin"],
  },
];

const EVENT_TYPE_SET: ReadonlySet<NotificationEventType> = new Set(
  EVENT_TYPE_CATALOGUE.map((meta) => meta.eventType)
);

export function isKnownEventType(value: unknown): value is NotificationEventType {
  return typeof value === "string" && EVENT_TYPE_SET.has(value as NotificationEventType);
}

export function getCatalogueForActor(
  actorType: ActorType
): ReadonlyArray<EventTypeMeta> {
  return EVENT_TYPE_CATALOGUE.filter((meta) => meta.actors.includes(actorType));
}

// Resolved preference snapshot for one actor. Keys cover every event in
// the catalogue that applies to this actor; values are the effective
// enabled state (defaults applied, 'general' forced true).
export type PreferenceSnapshot = Record<NotificationEventType, boolean>;

function normalizeActorKey(actorType: ActorType, actorKey: string): string {
  const trimmed = String(actorKey ?? "").trim();
  if (!trimmed) return "";
  // Providers use their provider_id verbatim. User/admin keys are phone
  // numbers — canonicalize to "91XXXXXXXXXX" so a row keyed by "91…"
  // matches a lookup that started from a "+91-…" or raw 10-digit string.
  if (actorType === "provider") return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10) return `91${digits.slice(-10)}`;
  return "";
}

function defaultSnapshotForActor(actorType: ActorType): PreferenceSnapshot {
  const snapshot = {} as PreferenceSnapshot;
  for (const meta of EVENT_TYPE_CATALOGUE) {
    if (!meta.actors.includes(actorType)) continue;
    snapshot[meta.eventType] = true;
  }
  return snapshot;
}

type PrefRow = {
  event_type: unknown;
  enabled: unknown;
};

export type GetPreferencesResult = {
  ok: true;
  snapshot: PreferenceSnapshot;
};

// Reads every stored opt-out for this actor and returns a fully-populated
// snapshot (defaults applied for missing rows). 'general' is always true
// in the returned snapshot regardless of any stale row, so even a
// corrupted DB row can never block a general send through this helper.
export async function getPreferences(
  actorType: ActorType,
  actorKey: string
): Promise<GetPreferencesResult> {
  const snapshot = defaultSnapshotForActor(actorType);
  const key = normalizeActorKey(actorType, actorKey);
  if (!key) {
    return { ok: true, snapshot };
  }

  const { data, error } = await adminSupabase
    .from("notification_preferences")
    .select("event_type, enabled")
    .eq("actor_type", actorType)
    .eq("actor_key", key);

  if (error) {
    console.warn("[notificationPreferences] getPreferences lookup failed", {
      actorType,
      code: error.code,
      message: error.message,
    });
    // Fail open — return defaults.
    return { ok: true, snapshot };
  }

  for (const row of (data ?? []) as PrefRow[]) {
    const eventType = String(row.event_type ?? "");
    if (!isKnownEventType(eventType)) continue;
    if (!(eventType in snapshot)) continue; // not applicable to this actor
    snapshot[eventType] = Boolean(row.enabled);
  }

  // Hard guarantee: 'general' is always on, even if a corrupted row says
  // otherwise. The DB trigger blocks the disable; this is defense in depth.
  if ("general" in snapshot) {
    snapshot.general = true;
  }
  return { ok: true, snapshot };
}

export type PreferenceUpdate = {
  eventType: NotificationEventType;
  enabled: boolean;
};

export type SetPreferencesResult =
  | { ok: true; snapshot: PreferenceSnapshot }
  | { ok: false; error: string; code: "INVALID_EVENT" | "GENERAL_LOCKED" | "INVALID_ACTOR_KEY" | "DB_ERROR" };

export type SetPreferencesOptions = {
  updatedBy?: string | null;
  updatedSource?: string | null;
};

// Upserts the given updates and returns the fresh snapshot. Rejects any
// attempt to disable 'general' before touching the DB; the trigger will
// reject it too if this layer is somehow bypassed.
export async function setPreferences(
  actorType: ActorType,
  actorKey: string,
  updates: ReadonlyArray<PreferenceUpdate>,
  options: SetPreferencesOptions = {}
): Promise<SetPreferencesResult> {
  const key = normalizeActorKey(actorType, actorKey);
  if (!key) {
    return { ok: false, code: "INVALID_ACTOR_KEY", error: "actor_key is required" };
  }

  for (const update of updates) {
    if (!isKnownEventType(update.eventType)) {
      return {
        ok: false,
        code: "INVALID_EVENT",
        error: `Unknown event_type: ${String(update.eventType)}`,
      };
    }
    if (update.eventType === "general" && update.enabled === false) {
      return {
        ok: false,
        code: "GENERAL_LOCKED",
        error: "general notifications cannot be disabled",
      };
    }
    // Drop updates for events that don't apply to this actor. Silently
    // ignored so a UI bug can't write nonsense rows; the API layer can
    // also pre-filter using getCatalogueForActor.
    const meta = EVENT_TYPE_CATALOGUE.find((m) => m.eventType === update.eventType);
    if (!meta || !meta.actors.includes(actorType)) {
      return {
        ok: false,
        code: "INVALID_EVENT",
        error: `event_type ${update.eventType} is not applicable to ${actorType}`,
      };
    }
  }

  if (updates.length === 0) {
    // Nothing to write — just return the current snapshot.
    const current = await getPreferences(actorType, actorKey);
    return { ok: true, snapshot: current.snapshot };
  }

  const now = new Date().toISOString();
  const rows = updates.map((u) => ({
    actor_type: actorType,
    actor_key: key,
    event_type: u.eventType,
    enabled: u.enabled,
    updated_at: now,
    updated_by: options.updatedBy ?? null,
    updated_source: options.updatedSource ?? null,
  }));

  const { error } = await adminSupabase
    .from("notification_preferences")
    .upsert(rows, { onConflict: "actor_type,actor_key,event_type" });

  if (error) {
    console.error("[notificationPreferences] setPreferences upsert failed", {
      actorType,
      code: error.code,
      message: error.message,
    });
    return { ok: false, code: "DB_ERROR", error: error.message };
  }

  const refreshed = await getPreferences(actorType, actorKey);
  return { ok: true, snapshot: refreshed.snapshot };
}

// Single-actor allow check. Always returns true for 'general'. Fails OPEN
// on lookup error — callers (push fan-out) MUST NOT block on this helper.
export async function isPushAllowed(
  actorType: ActorType,
  actorKey: string,
  eventType: NotificationEventType
): Promise<boolean> {
  if (eventType === "general") return true;
  if (!isKnownEventType(eventType)) return true; // unknown events are not gated
  const { snapshot } = await getPreferences(actorType, actorKey);
  // Default to enabled when the event isn't in this actor's catalogue —
  // the gate should never be the reason a send is dropped.
  if (!(eventType in snapshot)) return true;
  return snapshot[eventType];
}

// Bulk filter for provider fan-out. Returns the subset of provider_ids
// whose owners have NOT disabled this event_type. Always returns the
// full input set for 'general'. Fails OPEN on lookup error so a Supabase
// hiccup never silently breaks the matched-service push.
export async function filterProviderIdsByPreference(
  providerIds: ReadonlyArray<string>,
  eventType: NotificationEventType
): Promise<{ allowed: Set<string>; failedOpen: boolean }> {
  const cleaned = Array.from(
    new Set(
      providerIds
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );
  const allAllowed = new Set(cleaned);

  if (cleaned.length === 0) {
    return { allowed: allAllowed, failedOpen: false };
  }
  if (eventType === "general") {
    return { allowed: allAllowed, failedOpen: false };
  }
  if (!isKnownEventType(eventType)) {
    return { allowed: allAllowed, failedOpen: false };
  }

  const { data, error } = await adminSupabase
    .from("notification_preferences")
    .select("actor_key, enabled")
    .eq("actor_type", "provider")
    .eq("event_type", eventType)
    .in("actor_key", cleaned);

  if (error) {
    console.warn(
      "[notificationPreferences] filterProviderIdsByPreference failed open",
      {
        eventType,
        providerCount: cleaned.length,
        code: error.code,
        message: error.message,
      }
    );
    return { allowed: allAllowed, failedOpen: true };
  }

  const disabled = new Set<string>();
  for (const row of (data ?? []) as { actor_key: unknown; enabled: unknown }[]) {
    if (row.enabled === false) {
      const key = String(row.actor_key ?? "").trim();
      if (key) disabled.add(key);
    }
  }

  if (disabled.size === 0) {
    return { allowed: allAllowed, failedOpen: false };
  }

  const allowed = new Set<string>();
  for (const id of cleaned) {
    if (!disabled.has(id)) allowed.add(id);
  }
  return { allowed, failedOpen: false };
}
