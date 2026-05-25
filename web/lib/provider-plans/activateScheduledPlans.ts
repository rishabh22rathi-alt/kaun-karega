import { adminSupabase } from "@/lib/supabase/admin";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";
import { planActivatedPayload } from "@/lib/push/payloads";
import { sendPlanActivatedPush } from "@/lib/push/sendToProvider";

/**
 * Shared activation runner for scheduled provider plans.
 *
 * Originally lived inline in /api/cron/activate-scheduled-plans (Phase
 * 3.2B). Extracted in Phase 3.2C because we're on Vercel Hobby (no
 * frequent cron support) and need an admin-triggered button as the
 * primary activation surface. Both call sites — the bearer-auth cron
 * route and the admin-cookie-auth manual route — delegate here so the
 * activation behaviour is identical regardless of trigger.
 *
 * What this runner does:
 *   1. Scans provider_plans for rows whose scheduled_activates_at is
 *      due, ORDER BY scheduled_activates_at ASC (longest-overdue first).
 *   2. Per provider, with bounded concurrency, calls the
 *      public.activate_scheduled_plan() RPC from Phase 3.1. The RPC
 *      owns the activation transaction (SELECT FOR UPDATE SKIP LOCKED)
 *      so overlapping runners are safe.
 *   3. On success: resolves post-activation city_code, invalidates
 *      admin snapshot caches, sends a plan_activated push (best-effort),
 *      writes a scheduled_plan_activations audit row with push_status.
 *   4. On skipped / failed: writes a scheduled_plan_activations row
 *      with the error_code and continues — one provider's failure
 *      never stops the batch.
 *
 * What this runner does NOT do:
 *   - Mutate provider_plans / provider_areas / provider_scheduled_areas
 *     directly. Only the RPC mutates plan/region state.
 *   - Touch payment_orders.status. That's the webhook's contract.
 *   - Check the KK_SCHEDULED_PLANS_ENABLED flag. Per business rule:
 *     intake is gated by the flag; fulfillment honours already-queued
 *     contracts regardless of the flag's current state.
 *   - Throw on per-row failures. Every error is caught, audited, and
 *     surfaced in the returned `failures` array.
 *
 * The runner never throws at the batch level either — top-level
 * exceptions (e.g. the scan query fails) are caught and surfaced via
 * the returned `scanError` field so HTTP routes can render a friendly
 * error rather than 500ing.
 */

const BATCH_LIMIT = 500;
const CONCURRENCY = 5;

export type ActivationFailure = {
  provider_id: string;
  outcome: "skipped" | "failed";
  error_code: string | null;
  error_message: string | null;
};

export type ActivationBatchResult = {
  ok: boolean;
  scanned: number;
  activated: number;
  skipped: number;
  failed: number;
  failures: ActivationFailure[];
  // Populated only when the top-level due-row scan itself failed.
  // When set, scanned/activated/skipped/failed are all 0.
  scanError?: { code: string; message: string };
};

type DuePlanRow = {
  provider_id: string;
  scheduled_plan_code: string | null;
  scheduled_activates_at: string | null;
};

type RpcResult = {
  ok?: boolean;
  outcome?: string;
  error_code?: string;
  error_message?: string;
  activated_plan_code?: string | null;
  region_count?: number | null;
  scheduled_payment_order_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

// Provider-facing labels for the plan_activated push. Mirrors the
// PLAN_SHORT_LABEL map in ProviderPlanCard so the push copy matches
// the dashboard banner copy.
function labelForPlanCode(code: string | null | undefined): string {
  switch (String(code ?? "")) {
    case "free":
      return "Free plan";
    case "regions_5":
      return "₹31 plan";
    case "all_jodhpur":
      return "₹101 plan";
    default:
      return "new plan";
  }
}

async function resolveProviderCity(
  providerId: string
): Promise<string | null> {
  const { data, error } = await adminSupabase
    .from("provider_areas")
    .select("city_code")
    .eq("provider_id", providerId)
    .not("city_code", "is", null)
    .limit(1);
  if (error) {
    console.warn(
      "[activateScheduledPlans] city lookup failed",
      { providerId, message: error.message }
    );
    return null;
  }
  const code = String(data?.[0]?.city_code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

async function invalidatePostActivationCaches(
  cityCode: string | null
): Promise<void> {
  // Same key set used by /api/provider/update — keeps the invalidation
  // contract consistent across active-set mutations. area_stats.{city}
  // is appended only when we have a valid city. provider_plan_growth
  // is added here so the admin Plan Growth dashboard (Provider Plan
  // Growth tab) refreshes after every successful activation —
  // applies to both the admin manual trigger and the bearer-auth cron.
  const keys: string[] = [
    "provider_plan_growth",
    "provider_stats",
    "provider_stats.by_category",
    "provider_stats.by_category.verified",
  ];
  if (cityCode) {
    keys.push(`area_stats.${cityCode}`);
  }
  try {
    await invalidateSnapshots(keys);
  } catch (err) {
    console.warn(
      "[activateScheduledPlans] snapshot invalidation threw (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }
}

async function writeActivationAudit(
  providerId: string,
  args: {
    outcome: "success" | "skipped" | "failed";
    activatedPlanCode?: string | null;
    scheduledPaymentOrderId?: string | null;
    regionCount?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    pushStatus?: string | null;
  }
): Promise<void> {
  const { error } = await adminSupabase
    .from("scheduled_plan_activations")
    .insert({
      provider_id: providerId,
      outcome: args.outcome,
      activated_plan_code: args.activatedPlanCode ?? null,
      scheduled_payment_order_id: args.scheduledPaymentOrderId ?? null,
      region_count: args.regionCount ?? null,
      error_code: args.errorCode ?? null,
      error_message: args.errorMessage ?? null,
      push_status: args.pushStatus ?? null,
    });
  if (error) {
    // Audit write failure must NOT throw — activation already
    // committed; losing the audit row is a regrettable but recoverable
    // outcome. The next runner invocation will not see this row even
    // if it succeeds because the activation already cleared
    // scheduled_*; this is purely an admin-visibility gap.
    console.warn(
      "[activateScheduledPlans] audit insert failed (non-fatal)",
      { providerId, message: error.message }
    );
  }
}

type ProcessOutcome = "success" | "skipped" | "failed";

async function processProvider(
  providerId: string
): Promise<{ outcome: ProcessOutcome; failure?: ActivationFailure }> {
  let rpcResult: RpcResult | null = null;
  try {
    const { data, error } = await adminSupabase.rpc(
      "activate_scheduled_plan",
      { p_provider_id: providerId }
    );
    if (error) {
      console.error(
        "[activateScheduledPlans] rpc returned error",
        { providerId, code: error.code, message: error.message }
      );
      await writeActivationAudit(providerId, {
        outcome: "failed",
        errorCode: "RPC_ERROR",
        errorMessage: error.message,
      });
      return {
        outcome: "failed",
        failure: {
          provider_id: providerId,
          outcome: "failed",
          error_code: "RPC_ERROR",
          error_message: error.message,
        },
      };
    }
    rpcResult = (data ?? null) as RpcResult | null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[activateScheduledPlans] rpc threw",
      { providerId, message }
    );
    await writeActivationAudit(providerId, {
      outcome: "failed",
      errorCode: "RPC_THREW",
      errorMessage: message,
    });
    return {
      outcome: "failed",
      failure: {
        provider_id: providerId,
        outcome: "failed",
        error_code: "RPC_THREW",
        error_message: message,
      },
    };
  }

  if (!rpcResult || typeof rpcResult !== "object") {
    await writeActivationAudit(providerId, {
      outcome: "failed",
      errorCode: "RPC_MALFORMED_RESPONSE",
    });
    return {
      outcome: "failed",
      failure: {
        provider_id: providerId,
        outcome: "failed",
        error_code: "RPC_MALFORMED_RESPONSE",
        error_message: null,
      },
    };
  }

  const outcome = String(rpcResult.outcome ?? "");

  if (outcome === "skipped") {
    await writeActivationAudit(providerId, {
      outcome: "skipped",
      errorCode: rpcResult.error_code ?? "NOT_DUE_OR_LOCKED",
      errorMessage: rpcResult.error_message ?? null,
    });
    return {
      outcome: "skipped",
      failure: {
        provider_id: providerId,
        outcome: "skipped",
        error_code: rpcResult.error_code ?? "NOT_DUE_OR_LOCKED",
        error_message: rpcResult.error_message ?? null,
      },
    };
  }

  if (outcome === "failed") {
    await writeActivationAudit(providerId, {
      outcome: "failed",
      activatedPlanCode: rpcResult.activated_plan_code ?? null,
      scheduledPaymentOrderId: rpcResult.scheduled_payment_order_id ?? null,
      regionCount: rpcResult.region_count ?? null,
      errorCode: rpcResult.error_code ?? "RPC_REFUSED",
      errorMessage: rpcResult.error_message ?? null,
    });
    return {
      outcome: "failed",
      failure: {
        provider_id: providerId,
        outcome: "failed",
        error_code: rpcResult.error_code ?? "RPC_REFUSED",
        error_message: rpcResult.error_message ?? null,
      },
    };
  }

  if (outcome !== "success") {
    await writeActivationAudit(providerId, {
      outcome: "failed",
      errorCode: "RPC_UNKNOWN_OUTCOME",
      errorMessage: outcome || null,
    });
    return {
      outcome: "failed",
      failure: {
        provider_id: providerId,
        outcome: "failed",
        error_code: "RPC_UNKNOWN_OUTCOME",
        error_message: outcome || null,
      },
    };
  }

  // ── Success path ────────────────────────────────────────────────
  const activatedPlanCode = String(rpcResult.activated_plan_code ?? "");
  const regionCount = Number.isFinite(rpcResult.region_count)
    ? Number(rpcResult.region_count)
    : 0;
  const scheduledPaymentOrderId =
    rpcResult.scheduled_payment_order_id ?? null;
  const periodStart = String(rpcResult.period_start ?? "");

  let cityCode: string | null = null;
  try {
    cityCode = await resolveProviderCity(providerId);
  } catch (err) {
    console.warn(
      "[activateScheduledPlans] city resolution threw (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }
  await invalidatePostActivationCaches(cityCode);

  let pushStatus: string = "skipped";
  try {
    const payload = planActivatedPayload({
      planCode: activatedPlanCode,
      planLabel: labelForPlanCode(activatedPlanCode),
      regionCount,
      activatedAt: periodStart || new Date().toISOString(),
    });
    const sendResult = await sendPlanActivatedPush(providerId, payload);
    pushStatus = sendResult.status;
  } catch (err) {
    console.error(
      "[activateScheduledPlans] sendPlanActivatedPush threw",
      { providerId, message: err instanceof Error ? err.message : err }
    );
    pushStatus = "failed";
  }

  await writeActivationAudit(providerId, {
    outcome: "success",
    activatedPlanCode,
    scheduledPaymentOrderId,
    regionCount,
    pushStatus,
  });

  return { outcome: "success" };
}

// Bounded-concurrency map over due provider IDs. Each worker pulls
// from a shared queue (the providerIds array via index). Reliability >
// throughput: 5 in flight is plenty for activation work.
async function runWithConcurrency(providerIds: string[]): Promise<{
  activated: number;
  skipped: number;
  failed: number;
  failures: ActivationFailure[];
}> {
  let activated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: ActivationFailure[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= providerIds.length) return;
      const id = providerIds[i]!;
      const result = await processProvider(id);
      if (result.outcome === "success") {
        activated += 1;
      } else if (result.outcome === "skipped") {
        skipped += 1;
        if (result.failure) failures.push(result.failure);
      } else {
        failed += 1;
        if (result.failure) failures.push(result.failure);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, providerIds.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { activated, skipped, failed, failures };
}

/**
 * Entry point. Scans + activates + audits + pushes. Never throws.
 * Returns a structured summary suitable for HTTP responses.
 */
export async function runScheduledPlanActivations(): Promise<ActivationBatchResult> {
  const { data: dueRows, error: scanError } = await adminSupabase
    .from("provider_plans")
    .select("provider_id, scheduled_plan_code, scheduled_activates_at")
    .not("scheduled_plan_code", "is", null)
    .lte("scheduled_activates_at", new Date().toISOString())
    .order("scheduled_activates_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (scanError) {
    console.error(
      "[activateScheduledPlans] due-row scan failed",
      { code: scanError.code, message: scanError.message }
    );
    return {
      ok: false,
      scanned: 0,
      activated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      scanError: {
        code: "SCAN_FAILED",
        message: scanError.message,
      },
    };
  }

  const rows = (dueRows ?? []) as DuePlanRow[];
  const providerIds = rows
    .map((r) => String(r.provider_id ?? "").trim())
    .filter((id) => id.length > 0);

  if (providerIds.length === 0) {
    return {
      ok: true,
      scanned: 0,
      activated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
  }

  const { activated, skipped, failed, failures } = await runWithConcurrency(
    providerIds
  );

  return {
    ok: true,
    scanned: providerIds.length,
    activated,
    skipped,
    failed,
    failures,
  };
}
