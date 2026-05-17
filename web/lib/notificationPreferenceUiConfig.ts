// UI-side toggle config for the notification preferences card. Kept
// separate from lib/notificationPreferences.ts (the catalogue / helper)
// so per-surface presentation choices (label, description, ordering,
// mandatory flag) can evolve without touching the shared backend type
// system. Adding a new toggle is a two-place change:
//   1. lib/notificationPreferences.ts catalogue — for backend
//      validation against `actor.actors.includes(...)`.
//   2. This file — for the toggle that renders on the actor's settings
//      page, plus the route's per-surface allow-list.

import type { NotificationEventType } from "@/lib/notificationPreferences";

export type NotificationPreferenceToggle = {
  eventType: NotificationEventType;
  label: string;
  description: string;
  // 'general' is mandatory — UI renders it locked with a lock badge.
  // Backend (route + helper + DB trigger) also enforces this.
  mandatory?: boolean;
};

// Provider settings page toggles (Phase 3 + 3.5). Order matters — this is
// the render order on /provider/notifications. Wording must match the
// product copy approved in Phase 3.
export const PROVIDER_NOTIFICATION_TOGGLES: ReadonlyArray<NotificationPreferenceToggle> = [
  {
    eventType: "general",
    label: "General Notifications",
    description: "Required system notifications",
    mandatory: true,
  },
  {
    eventType: "job_match",
    label: "New Matched Jobs",
    description:
      "Get a push alert when a customer request matches your services and areas.",
  },
  {
    eventType: "chat_message",
    label: "Chat Messages",
    description: "Get notified when a customer sends you a new message.",
  },
  {
    eventType: "new_category",
    label: "New Categories / Services",
    description: "Heads-up when new service categories are added on Kaun Karega.",
  },
];

// User settings page toggles (Phase 4A). Order matters — render order on
// /dashboard/notifications. Deliberately minimal: only events the user
// can actually receive today. chat_message and need_post are NOT shown
// because no chat-message or need-post push is sent yet; surfacing those
// toggles would create the "I turned it off but I still got it" / "I
// turned it on but I get nothing" mismatch. Add them here when those
// pushes go live.
export const USER_NOTIFICATION_TOGGLES: ReadonlyArray<NotificationPreferenceToggle> = [
  {
    eventType: "general",
    label: "General Notifications",
    description: "Required system notifications",
    mandatory: true,
  },
  {
    eventType: "task_update",
    label: "Task Updates",
    description: "Updates on tasks you have created — provider responses and status changes.",
  },
  {
    eventType: "marketing",
    label: "Marketing & Updates",
    description: "Occasional offers and feature announcements from Kaun Karega.",
  },
];

// Admin settings page toggles (Phase 5A). Order matters — render order on
// /admin/notifications. Deliberately minimal: only events the admin can
// actually receive today. marketing, chat_message, task_update, and
// system are NOT shown because no admin push of those types is sent yet;
// surfacing them would create a settings → behavior mismatch. Add them
// here when the corresponding pushes go live.
export const ADMIN_NOTIFICATION_TOGGLES: ReadonlyArray<NotificationPreferenceToggle> = [
  {
    eventType: "general",
    label: "General Notifications",
    description: "Required system notifications",
    mandatory: true,
  },
  {
    eventType: "admin_alert",
    label: "Admin Alerts",
    description: "Operational alerts and system events for admins.",
  },
  {
    eventType: "new_category",
    label: "New Categories",
    description: "Heads-up when new service categories are added on Kaun Karega.",
  },
];
