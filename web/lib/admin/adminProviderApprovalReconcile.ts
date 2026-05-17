/**
 * Provider approval status reconciliation.
 *
 * Symptom this exists to fix: provider registers with one or more
 * custom items (custom category, custom alias, off-region area).
 * `providers.status` is set to 'pending' at registration. The four
 * approve/reject endpoints (approve_category_request,
 * reject_category_request, /api/admin/aliases approve|reject,
 * admin_resolve_unmapped_area, admin_map_unmapped_area) all mutate
 * their target queue table correctly, but none of them reconciles
 * providers.status back to 'active' when the provider's LAST open
 * queue item clears.
 *
 * Result before this fix: admin Under Review tile correctly drops
 * the provider (it queries queues, not providers.status). But the
 * provider dashboard reads providers.status -> derives
 * PendingApproval='yes' -> renders "Pending Admin Approval"
 * banner forever; isProviderVerified() returns false; admin
 * provider list shows status="Pending" forever.
 *
 * Fix: call reconcileProviderApprovalStatus(providerId) at the tail
 * of each successful approve/reject. This helper is idempotent,
 * fail-soft, and never mutates providers.verified.
 *
 * Design decisions:
 *   - Rejected-only-item also flips status to 'active'. Reason:
 *     keeping the provider account usable; only that specific
 *     request was rejected, not the provider as a whole.
 *   - duplicate_name_review_status='pending' is excluded — that
 *     lifecycle is owned by the duplicate-name helpers in
 *     adminProviderMutations.ts. We never race them.
 *   - The UPDATE is guarded by `status='pending'` in the WHERE
 *     clause, so concurrent reconcile calls collapse safely:
 *     either the row is still pending (one wins, others no-op)
 *     or it's already active (all become no-ops).
 *   - Failure of the helper is non-fatal. The original mutation
 *     has already succeeded; reconcile failures are logged but
 *     never bubble up to the admin response.
 */

import { adminSupabase } from "../supabase/admin";

const AREA_REVIEW_SOURCE_TYPES = ["provider_register", "provider_update"];

export type ReconcileResult =
  | { ok: true; changed: boolean; reason?: string }
  | { ok: false; error: string };

export async function reconcileProviderApprovalStatus(
  providerId: string
): Promise<ReconcileResult> {
  const pid = String(providerId || "").trim();
  if (!pid) return { ok: true, changed: false, reason: "empty_provider_id" };

  try {
    // 1. Load the provider row. Need status and duplicate_name_review_status
    //    to make the decision. Missing row -> no-op.
    const { data: providerRow, error: providerErr } = await adminSupabase
      .from("providers")
      .select("provider_id, status, duplicate_name_review_status")
      .eq("provider_id", pid)
      .maybeSingle();

    if (providerErr) {
      return { ok: false, error: providerErr.message };
    }
    if (!providerRow) {
      return { ok: true, changed: false, reason: "provider_not_found" };
    }

    const status = String(providerRow.status || "").trim().toLowerCase();
    if (status !== "pending") {
      // Already active / rejected / blocked — nothing to do.
      return { ok: true, changed: false, reason: "not_pending" };
    }

    const dupReviewStatus = String(
      providerRow.duplicate_name_review_status || ""
    )
      .trim()
      .toLowerCase();
    if (dupReviewStatus === "pending") {
      // Duplicate-name flow owns this provider's lifecycle.
      // Do not race it.
      return { ok: true, changed: false, reason: "duplicate_name_pending" };
    }

    // 2. Three count queries — each scoped to this provider only.
    //    head-only counts to keep the round-trip cheap. Limit=1 is
    //    sufficient for "is there at least one open item".
    const [catReqRes, aliasRes, areaRes] = await Promise.all([
      adminSupabase
        .from("pending_category_requests")
        .select("request_id", { count: "exact", head: true })
        .eq("provider_id", pid)
        .eq("status", "pending"),
      adminSupabase
        .from("category_aliases")
        .select("alias", { count: "exact", head: true })
        .eq("submitted_by_provider_id", pid)
        .eq("active", false),
      adminSupabase
        .from("area_review_queue")
        .select("review_id", { count: "exact", head: true })
        .eq("source_ref", pid)
        .eq("status", "pending")
        .in("source_type", AREA_REVIEW_SOURCE_TYPES),
    ]);

    if (catReqRes.error) return { ok: false, error: catReqRes.error.message };
    if (aliasRes.error) return { ok: false, error: aliasRes.error.message };
    if (areaRes.error) return { ok: false, error: areaRes.error.message };

    const openTotal =
      (catReqRes.count ?? 0) + (aliasRes.count ?? 0) + (areaRes.count ?? 0);

    if (openTotal > 0) {
      return { ok: true, changed: false, reason: "items_still_open" };
    }

    // 3. Flip status='active'. Guarded by status='pending' in the
    //    WHERE so concurrent reconciles collapse safely.
    //    Do NOT touch verified.
    const { error: updateErr, count: updatedCount } = await adminSupabase
      .from("providers")
      .update({ status: "active" }, { count: "exact" })
      .eq("provider_id", pid)
      .eq("status", "pending");

    if (updateErr) return { ok: false, error: updateErr.message };

    return {
      ok: true,
      changed: (updatedCount ?? 0) > 0,
      reason: (updatedCount ?? 0) > 0 ? "flipped_to_active" : "race_lost",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Convenience wrapper for fire-and-log usage at the tail of mutation
 * handlers. Never throws, never bubbles. Logs failures so they're
 * visible in Vercel logs but allows the parent response to proceed.
 */
export async function reconcileProviderApprovalStatusSoft(
  providerId: string | null | undefined,
  callSite: string
): Promise<void> {
  if (!providerId) return;
  const result = await reconcileProviderApprovalStatus(String(providerId));
  if (!result.ok) {
    console.warn(
      `[reconcileProviderApprovalStatus] ${callSite} failed:`,
      result.error
    );
  } else if (result.changed) {
    console.log(
      `[reconcileProviderApprovalStatus] ${callSite} flipped provider ${providerId} to active`
    );
  }
}
