import { NextResponse } from "next/server";
import { runScheduledPlanActivations } from "@/lib/provider-plans/activateScheduledPlans";

/**
 * Scheduled plan activation worker — bearer-auth entry point.
 *
 * Originally added in Phase 3.2B as a Vercel Cron entry firing every
 * 5 minutes. Vercel Hobby does not support frequent crons, so the
 * frequent-schedule entry in vercel.json was removed; the primary
 * activation surface is now the admin-cookie-gated route at
 * /api/admin/provider-plans/activate-scheduled (Phase 3.2C). This
 * route is kept intact for two future paths:
 *
 *   1. If the team upgrades to Vercel Pro, re-adding the cron entry
 *      to vercel.json brings the worker back to a 5-minute schedule
 *      without any code change.
 *   2. Off-platform schedulers (GitHub Actions, an external cron-as-
 *      a-service, PowerShell on a server) can hit this route any time
 *      with a valid bearer.
 *
 * Auth: HTTP Bearer using CRON_SECRET. Constant-time comparison.
 *   - CRON_SECRET length < 16 → 500 CRON_SECRET_NOT_CONFIGURED.
 *   - Missing / wrong bearer → 401 UNAUTHORIZED.
 *
 * Both GET (Vercel Cron's default) and POST (manual ops) hit the same
 * handler. Activation behaviour is delegated entirely to
 * runScheduledPlanActivations() — see web/lib/provider-plans/
 * activateScheduledPlans.ts. This route is now just the bearer-auth
 * shell.
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

async function handle(request: Request): Promise<NextResponse> {
  const authError = await authorize(request);
  if (authError) return authError;

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
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
