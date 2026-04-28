/**
 * Backend-native admin task mutation helpers.
 *
 * Tables used:
 *   - tasks                 — status updated
 *   - provider_task_matches — assignment recorded by upserting a row with
 *                             match_status="assigned" for (task_id, provider_id)
 *
 * SCHEMA PREREQUISITE — apply web/docs/migrations/add-task-closure-tracking.sql
 * once in Supabase before deploying. It adds:
 *
 *   tasks.closed_at     TIMESTAMPTZ  — when closure happened
 *   tasks.closed_by     TEXT         — "user" | "admin" | "system"
 *   tasks.close_reason  TEXT         — short reason / "user_closed" / "admin_closed" / "expired"
 *
 * READ DIVERGENCE NOTE:
 *   The admin dashboard derives `AssignedProvider` from provider_task_matches
 *   (see lib/admin/adminTaskReads.ts), so an assign here is reflected on the
 *   next dashboard fetch.
 *
 * All public functions never throw — they return { ok: false, error } on failure.
 */

import { adminSupabase } from "../supabase/admin";

export type TaskMutationResult =
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Auto-close timing rules
// ---------------------------------------------------------------------------
// 2-hour "needs admin attention" RED light is computed in
// /api/admin/task-monitor route — this file does NOT close tasks at 2h, by
// design. Auto-closure only fires after AUTO_CLOSE_AFTER_DAYS with no
// progress at all.
const AUTO_CLOSE_AFTER_DAYS = 3;
const AUTO_CLOSE_REASON = "expired_no_progress";
const AUTO_CLOSE_CANDIDATE_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Assign provider to a task
// ---------------------------------------------------------------------------

/**
 * Admin-assign a specific provider to a task.
 *
 * Writes:
 *   provider_task_matches  — row with match_status="assigned" for (taskId, providerId).
 *                            If the pair already exists (most common — created by the
 *                            matching pipeline), its match_status is updated; otherwise
 *                            a new row is inserted.
 *   tasks.status           — set to "assigned"
 */
export async function assignProviderToTask(
  taskId: string,
  providerId: string
): Promise<TaskMutationResult> {
  try {
    if (!taskId || !providerId) {
      return { ok: false, error: "taskId and providerId are required" };
    }

    const { data: existingMatch, error: matchSelectError } = await adminSupabase
      .from("provider_task_matches")
      .select("task_id")
      .eq("task_id", taskId)
      .eq("provider_id", providerId)
      .maybeSingle();

    if (matchSelectError) return { ok: false, error: matchSelectError.message };

    if (existingMatch) {
      const { error: updateMatchError } = await adminSupabase
        .from("provider_task_matches")
        .update({ match_status: "assigned" })
        .eq("task_id", taskId)
        .eq("provider_id", providerId);
      if (updateMatchError) return { ok: false, error: updateMatchError.message };
    } else {
      const { error: insertMatchError } = await adminSupabase
        .from("provider_task_matches")
        .insert({
          task_id: taskId,
          provider_id: providerId,
          match_status: "assigned",
        });
      if (insertMatchError) return { ok: false, error: insertMatchError.message };
    }

    const { error: updateTaskError } = await adminSupabase
      .from("tasks")
      .update({ status: "assigned" })
      .eq("task_id", taskId);

    if (updateTaskError) return { ok: false, error: updateTaskError.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Close a task (user / admin / system)
// ---------------------------------------------------------------------------

/**
 * Source that closed the task. Mirrors the value written to
 * `tasks.closed_by` and is used to pick the default close reason.
 */
export type TaskClosedBy = "user" | "admin" | "system";

const DEFAULT_CLOSE_REASON: Record<TaskClosedBy, string> = {
  user: "user_closed",
  admin: "admin_closed",
  system: "expired",
};

/**
 * Close a task. Single helper used by every closure source so the four
 * closure columns stay consistent regardless of who triggered it.
 *
 * Sets:
 *   tasks.status       = "closed"
 *   tasks.closed_at    = NOW()
 *   tasks.closed_by    = closedBy
 *   tasks.close_reason = reason ?? default for source
 *
 * `closedBy` defaults to "admin" so existing call sites that pass only the
 * taskId continue to behave like the previous admin-only implementation.
 *
 * Schema prerequisite: web/docs/migrations/add-task-closure-tracking.sql.
 */
export async function closeTask(
  taskId: string,
  closedBy: TaskClosedBy = "admin",
  reason?: string
): Promise<TaskMutationResult> {
  try {
    if (!taskId) return { ok: false, error: "taskId is required" };

    const trimmedReason = typeof reason === "string" ? reason.trim() : "";
    const closeReason = trimmedReason || DEFAULT_CLOSE_REASON[closedBy];

    const { error } = await adminSupabase
      .from("tasks")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: closedBy,
        close_reason: closeReason,
      })
      .eq("task_id", taskId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Auto-close expired tasks (system / time-lapse)
// ---------------------------------------------------------------------------

export type AutoCloseResult =
  | { ok: true; closedCount: number; closedTaskIds: string[] }
  | { ok: false; closedCount: number; closedTaskIds: string[]; error: string };

/**
 * Find tasks that have been open for more than AUTO_CLOSE_AFTER_DAYS days
 * with no meaningful progress, and close them via closeTask(taskId,
 * "system", "expired_no_progress"). Idempotent — already-closed tasks are
 * filtered out before the close calls run.
 *
 * "No meaningful progress" means ALL of the following:
 *   - tasks.status NOT IN ("closed", "completed")
 *   - no provider_task_matches row with match_status IN
 *     ("responded", "accepted", "assigned")
 *   - no chat_messages row with sender_type IN ("user", "provider")
 *
 * The 2-hour "needs admin attention" RED light in /api/admin/task-monitor
 * is intentionally separate and never triggers closure here.
 *
 * Bounded at AUTO_CLOSE_CANDIDATE_LIMIT per call. If there are more than
 * that many candidates, the admin can re-trigger this endpoint until the
 * backlog clears.
 *
 * Schema prerequisite: web/docs/migrations/add-task-closure-tracking.sql.
 */
export async function autoCloseExpiredTasks(): Promise<AutoCloseResult> {
  try {
    const cutoffMs = Date.now() - AUTO_CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    // Fetch open + old candidates. We post-filter status in JS so NULL
    // values and any future status casing are handled defensively without
    // depending on PostgREST not-in syntax.
    const { data: taskRows, error: tasksError } = await adminSupabase
      .from("tasks")
      .select("task_id, status")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(AUTO_CLOSE_CANDIDATE_LIMIT);

    if (tasksError) {
      return {
        ok: false,
        closedCount: 0,
        closedTaskIds: [],
        error: tasksError.message,
      };
    }

    const candidateIds = (taskRows ?? [])
      .filter((row) => {
        const s = String(row.status ?? "").trim().toLowerCase();
        return s !== "closed" && s !== "completed";
      })
      .map((row) => String(row.task_id ?? "").trim())
      .filter((id) => id.length > 0);

    if (candidateIds.length === 0) {
      return { ok: true, closedCount: 0, closedTaskIds: [] };
    }

    // Pull the two progress signals in parallel.
    const [progressedMatchesRes, chatMessagesRes] = await Promise.all([
      adminSupabase
        .from("provider_task_matches")
        .select("task_id")
        .in("task_id", candidateIds)
        .in("match_status", ["responded", "accepted", "assigned"]),
      adminSupabase
        .from("chat_messages")
        .select("task_id")
        .in("task_id", candidateIds)
        .in("sender_type", ["user", "provider"]),
    ]);

    if (progressedMatchesRes.error) {
      return {
        ok: false,
        closedCount: 0,
        closedTaskIds: [],
        error: progressedMatchesRes.error.message,
      };
    }
    if (chatMessagesRes.error) {
      return {
        ok: false,
        closedCount: 0,
        closedTaskIds: [],
        error: chatMessagesRes.error.message,
      };
    }

    const progressedTaskIds = new Set<string>();
    for (const row of progressedMatchesRes.data ?? []) {
      const id = String(row.task_id ?? "").trim();
      if (id) progressedTaskIds.add(id);
    }
    for (const row of chatMessagesRes.data ?? []) {
      const id = String(row.task_id ?? "").trim();
      if (id) progressedTaskIds.add(id);
    }

    const toCloseIds = candidateIds.filter((id) => !progressedTaskIds.has(id));
    if (toCloseIds.length === 0) {
      return { ok: true, closedCount: 0, closedTaskIds: [] };
    }

    const closedTaskIds: string[] = [];
    for (const taskId of toCloseIds) {
      const result = await closeTask(taskId, "system", AUTO_CLOSE_REASON);
      if (result.ok) {
        closedTaskIds.push(taskId);
      } else {
        console.error(
          "[admin/auto-close-tasks] closeTask failed",
          { taskId, error: result.error }
        );
      }
    }

    return {
      ok: true,
      closedCount: closedTaskIds.length,
      closedTaskIds,
    };
  } catch (err) {
    return {
      ok: false,
      closedCount: 0,
      closedTaskIds: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
