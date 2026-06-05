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
const AUTO_CLOSE_AFTER_DAYS = 7;
const AUTO_CLOSE_REASON = "expired_no_progress";
const AUTO_CLOSE_CANDIDATE_LIMIT = 1000;

// Statuses that must never be swept by the stale-close sweep:
//   - terminal: closed / completed / cancelled / expired
//   - awaiting a DIFFERENT workflow: pending_category_review (user requests
//     for an unlisted category awaiting ADMIN approval — they also surface in
//     the Kaam tab; closing them would silently discard demand).
//   - already has a provider response by STATUS: provider_responded /
//     responded / assigned. The match-table check below also guards these,
//     but a task can carry the response status while its provider_task_matches
//     row is inconsistent (e.g. never written as "responded"), so we exclude
//     by status too — honouring "never close provider_responded".
const AUTO_CLOSE_EXCLUDED_STATUSES = new Set([
  "closed",
  "completed",
  "cancelled",
  "canceled",
  "expired",
  "pending_category_review",
  "provider_responded",
  "responded",
  "assigned",
]);

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

// One stale candidate surfaced for the admin preview. Display-only fields
// so the admin can sanity-check what the sweep would close.
export type StaleTaskCandidate = {
  taskId: string;
  displayId: string | null;
  category: string | null;
  createdAt: string | null;
};

export type AutoCloseResult =
  | {
      ok: true;
      dryRun: boolean;
      candidateCount: number;
      candidates: StaleTaskCandidate[];
      closedCount: number;
      closedTaskIds: string[];
    }
  | {
      ok: false;
      dryRun: boolean;
      candidateCount: number;
      candidates: StaleTaskCandidate[];
      closedCount: number;
      closedTaskIds: string[];
      error: string;
    };

/**
 * Find tasks open for more than AUTO_CLOSE_AFTER_DAYS (7) days with no
 * meaningful activity, and (unless dryRun) close them via
 * closeTask(taskId, "system", "expired_no_progress"). Idempotent and bounded
 * at AUTO_CLOSE_CANDIDATE_LIMIT per call.
 *
 * Eligible to close = ALL of:
 *   - created_at older than 7 days
 *   - status NOT IN closed/completed/cancelled/canceled/expired AND NOT
 *     pending_category_review (those await admin category approval)
 *   - no provider_task_matches row with match_status IN
 *     ("responded", "accepted", "assigned")  — no active provider response
 *   - no chat_messages (sender user/provider) in the LAST 7 days  — no
 *     recent conversation. A task whose only chat is older than 7 days is
 *     therefore eligible (the conversation has gone stale).
 *
 * dryRun=true returns the eligible candidates WITHOUT closing anything, so
 * the admin can preview the sweep. The 2-hour "needs admin attention" RED
 * light in /api/admin/task-monitor is separate and never closes tasks here.
 *
 * Schema prerequisite: tasks.closed_at / closed_by / close_reason
 * (supabase/migrations/20260610140000_task_closure_tracking.sql).
 */
export async function autoCloseExpiredTasks(
  options: { dryRun?: boolean } = {}
): Promise<AutoCloseResult> {
  const dryRun = options.dryRun === true;
  const fail = (error: string): AutoCloseResult => ({
    ok: false,
    dryRun,
    candidateCount: 0,
    candidates: [],
    closedCount: 0,
    closedTaskIds: [],
    error,
  });

  try {
    // Single 7-day boundary: tasks created before it (age), AND chat
    // messages on/after it count as "recent activity".
    const cutoffMs = Date.now() - AUTO_CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    // Fetch old candidates. Status is post-filtered in JS so NULL values and
    // any future casing are handled defensively.
    const { data: taskRows, error: tasksError } = await adminSupabase
      .from("tasks")
      .select("task_id, status, display_id, category, created_at")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(AUTO_CLOSE_CANDIDATE_LIMIT);

    if (tasksError) return fail(tasksError.message);

    // Eligible-by-status candidates, keyed for detail lookup.
    const candidateDetail = new Map<string, StaleTaskCandidate>();
    for (const row of taskRows ?? []) {
      const s = String(row.status ?? "").trim().toLowerCase();
      if (AUTO_CLOSE_EXCLUDED_STATUSES.has(s)) continue;
      const id = String(row.task_id ?? "").trim();
      if (!id) continue;
      candidateDetail.set(id, {
        taskId: id,
        displayId:
          row.display_id != null ? String(row.display_id) : null,
        category: row.category != null ? String(row.category) : null,
        createdAt: row.created_at != null ? String(row.created_at) : null,
      });
    }
    const candidateIds = Array.from(candidateDetail.keys());

    if (candidateIds.length === 0) {
      return {
        ok: true,
        dryRun,
        candidateCount: 0,
        candidates: [],
        closedCount: 0,
        closedTaskIds: [],
      };
    }

    // Two progress signals in parallel:
    //   - any active provider response, and
    //   - any chat message in the last 7 days (sender user/provider).
    const [progressedMatchesRes, recentChatRes] = await Promise.all([
      adminSupabase
        .from("provider_task_matches")
        .select("task_id")
        .in("task_id", candidateIds)
        .in("match_status", ["responded", "accepted", "assigned"]),
      adminSupabase
        .from("chat_messages")
        .select("task_id")
        .in("task_id", candidateIds)
        .in("sender_type", ["user", "provider"])
        .gte("created_at", cutoffIso),
    ]);

    if (progressedMatchesRes.error) return fail(progressedMatchesRes.error.message);
    if (recentChatRes.error) return fail(recentChatRes.error.message);

    const progressedTaskIds = new Set<string>();
    for (const row of progressedMatchesRes.data ?? []) {
      const id = String(row.task_id ?? "").trim();
      if (id) progressedTaskIds.add(id);
    }
    for (const row of recentChatRes.data ?? []) {
      const id = String(row.task_id ?? "").trim();
      if (id) progressedTaskIds.add(id);
    }

    const eligibleIds = candidateIds.filter((id) => !progressedTaskIds.has(id));
    const candidates = eligibleIds
      .map((id) => candidateDetail.get(id))
      .filter((c): c is StaleTaskCandidate => Boolean(c));

    // Preview only — never mutate.
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        candidateCount: candidates.length,
        candidates,
        closedCount: 0,
        closedTaskIds: [],
      };
    }

    const closedTaskIds: string[] = [];
    for (const taskId of eligibleIds) {
      const result = await closeTask(taskId, "system", AUTO_CLOSE_REASON);
      if (result.ok) {
        closedTaskIds.push(taskId);
      } else {
        console.error("[admin/auto-close-tasks] closeTask failed", {
          taskId,
          error: result.error,
        });
      }
    }
    if (closedTaskIds.length > 0) {
      console.log(
        `[admin/auto-close-tasks] closed ${closedTaskIds.length} stale task(s): ${closedTaskIds.join(", ")}`
      );
    }

    return {
      ok: true,
      dryRun: false,
      candidateCount: candidates.length,
      candidates,
      closedCount: closedTaskIds.length,
      closedTaskIds,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Unknown error");
  }
}
