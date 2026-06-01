import { NextResponse } from "next/server";

import { runInvoicePdfGeneration } from "@/lib/payments/invoicePdfRunner";

/**
 * Phase 3A — invoice PDF generation, bearer-auth entry point (OPTIONAL).
 *
 * NOT required for production: the primary trigger is the admin button at
 * /api/admin/invoices/pdf. This route only lets an off-platform scheduler
 * drain the queue without code changes. No Vercel cron schedule is added
 * for it (vercel.json is untouched). Both triggers delegate to the same
 * shared runInvoicePdfGeneration() (actor='system' here).
 *
 * Auth: HTTP Bearer using CRON_SECRET (constant-time compare). Mirrors
 * /api/cron/backfill-invoices exactly.
 *   - CRON_SECRET length < 16 → 500 CRON_SECRET_NOT_CONFIGURED.
 *   - Missing / wrong bearer → 401 UNAUTHORIZED.
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

  const result = await runInvoicePdfGeneration({ actor: "system" });

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      { ok: false, error: result.scanError.code, message: result.scanError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: result.enabled,
    rendered: result.rendered,
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
