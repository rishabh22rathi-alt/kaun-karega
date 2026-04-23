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
