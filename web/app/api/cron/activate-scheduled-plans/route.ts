import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";
import { planActivatedPayload } from "@/lib/push/payloads";
import { sendPlanActivatedPush } from "@/lib/push/sendToProvider";

/**
 * Phase 3.2B — Scheduled plan activation worker.
 *
 * Vercel cron triggers this route every 5 minutes (see vercel.json).
 * The route scans provider_plans for rows whose scheduled_activates_at
 * is due, activates each via the public.activate_scheduled_plan() RPC
 * from Phase 3.1, then performs the side-effects that intentionally
 * live outside the RPC's transaction:
 *
 *   1. Invalidate admin/provider cache snapshots so the next admin
 *      read sees the new active region set.
 *   2. Send a `plan_activated` push to the provider.
 *   3. Insert a scheduled_plan_activations audit row recording
 *      outcome + push_status.
 *
 * Why these side-effects sit outside the RPC:
 *   - Push send is best-effort. A failed FCM call must NOT roll back
 *     the activation transaction (the provider is on their new plan
 *     regardless of whether their device got a notification).
 *   - Cache invalidation is best-effort and naturally non-transactional
 *     (admin_cached_snapshots is a separate DELETE-keyed cache, not
 *     part of the activation read set).
 *   - Audit insert happens last so we can record the push_status that
 *     the cron observed.
 *
 * Auth: HTTP Bearer with the project's CRON_SECRET env var. Constant-
 * time comparison, matches the existing announcement cron pattern at
 * /api/admin/announcements/worker/cron. CRON_SECRET length < 16 →
 * 500 CRON_SECRET_NOT_CONFIGURED (per Phase 3.2B spec); bad/missing
 * bearer → 401 UNAUTHORIZED.
 *
 * Method support: Vercel Cron sends GET by default, manual ops use
 * POST. Both methods share the same handler. The Phase 3.2B spec
 * called out POST; we add GET so the Vercel cron schedule actually
 * fires without a separate trigger.
 *
 * Feature flag: this route does NOT check KK_SCHEDULED_PLANS_ENABLED.
 * Per business rule #10 in the Phase 3.2B spec, scheduled rows must
 * activate even if the intake flag is later turned off — the flag
 * gates new requests, not fulfillment of already-queued ones.
 *
 * Concurrency: bounded at 5 in-flight RPCs at a time. Each RPC takes
 * its own row lock via SELECT FOR UPDATE SKIP LOCKED inside the
 * function body, so overlapping cron ticks are safe even if Vercel
 * happens to launch two invocations.
 *
 * Per-row failure isolation: any single provider's failure (RPC
 * exception, push throw, invalidate throw) is caught, recorded in
 * scheduled_plan_activations, and the batch continues. A 500 from
 * this route would let Vercel retry the entire batch, which is
 * redundant given each row's own lock.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Per-tick scan cap. Each activation hits the RPC + ~2 cache writes +
// 1 push send + 1 audit insert; 500 fits in Vercel's 60s budget with
// concurrency 5. If the queue ever sustains > 500 due rows, the
// activated count on each tick stays at 500 and the rest carry to the
// next tick — no row is lost.
const BATCH_LIMIT = 500;
const CONCURRENCY = 5;
const MIN_SECRET_LENGTH = 16;

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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

type ActivationFailure = {
  provider_id: string;
  outcome: "skipped" | "failed";
  error_code: string | null;
  error_message: string | null;
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

async function authorize(request: Request): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected.length < MIN_SECRET_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET_NOT_CONFIGURED",
        message:
          "CRON_SECRET env is not set or is too short on this deployment.",
      },
      { status: 500 }
    );
  }
  const provided = request.headers.get("authorization") ?? "";
  if (!timingSafeEq(provided, `Bearer ${expected}`)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }
  return null;
}

// Resolve the post-activation city_code so the area_stats.{city}
// snapshot can be invalidated targeted-ly. Mirrors the provider/update
// pattern (first non-null city_code from provider_areas). If no rows
// exist (e.g. Free activation on a provider with zero areas), the
// generic provider_stats keys are still invalidated; the
// area_stats.{city} key is skipped because we have no city to target.
async function resolveProviderCity(providerId: string): Promise<string | null> {
  const { data, error } = await adminSupabase
    .from("provider_areas")
    .select("city_code")
    .eq("provider_id", providerId)
    .not("city_code", "is", null)
    .limit(1);
  if (error) {
    console.warn(
      "[cron/activate-scheduled-plans] city lookup failed",
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
  // is appended only when we have a valid city.
  const keys: string[] = [
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
      "[cron/activate-scheduled-plans] snapshot invalidation threw (non-fatal)",
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
    // outcome. The next cron tick's read will not see this row even
    // if it succeeds because the activation already cleared
    // scheduled_*; this is purely an admin-visibility gap.
    console.warn(
      "[cron/activate-scheduled-plans] audit insert failed (non-fatal)",
      { providerId, message: error.message }
    );
  }
}

type ProcessOutcome = "success" | "skipped" | "failed";

// Process one due row. All failures are contained — the function
// never throws so the outer Promise.all batch never short-circuits.
async function processProvider(providerId: string): Promise<{
  outcome: ProcessOutcome;
  failure?: ActivationFailure;
}> {
  let rpcResult: RpcResult | null = null;
  try {
    const { data, error } = await adminSupabase.rpc(
      "activate_scheduled_plan",
      { p_provider_id: providerId }
    );
    if (error) {
      // RPC plumbing failure (function missing, role lacks EXECUTE,
      // network blip). Audit as a failed activation; the next tick
      // retries the same row.
      console.error(
        "[cron/activate-scheduled-plans] rpc returned error",
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
      "[cron/activate-scheduled-plans] rpc threw",
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

  // RPC returns one of three outcomes. Branch on each.
  const outcome = String(rpcResult.outcome ?? "");
  if (outcome === "skipped") {
    // SELECT FOR UPDATE SKIP LOCKED matched nothing (row not due, or
    // another cron tick holds the lock). Audit and move on; this is a
    // benign concurrency outcome.
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
    // RPC ran but refused to advance (e.g. NO_SCHEDULED_AREAS). The
    // row remains scheduled; admin reconciliation surface lists this
    // via outcome <> 'success' index.
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
    // Unknown outcome string — defensive. Treat as failed.
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
  // The active plan is committed. Run side effects: cache invalidate,
  // push send, audit insert (with push_status). All wrapped in
  // try/catch so any single side-effect failure still records audit.

  const activatedPlanCode = String(rpcResult.activated_plan_code ?? "");
  const regionCount = Number.isFinite(rpcResult.region_count)
    ? Number(rpcResult.region_count)
    : 0;
  const scheduledPaymentOrderId = rpcResult.scheduled_payment_order_id ?? null;
  const periodStart = String(rpcResult.period_start ?? "");

  // Cache invalidation. Resolved city is post-activation (the RPC
  // already replaced provider_areas), so the area_stats key matches
  // the new active set's city.
  let cityCode: string | null = null;
  try {
    cityCode = await resolveProviderCity(providerId);
  } catch (err) {
    console.warn(
      "[cron/activate-scheduled-plans] city resolution threw (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }
  await invalidatePostActivationCaches(cityCode);

  // Push send. Best-effort — failure does NOT roll back activation.
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
    // sendPlanActivatedPush is designed not to throw, but defense in
    // depth — if a future refactor introduces a throw, the audit still
    // records the activation as success with push_status='failed'.
    console.error(
      "[cron/activate-scheduled-plans] sendPlanActivatedPush threw",
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
async function runWithConcurrency(
  providerIds: string[]
): Promise<{
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

async function handle(request: Request): Promise<NextResponse> {
  const authError = await authorize(request);
  if (authError) return authError;

  // Scan for due rows. ORDER BY scheduled_activates_at ASC so the
  // longest-overdue rows go first — bounds the worst-case latency
  // for a single provider's activation when the queue is backed up.
  const { data: dueRows, error: scanError } = await adminSupabase
    .from("provider_plans")
    .select("provider_id, scheduled_plan_code, scheduled_activates_at")
    .not("scheduled_plan_code", "is", null)
    .lte("scheduled_activates_at", new Date().toISOString())
    .order("scheduled_activates_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (scanError) {
    console.error(
      "[cron/activate-scheduled-plans] due-row scan failed",
      scanError
    );
    return NextResponse.json(
      {
        ok: false,
        error: "SCAN_FAILED",
        message: scanError.message,
      },
      { status: 500 }
    );
  }

  const rows = (dueRows ?? []) as DuePlanRow[];
  const providerIds = rows
    .map((r) => String(r.provider_id ?? "").trim())
    .filter((id) => id.length > 0);

  if (providerIds.length === 0) {
    // Empty-workload path — no rows due. Common case in steady state.
    return NextResponse.json({
      ok: true,
      scanned: 0,
      activated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  }

  const { activated, skipped, failed, failures } = await runWithConcurrency(
    providerIds
  );

  return NextResponse.json({
    ok: true,
    scanned: providerIds.length,
    activated,
    skipped,
    failed,
    failures,
  });
}

// Vercel Cron sends GET; manual ops use POST. Both share the same
// handler so the behavior is identical regardless of trigger.
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
