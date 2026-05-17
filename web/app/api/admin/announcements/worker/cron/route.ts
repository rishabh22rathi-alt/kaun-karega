import { NextResponse } from "next/server";

import { runOnce, type WorkerOutcome } from "@/lib/announcements/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/announcements/worker/cron
//
// Vercel Cron entrypoint for the announcement worker. Phase 7E adds
// this as a separate surface from the manual /worker/tick POST so
// each auth model has its own narrow route:
//
//   /worker/tick  — POST, `x-kk-internal-secret` header. Manual ops
//                   fallback (PowerShell, curl, disaster recovery).
//   /worker/cron  — GET,  Vercel-managed `Authorization: Bearer
//                   ${CRON_SECRET}`. Production automation.
//
// Vercel Cron sends GET by default and injects the bearer header
// automatically. The route delegates to runOnce() — the same function
// the manual tick uses — so the worker's lease + cursor + push_logs
// integration are identical regardless of trigger.
//
// IMPORTANT — no admin cookie is checked. Cron has no session. The
// only gates are:
//   1. CRON_SECRET env present and >= 16 chars (else 503).
//   2. `Authorization: Bearer ${CRON_SECRET}` header match
//      via timing-safe comparison (else 403).
// Plus all worker-side gates (ANNOUNCEMENT_SEND_ENABLED, audience
// hard-block, send_push defense-in-depth) still apply inside
// runOnce().

const HEADER_NAME = "authorization";

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected.length < 16) {
    // Fail-closed if the secret isn't configured. 503 (not 403) so
    // operators can distinguish "missing config" from "bad bearer".
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_NOT_CONFIGURED",
        message:
          "CRON_SECRET env is not set on this deployment.",
      },
      { status: 503 }
    );
  }

  const provided = request.headers.get(HEADER_NAME) ?? "";
  const expectedHeader = `Bearer ${expected}`;
  if (!timingSafeEq(provided, expectedHeader)) {
    return NextResponse.json(
      {
        ok: false,
        error: "FORBIDDEN",
        message: "Invalid cron credentials.",
      },
      { status: 403 }
    );
  }

  let outcome: WorkerOutcome;
  try {
    // workerId is recorded on the claimed job row's `claimed_by`
    // column for audit. "vercel-cron" distinguishes scheduled
    // invocations from "manual" (PowerShell/curl) and from any
    // future workers.
    outcome = await runOnce({ workerId: "vercel-cron" });
  } catch (err) {
    console.error("[announcements/worker/cron] runOnce threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: "WORKER_ERROR", message: "Cron tick failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, outcome });
}
