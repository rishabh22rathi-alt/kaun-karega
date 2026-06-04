import { adminSupabase } from "@/lib/supabase/admin";
import { reconcileProviderCoverage } from "@/lib/admin/reconcileProviderCoverage";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";

/**
 * Expired-plan coverage sweep (Launch Blocker 3).
 *
 * Problem this closes: effectivePlan() collapses an expired paid plan to
 * `free` at READ time, but it never mutates the row — and the matching
 * pipeline (find-provider / process-task-notifications) reads
 * provider_areas DIRECTLY with no plan check. So an expired all_jodhpur
 * provider keeps every region row in provider_areas and continues to
 * receive city-wide leads for free until someone prunes those rows. The
 * only pruner, reconcileProviderCoverage(), previously ran only on
 * payment-capture and admin manual rebuild — never on expiry.
 *
 * This runner is the missing expiry trigger. It does NOT contain any new
 * pruning logic: it scans for expired provider_plans rows and delegates
 * each one to the existing, tested reconcileProviderCoverage(providerId),
 * which already collapses an expired plan to `free` and trims
 * provider_areas to the free cap (1 region). Coverage thus becomes the
 * consistent source of truth the matching pipeline already reads — no
 * read-time matching guard is required.
 *
 * Design notes:
 *   - Scope is EXPIRED providers only (current_period_end < now). Active
 *     providers are never touched, keeping the blast radius tight.
 *   - reconcileProviderCoverage is idempotent: a provider already trimmed
 *     to <= cap regions is a no-op, so re-running this sweep is safe and
 *     there is no need for a "reconciled" marker for correctness.
 *   - Per-provider reuse means reconcileProviderCoverage reloads the
 *     region catalog once per provider. Expiry volume is low (30-day
 *     prepaid plans expire in a trickle), so the extra reads are
 *     acceptable; revisit with a batch variant only if volume grows.
 *   - Never throws at the batch level — a scan failure comes back as
 *     `scanError`; a single provider's failure is captured in `failures`
 *     and never aborts the batch.
 *
 * Mirrors the shape of runScheduledPlanActivations() so the bearer-auth
 * cron route and the admin-cookie route can both be thin shells over it
 * ("one behaviour, two triggers").
 */

const BATCH_LIMIT = 500;
const CONCURRENCY = 5;

export type ExpiredCoverageFailure = {
  provider_id: string;
  message: string;
};

export type ExpiredCoverageResult = {
  ok: boolean;
  scanned: number; // expired providers found in this batch
  reconciled: number; // providers processed without error
  fixed: number; // providers whose provider_areas rows were actually trimmed
  failed: number; // providers that errored
  failures: ExpiredCoverageFailure[];
  // Populated only when the top-level expired-row scan itself failed.
  // When set, scanned/reconciled/fixed/failed are all 0.
  scanError?: { code: string; message: string };
};

type ExpiredPlanRow = {
  provider_id: string;
  current_period_end: string | null;
};

type ProviderOutcome = {
  providerId: string;
  fixed: boolean;
  failure?: ExpiredCoverageFailure;
};

async function processProvider(providerId: string): Promise<ProviderOutcome> {
  try {
    const result = await reconcileProviderCoverage(providerId);

    // A per-provider scanError (catalog/plan read failed for this call) is
    // treated as a failure for this provider, not a batch abort.
    if (!result.ok && result.scanError) {
      return {
        providerId,
        fixed: false,
        failure: {
          provider_id: providerId,
          message: `${result.scanError.code}: ${result.scanError.message}`,
        },
      };
    }

    // reconcileProviderCoverage already isolates per-provider errors into
    // its `errors` array. Surface the first one (we pass a single id, so
    // there is at most one).
    if (result.errors.length > 0) {
      return {
        providerId,
        fixed: result.fixed > 0,
        failure: {
          provider_id: providerId,
          message: result.errors[0]!.message,
        },
      };
    }

    return { providerId, fixed: result.fixed > 0 };
  } catch (err) {
    return {
      providerId,
      fixed: false,
      failure: {
        provider_id: providerId,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// Bounded-concurrency map over expired provider IDs. Mirrors the worker
// pool in activateScheduledPlans — reliability over throughput.
async function runWithConcurrency(providerIds: string[]): Promise<{
  reconciled: number;
  fixed: number;
  failed: number;
  failures: ExpiredCoverageFailure[];
}> {
  let reconciled = 0;
  let fixed = 0;
  let failed = 0;
  const failures: ExpiredCoverageFailure[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= providerIds.length) return;
      const id = providerIds[i]!;
      const outcome = await processProvider(id);
      if (outcome.failure) {
        failed += 1;
        failures.push(outcome.failure);
      } else {
        reconciled += 1;
        if (outcome.fixed) fixed += 1;
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, providerIds.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { reconciled, fixed, failed, failures };
}

/**
 * Entry point. Scans expired provider_plans, reconciles each provider's
 * coverage to its (now-free) effective plan, and invalidates the affected
 * admin snapshot caches. Never throws — returns a structured summary
 * suitable for HTTP responses.
 */
export async function runExpiredCoverageReconcile(): Promise<ExpiredCoverageResult> {
  const nowIso = new Date().toISOString();

  const { data: expiredRows, error: scanError } = await adminSupabase
    .from("provider_plans")
    .select("provider_id, current_period_end")
    .not("current_period_end", "is", null)
    .lt("current_period_end", nowIso)
    .order("current_period_end", { ascending: true })
    .limit(BATCH_LIMIT);

  if (scanError) {
    console.error("[reconcileExpiredCoverage] expired-row scan failed", {
      code: scanError.code,
      message: scanError.message,
    });
    return {
      ok: false,
      scanned: 0,
      reconciled: 0,
      fixed: 0,
      failed: 0,
      failures: [],
      scanError: { code: "SCAN_FAILED", message: scanError.message },
    };
  }

  const rows = (expiredRows ?? []) as ExpiredPlanRow[];
  const providerIds = rows
    .map((r) => String(r.provider_id ?? "").trim())
    .filter((id) => id.length > 0);

  if (providerIds.length === 0) {
    return {
      ok: true,
      scanned: 0,
      reconciled: 0,
      fixed: 0,
      failed: 0,
      failures: [],
    };
  }

  const { reconciled, fixed, failed, failures } =
    await runWithConcurrency(providerIds);

  // Coverage changes feed the per-region provider counts and growth board.
  // Soft-fail: a cache miss must never turn a successful sweep into an error.
  if (fixed > 0) {
    try {
      await invalidateSnapshots(["provider_stats", "provider_plan_growth"]);
    } catch (err) {
      console.warn(
        "[reconcileExpiredCoverage] snapshot invalidation failed (non-fatal)",
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    ok: true,
    scanned: providerIds.length,
    reconciled,
    fixed,
    failed,
    failures,
  };
}
