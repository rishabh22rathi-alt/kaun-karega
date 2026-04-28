/**
 * Backend-native category mutation helpers.
 *
 * Tables used:
 *   - pending_category_requests  — status + audit fields (request lifecycle)
 *   - categories                 — insert on approve; add/edit/toggle for direct management
 *
 * All public functions never throw — they return { ok: false, error } on failure.
 */

import { adminSupabase } from "../supabase/admin";

export type CategoryMutationResult =
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Internal: write admin audit fields to a pending_category_requests row
// ---------------------------------------------------------------------------

async function updateRequestStatus(
  requestId: string,
  status: string,
  adminActionBy: string,
  adminActionReason: string
): Promise<CategoryMutationResult> {
  // pending_category_requests has BOTH `id` (Supabase auto-uuid PK) and
  // `request_id` ("PCR-…" string set at insert time). The frontend derives
  // RequestID via `row.id ?? row.request_id`, so it usually sends the UUID
  // — match on `id` first, then fall back to `request_id` for any caller
  // (current or legacy) that sends the PCR string. Without the fallback
  // the UPDATE silently matched 0 rows and the buttons appeared to do nothing.
  const payload = {
    status,
    admin_action_by: adminActionBy || null,
    admin_action_at: new Date().toISOString(),
    admin_action_reason: adminActionReason || null,
  };

  const byId = await adminSupabase
    .from("pending_category_requests")
    .update(payload)
    .eq("id", requestId)
    .select("id");

  if (!byId.error && Array.isArray(byId.data) && byId.data.length > 0) {
    return { ok: true };
  }

  // First attempt either errored on type mismatch (id is uuid-typed and
  // requestId was a "PCR-…" string) or matched zero rows. Try request_id.
  const byReqId = await adminSupabase
    .from("pending_category_requests")
    .update(payload)
    .eq("request_id", requestId)
    .select("request_id");

  if (byReqId.error) {
    return { ok: false, error: byReqId.error.message };
  }
  if (Array.isArray(byReqId.data) && byReqId.data.length > 0) {
    return { ok: true };
  }

  // Neither column matched — surface this as a hard failure so the
  // dashboard's catch shows a real banner instead of the previous silent
  // "ok:true" that left the row unchanged.
  return {
    ok: false,
    error: `Pending category request not found (id/request_id="${requestId}")`,
  };
}

// ---------------------------------------------------------------------------
// Approve — updates request row AND ensures category exists
// ---------------------------------------------------------------------------

/**
 * Approve a category request.
 *
 * Steps:
 *   1. Upsert the category into `categories` (ignoreDuplicates = true so
 *      re-approvals of the same category name are safe).
 *   2. Update `pending_category_requests.status = "approved"` + audit fields.
 */
export async function approveCategoryRequest(
  requestId: string,
  categoryName: string,
  adminActorName: string,
  adminActorPhone: string,
  adminActionReason: string
): Promise<CategoryMutationResult> {
  try {
    if (!requestId || !categoryName) {
      return { ok: false, error: "requestId and categoryName are required" };
    }

    const adminActionBy = adminActorName || adminActorPhone || null;

    // Insert category; skip silently if the name already exists.
    const { error: catError } = await adminSupabase
      .from("categories")
      .upsert(
        { name: categoryName, active: true },
        { onConflict: "name", ignoreDuplicates: true }
      );

    if (catError) return { ok: false, error: catError.message };

    return updateRequestStatus(requestId, "approved", adminActionBy ?? "", adminActionReason);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Reject / close / archive / soft-delete — only update the request row
// ---------------------------------------------------------------------------

export async function rejectCategoryRequest(
  requestId: string,
  reason: string,
  adminActorName: string,
  adminActorPhone: string
): Promise<CategoryMutationResult> {
  try {
    if (!requestId) return { ok: false, error: "requestId is required" };
    const adminActionBy = adminActorName || adminActorPhone || null;
    return updateRequestStatus(requestId, "rejected", adminActionBy ?? "", reason);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function closeCategoryRequest(
  requestId: string,
  reason: string,
  adminActorName: string,
  adminActorPhone: string
): Promise<CategoryMutationResult> {
  try {
    if (!requestId) return { ok: false, error: "requestId is required" };
    const adminActionBy = adminActorName || adminActorPhone || null;
    return updateRequestStatus(requestId, "closed", adminActionBy ?? "", reason);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function archiveCategoryRequest(
  requestId: string,
  reason: string,
  adminActorName: string,
  adminActorPhone: string
): Promise<CategoryMutationResult> {
  try {
    if (!requestId) return { ok: false, error: "requestId is required" };
    const adminActionBy = adminActorName || adminActorPhone || null;
    return updateRequestStatus(requestId, "archived", adminActionBy ?? "", reason);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function softDeleteCategoryRequest(
  requestId: string,
  reason: string,
  adminActorName: string,
  adminActorPhone: string
): Promise<CategoryMutationResult> {
  try {
    if (!requestId) return { ok: false, error: "requestId is required" };
    const adminActionBy = adminActorName || adminActorPhone || null;
    return updateRequestStatus(requestId, "deleted_by_admin", adminActionBy ?? "", reason);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Direct category management — add / edit / toggle
// ---------------------------------------------------------------------------

/**
 * Add a new category. Silently ignores duplicates (same behaviour as approve).
 * Payload: { action: "add_category", categoryName }
 */
export async function addCategory(
  categoryName: string
): Promise<CategoryMutationResult> {
  try {
    if (!categoryName) return { ok: false, error: "categoryName is required" };
    const { error } = await adminSupabase
      .from("categories")
      .upsert(
        { name: categoryName, active: true },
        { onConflict: "name", ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Rename a category.
 * Payload: { action: "edit_category", oldName, newName }
 */
export async function editCategory(
  oldName: string,
  newName: string
): Promise<CategoryMutationResult> {
  try {
    if (!oldName || !newName) return { ok: false, error: "oldName and newName are required" };
    const { error } = await adminSupabase
      .from("categories")
      .update({ name: newName })
      .eq("name", oldName);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Enable or disable a category.
 * Payload: { action: "toggle_category", categoryName, active: "yes"|"no" }
 * Stores active as boolean; adminDashboardStats reads it as boolean or "yes"/"no" string.
 */
export async function toggleCategory(
  categoryName: string,
  active: "yes" | "no"
): Promise<CategoryMutationResult> {
  try {
    if (!categoryName) return { ok: false, error: "categoryName is required" };
    const { error } = await adminSupabase
      .from("categories")
      .update({ active: active === "yes" })
      .eq("name", categoryName);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
