/**
 * Backend-native provider mutation helpers.
 *
 * Covers: verify/approve/reject (set_provider_verified) and block/unblock.
 * Source of truth: Supabase `providers` table via service-role client.
 *
 * Phone format notes do not apply here — mutations are keyed on provider_id.
 */

import { adminSupabase } from "../supabase/admin";

export type ProviderMutationResult =
  | { ok: true }
  | { ok: false; error: string };

export type ProviderBlockResult =
  | { status: string }
  | null;

// ---------------------------------------------------------------------------
// Verify / approve / reject
// ---------------------------------------------------------------------------

/**
 * Set a provider's verified flag.
 *
 * CONTRACT:
 *   - verified = "yes": sets verified = "yes" AND status = "active"
 *     (clears any pending-approval state)
 *   - verified = "no": sets verified = "no"; if status was "pending",
 *     also sets status = "rejected" so the pending-approval flag clears
 *   - Never throws — returns { ok: false, error } on any failure
 */
export async function setProviderVerified(
  providerId: string,
  verified: "yes" | "no"
): Promise<ProviderMutationResult> {
  try {
    if (verified === "yes") {
      const { error } = await adminSupabase
        .from("providers")
        .update({ verified: "yes", status: "active" })
        .eq("provider_id", providerId);
      if (error) return { ok: false, error: error.message };
    } else {
      const [{ error: verifyError }] = await Promise.all([
        adminSupabase
          .from("providers")
          .update({ verified: "no" })
          .eq("provider_id", providerId),
        // Only transitions pending → rejected; active/blocked rows are untouched
        adminSupabase
          .from("providers")
          .update({ status: "rejected" })
          .eq("provider_id", providerId)
          .eq("status", "pending"),
      ]);
      if (verifyError) return { ok: false, error: verifyError.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Block / unblock
// ---------------------------------------------------------------------------

/**
 * Set a provider's blocked status.
 *
 * Returns { status: "Blocked" | "Active" } on success — matching the shape
 * the provider profile page expects from the legacy GAS response.
 * Returns null on any error.
 */
export async function setProviderBlockStatus(
  providerId: string,
  blocked: boolean
): Promise<ProviderBlockResult> {
  try {
    const newStatus = blocked ? "Blocked" : "Active";
    const { error } = await adminSupabase
      .from("providers")
      .update({ status: newStatus })
      .eq("provider_id", providerId);
    if (error) return null;
    return { status: newStatus };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Duplicate-name review admin actions
// ---------------------------------------------------------------------------

type DuplicateNameAdminContext = {
  adminActorPhone?: string;
  reason?: string;
};

/**
 * Approve a duplicate-name-flagged provider.
 * Effect: status=active, verified=yes, duplicate_name_review_status=cleared.
 */
export async function approveDuplicateNameReview(
  providerId: string,
  ctx: DuplicateNameAdminContext = {}
): Promise<ProviderMutationResult> {
  try {
    const { error } = await adminSupabase
      .from("providers")
      .update({
        status: "active",
        verified: "yes",
        duplicate_name_review_status: "cleared",
        duplicate_name_resolved_at: new Date().toISOString(),
        duplicate_name_admin_phone: ctx.adminActorPhone || null,
        duplicate_name_reason: null,
      })
      .eq("provider_id", providerId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Mark a duplicate-name-flagged provider as a legitimate separate person.
 * Effect: status=active, verified=yes, duplicate_name_review_status=separate.
 */
export async function markDuplicateNameLegitSeparate(
  providerId: string,
  ctx: DuplicateNameAdminContext = {}
): Promise<ProviderMutationResult> {
  try {
    const { error } = await adminSupabase
      .from("providers")
      .update({
        status: "active",
        verified: "yes",
        duplicate_name_review_status: "separate",
        duplicate_name_resolved_at: new Date().toISOString(),
        duplicate_name_admin_phone: ctx.adminActorPhone || null,
        duplicate_name_reason: null,
      })
      .eq("provider_id", providerId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Reject a duplicate-name-flagged provider.
 * Effect: status=Blocked (per existing block helper), verified=no,
 * duplicate_name_review_status=rejected.
 */
export async function rejectDuplicateNameProvider(
  providerId: string,
  ctx: DuplicateNameAdminContext = {}
): Promise<ProviderMutationResult> {
  try {
    const { error } = await adminSupabase
      .from("providers")
      .update({
        status: "Blocked",
        verified: "no",
        duplicate_name_review_status: "rejected",
        duplicate_name_resolved_at: new Date().toISOString(),
        duplicate_name_admin_phone: ctx.adminActorPhone || null,
        duplicate_name_reason: ctx.reason || null,
      })
      .eq("provider_id", providerId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * "Keep under review" — no change to status / verified / review_status.
 * Records an admin touch for audit/snooze purposes only.
 */
export async function keepDuplicateNameUnderReview(
  providerId: string,
  ctx: DuplicateNameAdminContext = {}
): Promise<ProviderMutationResult> {
  try {
    const { error } = await adminSupabase
      .from("providers")
      .update({
        duplicate_name_admin_phone: ctx.adminActorPhone || null,
      })
      .eq("provider_id", providerId)
      .eq("duplicate_name_review_status", "pending");
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Category mapping mutations — remove a wrongly-mapped category from a
// provider WITHOUT deleting the provider account / profile / chats / tasks.
// ---------------------------------------------------------------------------

export type RemoveProviderCategoryResult =
  | {
      ok: true;
      removed: {
        providerId: string;
        category: string;
        removedServiceRows: number;
        removedWorkTerms: number;
        remainingCategoryCount: number;
        providerStatusUpdated: boolean;
      };
    }
  | { ok: false; error: string; code?: string };

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Remove a provider's mapping to a specific service category.
 *
 * Touches ONLY:
 *   - provider_services  : delete rows where provider_id+category match.
 *   - provider_work_terms: delete rows where provider_id+canonical_category match.
 *   - providers.status   : flip to "pending" if and only if this was the
 *                          provider's last remaining category service.
 *
 * Untouched on purpose:
 *   - providers row (account stays active aside from the status flip above)
 *   - provider profile / phone / verified flag
 *   - provider_areas
 *   - chats / tasks / notifications / history
 *
 * The category match is case-insensitive (ILIKE without wildcards). All
 * matching as-stored variants of the category are deleted in one pass
 * so case drift doesn't leave orphan rows behind.
 */
export async function removeProviderFromCategory(
  providerId: string,
  category: string
): Promise<RemoveProviderCategoryResult> {
  try {
    const trimmedProvider = String(providerId ?? "").trim();
    const trimmedCategory = String(category ?? "").trim();
    if (!trimmedProvider) {
      return { ok: false, error: "providerId is required" };
    }
    if (!trimmedCategory) {
      return { ok: false, error: "category is required" };
    }
    const categoryKey = normalizeCategoryKey(trimmedCategory);

    // Confirm the provider exists. Surfacing a 404 here keeps the UI
    // from silently optimistically pruning a non-existent provider.
    const { data: providerRow, error: providerLookupErr } = await adminSupabase
      .from("providers")
      .select("provider_id")
      .eq("provider_id", trimmedProvider)
      .maybeSingle();
    if (providerLookupErr) {
      return { ok: false, error: providerLookupErr.message };
    }
    if (!providerRow) {
      return {
        ok: false,
        error: `Provider "${trimmedProvider}" not found`,
        code: "PROVIDER_NOT_FOUND",
      };
    }

    // Resolve the as-stored category variants this provider has so we
    // can delete each by exact match (avoids any ILIKE wildcard
    // surprise in user-controlled strings).
    const { data: providerServiceRows, error: psLookupErr } =
      await adminSupabase
        .from("provider_services")
        .select("category")
        .eq("provider_id", trimmedProvider);
    if (psLookupErr) {
      return { ok: false, error: psLookupErr.message };
    }
    const psRowsBefore = ((providerServiceRows ?? []) as Array<{
      category: string | null;
    }>)
      .map((r) => String(r.category ?? "").trim())
      .filter(Boolean);
    const matchingVariants = Array.from(
      new Set(
        psRowsBefore.filter((c) => c.toLowerCase() === categoryKey)
      )
    );

    let removedServiceRows = 0;
    for (const variant of matchingVariants) {
      const { data: deleted, error: psDelErr } = await adminSupabase
        .from("provider_services")
        .delete()
        .eq("provider_id", trimmedProvider)
        .eq("category", variant)
        .select("provider_id");
      if (psDelErr) {
        return {
          ok: false,
          error: `provider_services delete failed: ${psDelErr.message}`,
        };
      }
      removedServiceRows += deleted?.length ?? 0;
    }

    // Provider had a work-terms chip tied to this canonical? Drop the
    // alias row too — keeping it would surface a chip pointing at a
    // category the provider no longer offers. Soft-failure tolerated:
    // if this delete errors we still report the service-row outcome.
    let removedWorkTerms = 0;
    if (matchingVariants.length > 0) {
      const { data: wtRows, error: wtLookupErr } = await adminSupabase
        .from("provider_work_terms")
        .select("alias, canonical_category")
        .eq("provider_id", trimmedProvider);
      if (wtLookupErr) {
        console.error(
          "[adminProviderMutations.removeProviderFromCategory] work_terms lookup failed",
          wtLookupErr.message
        );
      } else {
        const wtVariants = Array.from(
          new Set(
            ((wtRows ?? []) as Array<{
              canonical_category: string | null;
            }>)
              .map((r) => String(r.canonical_category ?? "").trim())
              .filter((c) => c && c.toLowerCase() === categoryKey)
          )
        );
        for (const variant of wtVariants) {
          const { data: deleted, error: wtDelErr } = await adminSupabase
            .from("provider_work_terms")
            .delete()
            .eq("provider_id", trimmedProvider)
            .eq("canonical_category", variant)
            .select("alias");
          if (wtDelErr) {
            console.error(
              "[adminProviderMutations.removeProviderFromCategory] work_terms delete failed",
              wtDelErr.message
            );
            continue;
          }
          removedWorkTerms += deleted?.length ?? 0;
        }
      }
    }

    // Count remaining provider_services rows for the safety check below.
    const remainingCategoryCount = Math.max(
      0,
      psRowsBefore.length - removedServiceRows
    );

    // If the provider's last category is gone, drop them back to
    // "pending" so the admin pending-providers queue (which keys on
    // status=pending) surfaces them for re-registration. No separate
    // pending_reapproval column exists today — status="pending" is the
    // canonical signal across the codebase.
    let providerStatusUpdated = false;
    if (remainingCategoryCount === 0 && removedServiceRows > 0) {
      const { error: statusErr } = await adminSupabase
        .from("providers")
        .update({ status: "pending" })
        .eq("provider_id", trimmedProvider);
      if (statusErr) {
        console.error(
          "[adminProviderMutations.removeProviderFromCategory] status update failed",
          statusErr.message
        );
      } else {
        providerStatusUpdated = true;
      }
    }

    // Drop a durable bell notification when the provider's last
    // category was removed so they see "Your service category was
    // removed by admin" the next time they open the dashboard. Same
    // soft-fail policy as the alias / category-decision notifications
    // already in this codebase — failure is logged and skipped, never
    // bubbled back to the admin who just did the mutation.
    if (providerStatusUpdated) {
      const { error: notifyErr } = await adminSupabase
        .from("provider_notifications")
        .insert({
          provider_id: trimmedProvider,
          type: "service_category_removed",
          title: "Service category removed",
          message:
            `Your service category${trimmedCategory ? ` "${trimmedCategory}"` : ""} was removed by admin. Please choose a valid category again.`,
          href: "/provider/register?edit=services",
          payload_json: { removedCategory: trimmedCategory },
        });
      if (notifyErr) {
        console.error(
          "[adminProviderMutations.removeProviderFromCategory] notification insert failed",
          notifyErr.message
        );
      }
    }

    return {
      ok: true,
      removed: {
        providerId: trimmedProvider,
        category: trimmedCategory,
        removedServiceRows,
        removedWorkTerms,
        remainingCategoryCount,
        providerStatusUpdated,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
