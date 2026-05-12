/**
 * Backend-native category mutation helpers.
 *
 * Tables used:
 *   - pending_category_requests  — status + audit fields (request lifecycle)
 *   - categories                 — insert on approve; add/edit/toggle for direct management
 *   - provider_notifications     — bell rows fired on approve/reject of a request
 *
 * All public functions never throw — they return { ok: false, error } on failure.
 */

import { adminSupabase } from "../supabase/admin";

// ---------------------------------------------------------------------------
// Notification helper — fan out to the requesting provider.
// ---------------------------------------------------------------------------

type RequestRowSlim = {
  provider_id: string | null;
  requested_category: string | null;
};

/**
 * Look up provider_id + requested_category for the request row identified by
 * either UUID `id` or the "PCR-…" `request_id` string. Mirrors the dual-key
 * lookup `updateRequestStatus` does so the notification ties to the exact
 * row we just mutated.
 */
async function fetchRequestRow(
  requestId: string
): Promise<RequestRowSlim | null> {
  const byId = await adminSupabase
    .from("pending_category_requests")
    .select("provider_id, requested_category")
    .eq("id", requestId)
    .maybeSingle();
  if (!byId.error && byId.data) return byId.data as RequestRowSlim;

  const byReqId = await adminSupabase
    .from("pending_category_requests")
    .select("provider_id, requested_category")
    .eq("request_id", requestId)
    .maybeSingle();
  if (!byReqId.error && byReqId.data) return byReqId.data as RequestRowSlim;

  return null;
}

/**
 * Insert a single provider_notifications row. Soft-fail: errors are logged
 * but never bubble back to the caller — the approve/reject mutation has
 * already succeeded and a missing notification is recoverable but not
 * blocking.
 */
async function notifyProviderOfCategoryDecision(params: {
  providerId: string;
  type: "category_request_approved" | "category_request_rejected";
  requestedCategory: string;
  reason?: string;
}): Promise<void> {
  if (!params.providerId || !params.requestedCategory) return;
  const isApproved = params.type === "category_request_approved";
  const row = {
    provider_id: params.providerId,
    type: params.type,
    title: isApproved
      ? "Service category approved"
      : "Service category not approved",
    message: isApproved
      ? `Your requested service category "${params.requestedCategory}" has been approved.`
      : `Your requested service category "${params.requestedCategory}" was not approved.${
          params.reason ? ` Reason: ${params.reason}` : ""
        }`,
    href: "/provider/dashboard",
    payload_json: {
      requestedCategory: params.requestedCategory,
      reason: params.reason || null,
    },
  };
  const { error } = await adminSupabase
    .from("provider_notifications")
    .insert(row);
  if (error) {
    console.error(
      "[adminCategoryMutations] notification insert failed",
      error.message
    );
  }
}

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
 *   3. Insert provider_services row for the requesting provider so the
 *      approved category surfaces under "Active Approved Service Category"
 *      on the next dashboard load. Registration and edit flows
 *      intentionally do NOT pre-create this row for custom categories;
 *      approval is the moment the category becomes a real service for
 *      this provider.
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

    // Pre-read the row so we can notify the submitter after the lifecycle
    // mutation succeeds. Soft-handled below; missing row simply skips the
    // notification (the dashboard's RejectedCategoryRequests / pending
    // section already reflects status changes on next poll).
    const requestRow = await fetchRequestRow(requestId);

    // Insert category; skip silently if the name already exists.
    const { error: catError } = await adminSupabase
      .from("categories")
      .upsert(
        { name: categoryName, active: true },
        { onConflict: "name", ignoreDuplicates: true }
      );

    if (catError) return { ok: false, error: catError.message };

    const statusResult = await updateRequestStatus(
      requestId,
      "approved",
      adminActionBy ?? "",
      adminActionReason
    );
    if (!statusResult.ok) return statusResult;

    // Promote the request into the provider's active services. Soft-fail:
    // if this insert errors, the category lifecycle succeeded and the
    // notification still fires; the provider can re-add the category from
    // the register/edit flow to recover. Use upsert-by-(provider_id,category)
    // semantics via .upsert + ignoreDuplicates so re-approving an old
    // request doesn't violate any unique constraint on the table.
    if (requestRow?.provider_id) {
      const { error: serviceError } = await adminSupabase
        .from("provider_services")
        .upsert(
          {
            provider_id: String(requestRow.provider_id),
            category: categoryName,
          },
          { onConflict: "provider_id,category", ignoreDuplicates: true }
        );
      if (serviceError) {
        console.error(
          "[adminCategoryMutations.approveCategoryRequest] provider_services insert failed",
          serviceError.message
        );
      }
    }

    if (requestRow?.provider_id) {
      await notifyProviderOfCategoryDecision({
        providerId: String(requestRow.provider_id),
        type: "category_request_approved",
        requestedCategory:
          String(requestRow.requested_category || "") || categoryName,
      });
    }
    return { ok: true };
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
    // Pre-read so we can notify after the lifecycle change succeeds.
    const requestRow = await fetchRequestRow(requestId);
    const statusResult = await updateRequestStatus(
      requestId,
      "rejected",
      adminActionBy ?? "",
      reason
    );
    if (!statusResult.ok) return statusResult;
    if (requestRow?.provider_id && requestRow.requested_category) {
      await notifyProviderOfCategoryDecision({
        providerId: String(requestRow.provider_id),
        type: "category_request_rejected",
        requestedCategory: String(requestRow.requested_category),
        reason,
      });
    }
    return { ok: true };
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
 * Result of an `edit_category` rename. On success, surfaces how many
 * downstream rows were re-pointed so the admin UI / audit log can show
 * the propagation.
 */
export type EditCategoryResult =
  | {
      ok: true;
      renamed: { oldName: string; newName: string };
      updatedAliases: number;
      updatedProviderServices: number;
    }
  | { ok: false; error: string; code?: string };

/**
 * Rename an approved category, cascading to every table that stores the
 * category name verbatim.
 *
 * Payload: { action: "edit_category", oldName, newName }
 *
 * Tables touched:
 *   - categories.name                 (the actual rename)
 *   - category_aliases.canonical_category
 *   - provider_services.category
 *
 * Matching rules:
 *   - Both names are trimmed; lookup is case-insensitive so the admin can
 *     fix casing drift ("painter" → "Painter") without seeding a duplicate.
 *   - Cascade reads the as-stored variants first, then updates each by
 *     exact match. Avoids any wildcard surprise from `%` / `_` in a name
 *     and tolerates accidental case drift across rows of the same logical
 *     category.
 *
 * Duplicate guard:
 *   - If `newName` (normalized) already exists as a different categories
 *     row, the rename is refused with code `CATEGORY_NAME_TAKEN`. Without
 *     this guard, aliases and provider_services would silently merge into
 *     the colliding category and the old `categories` row would be left
 *     orphaned.
 */
export async function editCategory(
  oldName: string,
  newName: string
): Promise<EditCategoryResult> {
  try {
    const trimmedOld = String(oldName ?? "").trim();
    const trimmedNew = String(newName ?? "").trim();
    if (!trimmedOld || !trimmedNew) {
      return { ok: false, error: "oldName and newName are required" };
    }

    const oldKey = trimmedOld.toLowerCase();
    const newKey = trimmedNew.toLowerCase();

    // Resolve the existing categories row(s) so we can update by exact
    // stored value. ILIKE without wildcards behaves as case-insensitive
    // equality in PostgREST; we still defensively re-filter in JS to
    // discard any incidental matches (e.g. a name with a literal %).
    const { data: existingRows, error: lookupErr } = await adminSupabase
      .from("categories")
      .select("name")
      .ilike("name", trimmedOld);
    if (lookupErr) return { ok: false, error: lookupErr.message };

    const matchingOldNames = Array.from(
      new Set(
        (existingRows ?? [])
          .map((r) => String(r.name ?? "").trim())
          .filter((name) => name && name.toLowerCase() === oldKey)
      )
    );
    if (matchingOldNames.length === 0) {
      return {
        ok: false,
        error: `Category "${trimmedOld}" not found`,
        code: "CATEGORY_NOT_FOUND",
      };
    }

    // Duplicate guard. Skip when this is a case-only rename — same
    // logical category, just fixing the stored casing.
    if (oldKey !== newKey) {
      const { data: takenRows, error: takenErr } = await adminSupabase
        .from("categories")
        .select("name")
        .ilike("name", trimmedNew);
      if (takenErr) return { ok: false, error: takenErr.message };
      const collisions = (takenRows ?? [])
        .map((r) => String(r.name ?? "").trim())
        .filter((name) => name.toLowerCase() === newKey);
      if (collisions.length > 0) {
        return {
          ok: false,
          error: `Category "${trimmedNew}" already exists`,
          code: "CATEGORY_NAME_TAKEN",
        };
      }
    }

    // 1. Rename categories rows. Update by exact stored name to avoid
    // re-applying the rename to itself in a case-only scenario where the
    // ILIKE pattern would otherwise re-match the freshly renamed row.
    for (const stored of matchingOldNames) {
      const { error: renameErr } = await adminSupabase
        .from("categories")
        .update({ name: trimmedNew })
        .eq("name", stored);
      if (renameErr) {
        return {
          ok: false,
          error: `categories rename failed: ${renameErr.message}`,
        };
      }
    }

    // 2. Cascade to category_aliases.canonical_category. Read the stored
    // variants first so we can update each by exact match without
    // worrying about ILIKE wildcards.
    const { data: aliasVariants, error: aliasReadErr } = await adminSupabase
      .from("category_aliases")
      .select("canonical_category")
      .ilike("canonical_category", trimmedOld);
    if (aliasReadErr) {
      return {
        ok: false,
        error: `category_aliases lookup failed: ${aliasReadErr.message}`,
      };
    }
    const aliasStoredVariants = Array.from(
      new Set(
        (aliasVariants ?? [])
          .map((r) => String(r.canonical_category ?? "").trim())
          .filter((name) => name && name.toLowerCase() === oldKey)
      )
    );
    let updatedAliases = 0;
    for (const stored of aliasStoredVariants) {
      const { data: updatedRows, error: aliasErr } = await adminSupabase
        .from("category_aliases")
        .update({ canonical_category: trimmedNew })
        .eq("canonical_category", stored)
        .select("id");
      if (aliasErr) {
        return {
          ok: false,
          error: `category_aliases rename failed: ${aliasErr.message}`,
        };
      }
      updatedAliases += updatedRows?.length ?? 0;
    }

    // 3. Cascade to provider_services.category. Same read-then-update
    // pattern; provider_services is by far the largest of the three so
    // the .select() return after update is the cheapest way to report
    // accurate counts without a separate count query.
    const { data: psVariants, error: psReadErr } = await adminSupabase
      .from("provider_services")
      .select("category")
      .ilike("category", trimmedOld);
    if (psReadErr) {
      return {
        ok: false,
        error: `provider_services lookup failed: ${psReadErr.message}`,
      };
    }
    const psStoredVariants = Array.from(
      new Set(
        (psVariants ?? [])
          .map((r) => String(r.category ?? "").trim())
          .filter((name) => name && name.toLowerCase() === oldKey)
      )
    );
    let updatedProviderServices = 0;
    for (const stored of psStoredVariants) {
      const { data: updatedRows, error: psErr } = await adminSupabase
        .from("provider_services")
        .update({ category: trimmedNew })
        .eq("category", stored)
        .select("provider_id");
      if (psErr) {
        return {
          ok: false,
          error: `provider_services rename failed: ${psErr.message}`,
        };
      }
      updatedProviderServices += updatedRows?.length ?? 0;
    }

    return {
      ok: true,
      renamed: { oldName: trimmedOld, newName: trimmedNew },
      updatedAliases,
      updatedProviderServices,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
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

// ---------------------------------------------------------------------------
// Archive / restore — soft-removal with snapshot for later review
// ---------------------------------------------------------------------------

export type ArchiveCategoryResult =
  | {
      ok: true;
      archived: {
        categoryName: string;
        providerCount: number;
        aliasCount: number;
        archiveId: string;
      };
    }
  | { ok: false; error: string; code?: string };

export type RestoreCategoryResult =
  | {
      ok: true;
      restored: {
        categoryName: string;
        archiveId: string;
        restoredAliases: number;
      };
    }
  | { ok: false; error: string; code?: string };

export type CategoryArchiveListRow = {
  id: string;
  categoryName: string;
  providerCount: number;
  aliasCount: number;
  archivedBy: string | null;
  archivedAt: string;
  status: string;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewAction: string | null;
};

type ProviderServiceSnapshotRow = {
  provider_id: string | null;
  category: string | null;
};

type AliasSnapshotRow = {
  id: string | null;
  alias: string | null;
  canonical_category: string | null;
  alias_type: string | null;
  active: boolean | null;
  submitted_by_provider_id: string | null;
};

/**
 * Archive a category. Snapshots affected provider_services + aliases
 * into category_archive_reviews, then flips categories.active and
 * category_aliases.active to false for matching rows.
 *
 * Match is case-insensitive (ILIKE without wildcards) so the active
 * flip catches case-drifted variants. Rows in provider_services are
 * intentionally kept — the snapshot exists so a future reviewer can
 * decide whether to delete them.
 */
export async function archiveCategory(
  categoryName: string,
  archivedBy: string,
  adminNote: string
): Promise<ArchiveCategoryResult> {
  try {
    const trimmedName = String(categoryName ?? "").trim();
    if (!trimmedName) {
      return { ok: false, error: "categoryName is required" };
    }
    const nameKey = trimmedName.toLowerCase();

    const { data: catRows, error: catLookupErr } = await adminSupabase
      .from("categories")
      .select("name")
      .ilike("name", trimmedName);
    if (catLookupErr) return { ok: false, error: catLookupErr.message };
    const matchingNames = Array.from(
      new Set(
        (catRows ?? [])
          .map((r) => String(r.name ?? "").trim())
          .filter((n) => n && n.toLowerCase() === nameKey)
      )
    );
    if (matchingNames.length === 0) {
      return {
        ok: false,
        error: `Category "${trimmedName}" not found`,
        code: "CATEGORY_NOT_FOUND",
      };
    }

    const { data: psSnapshot, error: psErr } = await adminSupabase
      .from("provider_services")
      .select("provider_id, category")
      .ilike("category", trimmedName);
    if (psErr) return { ok: false, error: psErr.message };
    const psRows = ((psSnapshot ?? []) as ProviderServiceSnapshotRow[]).filter(
      (r) =>
        String(r.provider_id ?? "").trim() &&
        String(r.category ?? "").trim().toLowerCase() === nameKey
    );
    const distinctProviderIds = new Set(
      psRows.map((r) => String(r.provider_id))
    );

    const { data: aliasSnapshot, error: aliasErr } = await adminSupabase
      .from("category_aliases")
      .select(
        "id, alias, canonical_category, alias_type, active, submitted_by_provider_id"
      )
      .ilike("canonical_category", trimmedName)
      .eq("active", true);
    if (aliasErr) return { ok: false, error: aliasErr.message };
    const aliasRows = ((aliasSnapshot ?? []) as AliasSnapshotRow[]).filter(
      (r) =>
        String(r.canonical_category ?? "").trim().toLowerCase() === nameKey
    );

    // Insert the archive row first. Even if the subsequent flips fail,
    // the audit trail survives — preferable to a half-applied archive
    // with no record.
    const { data: archiveInsert, error: insertErr } = await adminSupabase
      .from("category_archive_reviews")
      .insert({
        category_name: matchingNames[0],
        archived_from_category_id: null,
        provider_count: distinctProviderIds.size,
        alias_count: aliasRows.length,
        provider_service_rows: psRows,
        alias_rows: aliasRows,
        archived_by: archivedBy || null,
        admin_note: adminNote || null,
        status: "archived",
      })
      .select("id")
      .single();
    if (insertErr) return { ok: false, error: insertErr.message };
    const archiveId = String(
      (archiveInsert as { id?: unknown })?.id ?? ""
    );

    for (const stored of matchingNames) {
      const { error: catUpdErr } = await adminSupabase
        .from("categories")
        .update({ active: false })
        .eq("name", stored);
      if (catUpdErr) {
        return {
          ok: false,
          error: `categories deactivation failed: ${catUpdErr.message}`,
        };
      }
    }

    // Flip aliases inactive via exact match on the captured canonicals.
    const aliasCanonicalVariants = Array.from(
      new Set(
        aliasRows
          .map((r) => String(r.canonical_category ?? "").trim())
          .filter(Boolean)
      )
    );
    for (const stored of aliasCanonicalVariants) {
      const { error: aliasUpdErr } = await adminSupabase
        .from("category_aliases")
        .update({ active: false })
        .eq("canonical_category", stored)
        .eq("active", true);
      if (aliasUpdErr) {
        return {
          ok: false,
          error: `category_aliases deactivation failed: ${aliasUpdErr.message}`,
        };
      }
    }

    return {
      ok: true,
      archived: {
        categoryName: matchingNames[0],
        providerCount: distinctProviderIds.size,
        aliasCount: aliasRows.length,
        archiveId,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Restore an archived category. Idempotent guard: re-running on a row
 * that's already 'restored' returns ARCHIVE_NOT_RESTORABLE.
 *
 * Steps:
 *   1. Re-activate (or insert) the categories row.
 *   2. Walk alias_rows snapshot: update by id, fall back to
 *      (alias, canonical_category) ILIKE pair, else re-insert.
 *   3. Stamp the archive row with status='restored' + audit fields.
 *
 * provider_services is intentionally untouched — archive never deleted
 * from it.
 */
export async function restoreCategoryFromArchive(
  archiveId: string,
  reviewedBy: string,
  adminNote: string
): Promise<RestoreCategoryResult> {
  try {
    const id = String(archiveId ?? "").trim();
    if (!id) return { ok: false, error: "archiveId is required" };

    const { data: archiveRow, error: archiveErr } = await adminSupabase
      .from("category_archive_reviews")
      .select("id, category_name, alias_rows, status")
      .eq("id", id)
      .maybeSingle();
    if (archiveErr) return { ok: false, error: archiveErr.message };
    if (!archiveRow) {
      return {
        ok: false,
        error: "Archive review row not found",
        code: "ARCHIVE_NOT_FOUND",
      };
    }
    const archiveStatus = String(
      (archiveRow as { status?: unknown }).status ?? ""
    ).toLowerCase();
    if (archiveStatus !== "archived") {
      return {
        ok: false,
        error: `Archive already ${archiveStatus || "resolved"}`,
        code: "ARCHIVE_NOT_RESTORABLE",
      };
    }
    const categoryName = String(
      (archiveRow as { category_name?: unknown }).category_name ?? ""
    ).trim();
    if (!categoryName) {
      return { ok: false, error: "Archive row has no category_name" };
    }
    const nameKey = categoryName.toLowerCase();

    const { data: existingCatRows, error: catLookupErr } = await adminSupabase
      .from("categories")
      .select("name")
      .ilike("name", categoryName);
    if (catLookupErr) return { ok: false, error: catLookupErr.message };
    const matchingNames = Array.from(
      new Set(
        (existingCatRows ?? [])
          .map((r) => String(r.name ?? "").trim())
          .filter((n) => n && n.toLowerCase() === nameKey)
      )
    );
    if (matchingNames.length > 0) {
      for (const stored of matchingNames) {
        const { error: catUpdErr } = await adminSupabase
          .from("categories")
          .update({ active: true })
          .eq("name", stored);
        if (catUpdErr) {
          return {
            ok: false,
            error: `categories re-activation failed: ${catUpdErr.message}`,
          };
        }
      }
    } else {
      const { error: catInsertErr } = await adminSupabase
        .from("categories")
        .upsert(
          { name: categoryName, active: true },
          { onConflict: "name", ignoreDuplicates: false }
        );
      if (catInsertErr) {
        return {
          ok: false,
          error: `categories re-insert failed: ${catInsertErr.message}`,
        };
      }
    }

    const aliasSnapshot = ((archiveRow as { alias_rows?: unknown })
      .alias_rows ?? []) as AliasSnapshotRow[];
    let restoredAliases = 0;
    for (const snap of aliasSnapshot) {
      const aliasId = String(snap?.id ?? "").trim();
      const aliasText = String(snap?.alias ?? "").trim();
      if (!aliasText) continue;
      const aliasType = String(snap?.alias_type ?? "").trim() || null;
      const submittedBy =
        String(snap?.submitted_by_provider_id ?? "").trim() || null;

      let liveRow: { id: string } | null = null;
      if (aliasId) {
        const byId = await adminSupabase
          .from("category_aliases")
          .select("id")
          .eq("id", aliasId)
          .maybeSingle();
        if (!byId.error && byId.data) {
          liveRow = byId.data as { id: string };
        }
      }
      if (!liveRow) {
        const byPair = await adminSupabase
          .from("category_aliases")
          .select("id")
          .ilike("alias", aliasText)
          .ilike("canonical_category", categoryName)
          .maybeSingle();
        if (!byPair.error && byPair.data) {
          liveRow = byPair.data as { id: string };
        }
      }

      if (liveRow) {
        const { error: aliasUpdErr } = await adminSupabase
          .from("category_aliases")
          .update({
            active: true,
            canonical_category: categoryName,
          })
          .eq("id", liveRow.id);
        if (aliasUpdErr) {
          return {
            ok: false,
            error: `category_aliases restore update failed: ${aliasUpdErr.message}`,
          };
        }
      } else {
        const { error: aliasInsertErr } = await adminSupabase
          .from("category_aliases")
          .insert({
            alias: aliasText,
            canonical_category: categoryName,
            alias_type: aliasType,
            active: true,
            submitted_by_provider_id: submittedBy,
          });
        if (aliasInsertErr) {
          return {
            ok: false,
            error: `category_aliases re-insert failed: ${aliasInsertErr.message}`,
          };
        }
      }
      restoredAliases += 1;
    }

    const { error: stampErr } = await adminSupabase
      .from("category_archive_reviews")
      .update({
        status: "restored",
        reviewed_at: new Date().toISOString(),
        review_action: "restored",
        reviewed_by: reviewedBy || null,
        admin_note: adminNote || null,
      })
      .eq("id", id);
    if (stampErr) {
      return {
        ok: false,
        error: `archive row update failed: ${stampErr.message}`,
      };
    }

    return {
      ok: true,
      restored: {
        categoryName,
        archiveId: id,
        restoredAliases,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * List archive review rows for the Archived Categories tab. Newest-first
 * within the requested status (default 'archived').
 */
export async function listCategoryArchives(
  status: "archived" | "restored" | "all" = "archived"
): Promise<
  | { ok: true; archives: CategoryArchiveListRow[] }
  | { ok: false; error: string }
> {
  try {
    let query = adminSupabase
      .from("category_archive_reviews")
      .select(
        "id, category_name, provider_count, alias_count, archived_by, archived_at, status, admin_note, reviewed_by, reviewed_at, review_action"
      )
      .order("archived_at", { ascending: false })
      .limit(500);
    if (status !== "all") {
      query = query.eq("status", status);
    }
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const archives = ((data ?? []) as Array<Record<string, unknown>>).map(
      (row): CategoryArchiveListRow => ({
        id: String(row.id ?? ""),
        categoryName: String(row.category_name ?? ""),
        providerCount: Number(row.provider_count ?? 0),
        aliasCount: Number(row.alias_count ?? 0),
        archivedBy:
          row.archived_by != null ? String(row.archived_by) : null,
        archivedAt: String(row.archived_at ?? ""),
        status: String(row.status ?? "archived"),
        adminNote: row.admin_note != null ? String(row.admin_note) : null,
        reviewedBy: row.reviewed_by != null ? String(row.reviewed_by) : null,
        reviewedAt:
          row.reviewed_at != null ? String(row.reviewed_at) : null,
        reviewAction:
          row.review_action != null ? String(row.review_action) : null,
      })
    );
    return { ok: true, archives };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Return the lowercased category names that have an active archive
 * (status='archived') so /api/admin/categories can hide them from the
 * Approved list without changing the existing Disable/Enable semantics
 * of categories.active.
 */
export async function getArchivedCategoryKeys(): Promise<Set<string>> {
  const { data, error } = await adminSupabase
    .from("category_archive_reviews")
    .select("category_name")
    .eq("status", "archived")
    .limit(2000);
  if (error) {
    console.error(
      "[adminCategoryMutations.getArchivedCategoryKeys]",
      error.message
    );
    return new Set<string>();
  }
  const keys = new Set<string>();
  for (const row of (data ?? []) as Array<{ category_name?: unknown }>) {
    const key = String(row.category_name ?? "").trim().toLowerCase();
    if (key) keys.add(key);
  }
  return keys;
}
