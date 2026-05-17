import { NextResponse } from "next/server";

import { runOnce, type WorkerOutcome } from "@/lib/announcements/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/admin/announcements/worker/tick
//
// One worker tick = at most one batch sent. The route is intentionally
// NOT gated by an admin cookie — it is an internal trigger, called by
// (a) manual operators during Phase 7B soft-launch via the secret
// header, or (b) a future cron in Phase 7D. An admin cookie would be
// the wrong gate because the cron has no session.
//
// Auth: `x-kk-internal-secret` header MUST equal
// process.env.ANNOUNCEMENT_WORKER_SECRET (>= 16 chars). The 503 vs
// 403 distinction below is intentional: 503 says "this surface is
// not configured here"; 403 says "your secret is wrong". This makes
// misconfiguration debuggable without leaking the expected value.
//
// Optional body: { jobId?: string } to target a specific job, useful
// for manual testing. Without it, the worker pulls the oldest
// claimable job.
//
// Returns the worker outcome verbatim so the operator can see batch
// counts and cursor progress per tick.

const HEADER_NAME = "x-kk-internal-secret";

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.ANNOUNCEMENT_WORKER_SECRET ?? "";
  if (expected.length < 16) {
    return NextResponse.json(
      {
        ok: false,
        error: "WORKER_NOT_CONFIGURED",
        message:
          "Announcement worker secret is not configured in this environment.",
      },
      { status: 503 }
    );
  }

  const provided = request.headers.get(HEADER_NAME) ?? "";
  if (!timingSafeEq(provided, expected)) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN", message: "Invalid worker secret." },
      { status: 403 }
    );
  }

  let body: { jobId?: unknown; workerId?: unknown } = {};
  try {
    // Empty body is valid (run oldest job). Only parse when present.
    const text = await request.text();
    if (text.trim().length > 0) {
      body = JSON.parse(text) as typeof body;
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const jobId =
    typeof body.jobId === "string" && body.jobId.trim().length > 0
      ? body.jobId.trim()
      : undefined;
  const workerId =
    typeof body.workerId === "string" && body.workerId.trim().length > 0
      ? body.workerId.trim()
      : undefined;

  let outcome: WorkerOutcome;
  try {
    outcome = await runOnce({ jobId, workerId });
  } catch (err) {
    console.error("[announcements/worker/tick] runOnce threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: "WORKER_ERROR", message: "Worker tick failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, outcome });
}
