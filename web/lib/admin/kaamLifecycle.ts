// Pure lifecycle classifier for the Admin Kaam tab.
//
// Evidence sources (mirrors the read patterns already used by
// web/app/api/admin/task-monitor/route.ts so the two surfaces stay in
// agreement about what counts as "responded" / "closed" / etc.):
//
//   - tasks.status             — raw stage string written by the
//                                matching + response pipeline.
//   - tasks.closed_at / closed_by / close_reason
//                              — populated by the closure migration
//                                (web/docs/migrations/add-task-closure-tracking.sql)
//                                whenever a task is closed from any side.
//   - provider_task_matches    — one row per matched provider; the
//                                presence of any row is the "Matched"
//                                signal. A row with match_status="responded"
//                                is treated as Provider Responded.
//   - notification_logs        — a row with status="accepted" is proof
//                                a WhatsApp send made it out.
//   - chat_messages.sender_type — "provider" / "user". A provider-side
//                                message escalates the lifecycle to
//                                Provider Responded; the combination of
//                                provider AND user messages on the same
//                                task escalates further to Completed /
//                                Closed (display only — this function
//                                NEVER mutates a task or chat row).
//
// The function is pure: it makes no DB calls and no side effects. The
// route handler is responsible for fetching the rows and shaping the
// input. This keeps the classifier trivially unit-testable.

export type LifecycleStatus =
  | "Task Created"
  | "Matched"
  | "Providers Notified"
  | "Provider Responded"
  | "Completed / Closed";

// Step number for the lifecycle progress badge in KaamTab. Kept here
// next to the LifecycleStatus union so any new lifecycle stage forces
// both updates at the type level.
export const LIFECYCLE_TOTAL_STEPS = 5 as const;

export const LIFECYCLE_STEP: Record<LifecycleStatus, number> = {
  "Task Created": 1,
  "Matched": 2,
  "Providers Notified": 3,
  "Provider Responded": 4,
  "Completed / Closed": 5,
};

export type LifecycleInput = {
  status: string | null | undefined;
  closedAt: string | null | undefined;
  closedBy: string | null | undefined;
  closeReason: string | null | undefined;
  matchStatuses: Array<string | null | undefined>;
  notificationStatuses: Array<string | null | undefined>;
  chatSenderTypes: Array<string | null | undefined>;
};

function lower(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function hasNonEmpty(value: string | null | undefined): boolean {
  return Boolean(value && String(value).trim());
}

export function computeLifecycleStatus(input: LifecycleInput): LifecycleStatus {
  const status = lower(input.status);
  const matchStatuses = input.matchStatuses.map(lower);
  const notificationStatuses = input.notificationStatuses.map(lower);
  const chatSenderTypes = input.chatSenderTypes.map(lower);

  const hasProviderChat = chatSenderTypes.includes("provider");
  const hasUserChat = chatSenderTypes.includes("user");

  // ────────────────────────────────────────────────────────────────────
  // 1. Completed / Closed
  // Closure beats every other signal — even an explicit raw status of
  // "notified" gets overridden once the task is closed.
  // ────────────────────────────────────────────────────────────────────
  const statusSaysClosed =
    status === "closed" ||
    status === "completed" ||
    status === "cancelled" ||
    status === "canceled";
  const closureColumnsPresent =
    hasNonEmpty(input.closedAt) ||
    hasNonEmpty(input.closedBy) ||
    hasNonEmpty(input.closeReason);
  // Display-only rule from the spec: both sides have spoken on the
  // task's chat → the Kaam is effectively done. We do NOT close the
  // thread or mutate any row to reflect this.
  const bothSidesChatted = hasProviderChat && hasUserChat;

  if (statusSaysClosed || closureColumnsPresent || bothSidesChatted) {
    return "Completed / Closed";
  }

  // ────────────────────────────────────────────────────────────────────
  // 2. Provider Responded
  // ────────────────────────────────────────────────────────────────────
  const statusSaysProviderResponded =
    status === "provider_responded" ||
    status === "responded" ||
    status === "assigned";
  const matchSaysResponded = matchStatuses.includes("responded");
  if (statusSaysProviderResponded || matchSaysResponded || hasProviderChat) {
    return "Provider Responded";
  }

  // ────────────────────────────────────────────────────────────────────
  // 3. Providers Notified
  // Either the raw status flipped to "notified", or notification_logs
  // shows an accepted send, or a match row carries a notification-stage
  // marker. The match-status guard tolerates writer variations like
  // "notified" / "sent".
  // ────────────────────────────────────────────────────────────────────
  const statusSaysNotified = status === "notified";
  const logsSayAccepted = notificationStatuses.includes("accepted");
  const matchSaysNotified =
    matchStatuses.includes("notified") || matchStatuses.includes("sent");
  if (statusSaysNotified || logsSayAccepted || matchSaysNotified) {
    return "Providers Notified";
  }

  // ────────────────────────────────────────────────────────────────────
  // 4. Matched — at least one provider_task_matches row exists.
  // ────────────────────────────────────────────────────────────────────
  if (matchStatuses.length > 0) {
    return "Matched";
  }

  // ────────────────────────────────────────────────────────────────────
  // 5. Task Created — default; the row exists but no downstream
  // evidence has landed yet.
  // ────────────────────────────────────────────────────────────────────
  return "Task Created";
}
