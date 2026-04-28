import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// Aggregates the latest tasks with derived traffic-light statuses for the
// admin Task Audit Monitor. All lights are computed from real rows in
// tasks / provider_task_matches / notification_logs / chat_messages —
// no synthetic state.

const TASK_LIMIT = 100;
const RESPONSE_TIMEOUT_HOURS = 2;
const FRESH_TASK_GRACE_MS = 60 * 1000; // status=submitted under 60s → closure GRAY
// Brand-new task with no provider_task_matches rows yet — the matching
// pipeline runs in the same tick as task creation but the row insert can
// land slightly later. Stay GRAY for this window before declaring the
// providersMatched stage RED.
const MATCHING_PIPELINE_GRACE_MS = 30 * 1000;

type Light = "green" | "yellow" | "red" | "gray";

type TaskRow = {
  task_id: string;
  display_id: string | number | null;
  category: string | null;
  area: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: string | null;
  selected_timeframe: string | null;
};

type MatchRow = {
  task_id: string | null;
  provider_id: string | null;
  match_status: string | null;
  created_at: string | null;
};

type NotifRow = {
  task_id: string | null;
  provider_id: string | null;
  status: string | null;
  created_at: string | null;
};

type MsgRow = {
  thread_id: string | null;
  task_id: string | null;
  sender_type: string | null;
  created_at: string | null;
};

type EnrichedTask = {
  taskId: string;
  displayId: string;
  category: string;
  area: string;
  userPhone: string;
  createdAt: string;
  currentStatus: string;
  lights: {
    // Legacy 4-light keys — the existing /admin/task-monitor page binds to
    // these; do not remove or rename.
    notification: Light;
    response: Light;
    userChat: Light;
    closure: Light;
    // Two new explicit lifecycle stages.
    taskPosted: Light;
    providersMatched: Light;
    // Aliases for the new naming convention. Same values as the legacy
    // keys above — let new UI consumers bind to clearer names without
    // forcing the legacy page to migrate.
    providersNotified: Light;
    providerResponded: Light;
    userResponded: Light;
    closed: Light;
  };
  auditTrail: {
    taskCreatedAt: string;
    providersMatched: number;
    notificationsAccepted: number;
    notificationsFailed: number;
    firstProviderResponseAt: string | null;
    firstUserReplyAt: string | null;
    currentStatus: string;
    closedAt: string | null;
    closedBy: string | null;
    closeReason: string | null;
  };
};

function groupByTaskId<T extends { task_id: string | null }>(
  rows: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row.task_id ?? "").trim();
    if (!key) continue;
    const arr = map.get(key) ?? [];
    arr.push(row);
    map.set(key, arr);
  }
  return map;
}

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function ms(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: taskRowsRaw, error: tasksError } = await adminSupabase
    .from("tasks")
    .select(
      // Reads `closed_at`, `closed_by`, `close_reason` for closure-stage
      // diagnostics and the audit-modal closure detail block. Requires the
      // add-task-closure-tracking.sql migration to have been applied.
      "task_id, display_id, category, area, phone, status, created_at, closed_at, closed_by, close_reason, selected_timeframe"
    )
    .order("created_at", { ascending: false })
    .limit(TASK_LIMIT);

  if (tasksError) {
    console.error("[admin/task-monitor] tasks fetch failed", tasksError);
    return NextResponse.json(
      { ok: false, error: tasksError.message || "Failed to fetch tasks" },
      { status: 500 }
    );
  }

  const tasks = (taskRowsRaw ?? []) as TaskRow[];
  const taskIds = tasks
    .map((t) => String(t.task_id ?? "").trim())
    .filter(Boolean);

  if (taskIds.length === 0) {
    return NextResponse.json({ ok: true, tasks: [] });
  }

  const [matchesRes, notifsRes, msgsRes] = await Promise.all([
    adminSupabase
      .from("provider_task_matches")
      .select("task_id, provider_id, match_status, created_at")
      .in("task_id", taskIds),
    adminSupabase
      .from("notification_logs")
      .select("task_id, provider_id, status, created_at")
      .in("task_id", taskIds),
    adminSupabase
      .from("chat_messages")
      .select("thread_id, task_id, sender_type, created_at")
      .in("task_id", taskIds)
      .order("created_at", { ascending: true }),
  ]);

  if (matchesRes.error) {
    console.warn("[admin/task-monitor] matches fetch failed", matchesRes.error);
  }
  if (notifsRes.error) {
    console.warn("[admin/task-monitor] notifications fetch failed", notifsRes.error);
  }
  if (msgsRes.error) {
    console.warn("[admin/task-monitor] chat messages fetch failed", msgsRes.error);
  }

  const matchesByTask = groupByTaskId<MatchRow>((matchesRes.data ?? []) as MatchRow[]);
  const notifsByTask = groupByTaskId<NotifRow>((notifsRes.data ?? []) as NotifRow[]);
  const msgsByTask = groupByTaskId<MsgRow>((msgsRes.data ?? []) as MsgRow[]);

  const now = Date.now();

  const enriched: EnrichedTask[] = tasks.map((task) => {
    const taskId = String(task.task_id ?? "").trim();
    const status = lower(task.status);
    const matches = matchesByTask.get(taskId) ?? [];
    const notifs = notifsByTask.get(taskId) ?? [];
    const msgs = msgsByTask.get(taskId) ?? [];

    const acceptedNotifs = notifs.filter((n) => lower(n.status) === "accepted");
    const errorNotifs = notifs.filter((n) => lower(n.status) === "error");
    const respondedMatches = matches.filter(
      (m) => lower(m.match_status) === "responded"
    );
    const userMessages = msgs.filter((m) => lower(m.sender_type) === "user");
    const providerMessages = msgs.filter(
      (m) => lower(m.sender_type) === "provider"
    );

    const createdAtMs = task.created_at
      ? new Date(task.created_at).getTime()
      : now;
    const ageMs = now - createdAtMs;
    const closedAtMs = task.closed_at
      ? new Date(task.closed_at).getTime()
      : null;
    const isClosed =
      status === "closed" ||
      status === "completed" ||
      closedAtMs !== null;
    const isNoProviders = status === "no_providers_matched";
    const hasProviderResponseSignal =
      respondedMatches.length > 0 ||
      providerMessages.length > 0 ||
      ["provider_responded", "responded", "assigned", "closed", "completed"].includes(
        status
      );

    // Light 1: Provider Notification
    let notification: Light;
    if (matches.length === 0) {
      notification = "red";
    } else if (acceptedNotifs.length > 0) {
      notification = "green";
    } else if (notifs.length === 0) {
      notification = "yellow"; // matched, log row not yet written / pending
    } else if (errorNotifs.length > 0 && acceptedNotifs.length === 0) {
      notification = "red"; // every send attempt errored
    } else {
      notification = "yellow";
    }

    // Light 2: Provider Response
    let response: Light;
    if (notification !== "green") {
      response = "gray";
    } else if (hasProviderResponseSignal) {
      response = "green";
    } else if (ageMs < ms(RESPONSE_TIMEOUT_HOURS)) {
      response = "yellow";
    } else {
      response = "red";
    }

    // Light 3: User Chat
    let userChat: Light;
    const firstProviderMsgAt = providerMessages[0]?.created_at
      ? new Date(providerMessages[0].created_at).getTime()
      : null;
    if (response !== "green") {
      userChat = "gray";
    } else if (userMessages.length > 0) {
      userChat = "green";
    } else if (firstProviderMsgAt !== null) {
      userChat =
        now - firstProviderMsgAt < ms(RESPONSE_TIMEOUT_HOURS) ? "yellow" : "red";
    } else {
      // Provider response detected (status field) but no chat msg yet
      userChat = "yellow";
    }

    // Light 4: Closure
    let closure: Light;
    if (isClosed) {
      closure = "green";
    } else if (isNoProviders || notification === "red" || response === "red") {
      closure = "red";
    } else if (
      status === "submitted" &&
      notifs.length === 0 &&
      ageMs < FRESH_TASK_GRACE_MS
    ) {
      closure = "gray";
    } else {
      closure = "yellow";
    }

    // Light 5 (new): Task Posted — always GREEN once the row exists. Kept
    // explicit so the lifecycle UI can render a complete stage strip.
    const taskPosted: Light = "green";

    // Light 6 (new): Providers Matched — separates "matching pipeline ran
    // and found candidates" from "WhatsApp went out", which the legacy
    // `notification` light bundled together.
    let providersMatched: Light;
    if (matches.length > 0) {
      providersMatched = "green";
    } else if (status === "no_providers_matched") {
      providersMatched = "red";
    } else if (ageMs < MATCHING_PIPELINE_GRACE_MS) {
      providersMatched = "gray"; // pipeline still running for a brand-new task
    } else {
      providersMatched = "red";
    }

    return {
      taskId,
      displayId: task.display_id != null ? String(task.display_id) : "",
      category: String(task.category ?? ""),
      area: String(task.area ?? ""),
      userPhone: String(task.phone ?? ""),
      createdAt: String(task.created_at ?? ""),
      currentStatus: String(task.status ?? ""),
      lights: {
        // Legacy 4-light keys — unchanged values, kept for the existing page.
        notification,
        response,
        userChat,
        closure,
        // New explicit lifecycle stages.
        taskPosted,
        providersMatched,
        // Aliases under the new naming so future UI doesn't have to
        // reverse-engineer "userChat" → "user responded" etc.
        providersNotified: notification,
        providerResponded: response,
        userResponded: userChat,
        closed: closure,
      },
      auditTrail: {
        taskCreatedAt: String(task.created_at ?? ""),
        providersMatched: matches.length,
        notificationsAccepted: acceptedNotifs.length,
        notificationsFailed: errorNotifs.length,
        firstProviderResponseAt:
          providerMessages[0]?.created_at ?? null,
        firstUserReplyAt: userMessages[0]?.created_at ?? null,
        currentStatus: String(task.status ?? ""),
        closedAt: task.closed_at ?? null,
        closedBy: task.closed_by ?? null,
        closeReason: task.close_reason ?? null,
      },
    };
  });

  return NextResponse.json({ ok: true, tasks: enriched });
}
