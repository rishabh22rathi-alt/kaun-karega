import { NextResponse } from "next/server";
import { runInvoiceBackfill } from "@/lib/payments/invoiceBackfill";

/**
 * Phase 2.5 — invoice backfill, bearer-auth entry point.
 *
 * Optional automatic recovery. Vercel Hobby has no frequent cron, so the
 * primary surface is the admin button (/api/admin/invoices/backfill);
 * this route exists so an off-platform scheduler (GitHub Actions, an
 * external cron-as-a-service) — or Vercel Cron once on Pro — can drain
 * any backlog without code changes. Both triggers delegate to the same
 * shared runInvoiceBackfill() (actor='system' here).
 *
 * Auth: HTTP Bearer using CRON_SECRET (constant-time compare). Mirrors
 * /api/cron/activate-scheduled-plans exactly.
 *   - CRON_SECRET length < 16 → 500 CRON_SECRET_NOT_CONFIGURED.
 *   - Missing / wrong bearer → 401 UNAUTHORIZED.
 *
 * Feature-flag gating + idempotency + gap-free numbering are owned by the
 * shared worker; this is just the bearer shell. GET and POST both run it.
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

  const result = await runInvoiceBackfill("system");

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      { ok: false, error: result.scanError.code, message: result.scanError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: result.enabled,
    scanned: result.scanned,
    issued: result.issued,
    existed: result.existed,
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
