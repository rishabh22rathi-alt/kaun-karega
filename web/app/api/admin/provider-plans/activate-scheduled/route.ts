import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import { runScheduledPlanActivations } from "@/lib/provider-plans/activateScheduledPlans";

/**
 * Phase 3.2C — Admin-triggered scheduled plan activation.
 *
 * Why this exists: Vercel Hobby caps cron frequency at once per day,
 * which is too coarse for activation timing. Until the team upgrades
 * to Pro, this route is the primary activation surface — an admin
 * clicks "Run activation now" in the dashboard and this endpoint
 * delegates to the same shared runner that the bearer-auth cron at
 * /api/cron/activate-scheduled-plans uses. Activation behaviour is
 * identical regardless of trigger.
 *
 * Auth model:
 *   POST — requireAdminSession (cookie + sessionVersion validation).
 *          Returns 401 UNAUTHORIZED on any failure. No CRON_SECRET
 *          required; admin session is the authority.
 *   GET  — same admin auth. Returns the most recent
 *          scheduled_plan_activations rows for the dashboard audit
 *          panel.
 *
 * Per-row failure isolation, side effects (push, cache invalidation),
 * and audit row writes are all owned by runScheduledPlanActivations()
 * — this route is a thin auth + JSON shell. Keep it that way to
 * preserve the "one activation behaviour, two triggers" property.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECENT_ACTIVATIONS_LIMIT = 20;

type RecentActivationRow = {
  id: number;
  provider_id: string;
  attempted_at: string;
  activated_plan_code: string | null;
  outcome: string;
  scheduled_payment_order_id: string | null;
  region_count: number | null;
  error_code: string | null;
  error_message: string | null;
  push_status: string | null;
};

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: "UNAUTHORIZED",
      message: "Admin session required.",
    },
    { status: 401 }
  );
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return unauthorized();
  }

  // Delegate the entire workload to the shared runner. The runner
  // never throws — top-level errors come back as result.scanError.
  const result = await runScheduledPlanActivations();

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      {
        ok: false,
        error: result.scanError.code,
        message: result.scanError.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    activated: result.activated,
    skipped: result.skipped,
    failed: result.failed,
    failures: result.failures,
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return unauthorized();
  }

  // Surface the most recent scheduled_plan_activations rows so the
  // admin UI can show "what happened the last few times this ran"
  // without a separate endpoint. Inline SELECT mirrors the pattern
  // already used by push-analytics (web/app/api/admin/push-analytics/
  // route.ts) and system-health.
  const { data, error } = await adminSupabase
    .from("scheduled_plan_activations")
    .select(
      "id, provider_id, attempted_at, activated_plan_code, outcome, scheduled_payment_order_id, region_count, error_code, error_message, push_status"
    )
    .order("attempted_at", { ascending: false })
    .limit(RECENT_ACTIVATIONS_LIMIT);

  if (error) {
    console.error(
      "[admin/provider-plans/activate-scheduled] recent rows read failed",
      { code: error.code, message: error.message }
    );
    return NextResponse.json(
      {
        ok: false,
        error: "RECENT_READ_FAILED",
        message: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    recent: (data ?? []) as RecentActivationRow[],
  });
}
