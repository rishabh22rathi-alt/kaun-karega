import { NextResponse } from "next/server";
import { runExpiredCoverageReconcile } from "@/lib/provider-plans/reconcileExpiredCoverage";

/**
 * Expired-plan coverage sweep — bearer-auth entry point (Launch Blocker 3).
 *
 * Prunes provider_areas for providers whose paid plan has expired so the
 * matching pipeline (which reads provider_areas directly) stops handing
 * expired providers their old premium coverage. Delegates entirely to the
 * shared runExpiredCoverageReconcile() — see
 * web/lib/provider-plans/reconcileExpiredCoverage.ts.
 *
 * Trigger model mirrors /api/cron/activate-scheduled-plans exactly:
 * Vercel Hobby does not support frequent crons, so no schedule is added to
 * vercel.json. The primary surface is the admin-cookie-gated route at
 * /api/admin/provider-coverage/reconcile-expired. This bearer route exists
 * so an off-platform scheduler (GitHub Actions, cron-as-a-service, a server
 * cron) — or Vercel Cron once on Pro — can drive the sweep without any code
 * change. Both triggers run the same shared worker, so behaviour is
 * identical regardless of trigger.
 *
 * Auth: HTTP Bearer using CRON_SECRET. Constant-time comparison.
 *   - CRON_SECRET length < 16 → 500 CRON_SECRET_NOT_CONFIGURED.
 *   - Missing / wrong bearer → 401 UNAUTHORIZED.
 *
 * Both GET (Vercel Cron's default) and POST (manual ops) hit the same
 * handler.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MIN_SECRET_LENGTH = 16;

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorize(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected.length < MIN_SECRET_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET_NOT_CONFIGURED",
        message: "CRON_SECRET env is not set or is too short on this deployment.",
      },
      { status: 500 }
    );
  }
  const provided = request.headers.get("authorization") ?? "";
  if (!timingSafeEq(provided, `Bearer ${expected}`)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  return null;
}

async function handle(request: Request): Promise<NextResponse> {
  const authError = authorize(request);
  if (authError) return authError;

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

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
