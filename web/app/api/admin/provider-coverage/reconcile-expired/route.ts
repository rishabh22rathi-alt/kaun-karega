import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { runExpiredCoverageReconcile } from "@/lib/provider-plans/reconcileExpiredCoverage";

/**
 * Admin-triggered expired-plan coverage sweep (Launch Blocker 3).
 *
 * Why this exists: Vercel Hobby caps cron frequency at once per day, so —
 * exactly as with /api/admin/provider-plans/activate-scheduled — the admin
 * button is the primary trigger. An admin clicks "Reconcile expired
 * coverage" and this endpoint delegates to the same shared runner the
 * bearer-auth cron at /api/cron/reconcile-expired-coverage uses. Behaviour
 * is identical regardless of trigger.
 *
 * Auth:
 *   POST — requireAdminSession (cookie + sessionVersion validation).
 *          Returns 401 on any failure. No CRON_SECRET; the admin session
 *          is the authority.
 *
 * Per-provider failure isolation, snapshot-cache invalidation, and the
 * expired-row scan are all owned by runExpiredCoverageReconcile() — this
 * route is a thin auth + JSON shell. Keep it that way to preserve the
 * "one behaviour, two triggers" property.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
    { status: 401 }
  );
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return unauthorized();
  }

  const result = await runExpiredCoverageReconcile();

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      { ok: false, error: result.scanError.code, message: result.scanError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    reconciled: result.reconciled,
    fixed: result.fixed,
    failed: result.failed,
    failures: result.failures,
  });
}
