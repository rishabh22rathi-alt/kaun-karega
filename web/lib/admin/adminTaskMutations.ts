/**
 * Backend-native admin task mutation helpers.
 *
 * Tables used:
 *   - tasks — status + assigned_provider_id updated
 *
 * SCHEMA PREREQUISITE — run once in Supabase SQL editor before deploying:
 *
 *   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_provider_id TEXT;
 *   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
 *
 * READ DIVERGENCE NOTE:
 *   These mutations write to the Supabase `tasks` table only. The admin
 *   dashboard task list (`fetchAdminRequests`) still reads from GAS via
 *   `get_admin_requests`. Until that read is migrated to Supabase, the
 *   dashboard will not reflect these Supabase changes immediately after
 *   the mutation. This is by design for incremental migration — the
 *   Supabase tasks table is authoritative for tasks created via the
 *   submit-request flow; GAS is still authoritative for its own copy.
 *
 * All public functions never throw — they return { ok: false, error } on failure.
 */

import { adminSupabase } from "../supabase/admin";

export type TaskMutationResult =
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Assign provider to a task
// ---------------------------------------------------------------------------

/**
 * Admin-assign a specific provider to a task.
 *
 * Sets:
 *   tasks.assigned_provider_id = providerId
 *   tasks.status               = "assigned"
 *
 * Requires schema column: tasks.assigned_provider_id TEXT
 */
export async function assignProviderToTask(
  taskId: string,
  providerId: string
): Promise<TaskMutationResult> {
  try {
    if (!taskId || !providerId) {
      return { ok: false, error: "taskId and providerId are required" };
    }

    const { error } = await adminSupabase
      .from("tasks")
      .update({
        assigned_provider_id: providerId,
        status: "assigned",
      })
      .eq("task_id", taskId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Close a task (admin)
// ---------------------------------------------------------------------------

/**
 * Admin-close a task.
 *
 * Sets:
 *   tasks.status    = "closed"
 *   tasks.closed_at = NOW()
 *
 * Requires schema column: tasks.closed_at TIMESTAMPTZ
 */
export async function closeTask(taskId: string): Promise<TaskMutationResult> {
  try {
    if (!taskId) return { ok: false, error: "taskId is required" };

    const { error } = await adminSupabase
      .from("tasks")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
      })
      .eq("task_id", taskId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
