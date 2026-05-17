import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { runOnce, type WorkerOutcome } from "@/lib/announcements/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/admin/announcements/worker/run-now
//
// Admin-cookie-gated manual trigger. Phase 7E (Hobby plan) — Vercel
// Cron runs once per day, so this route exists so admins can process
// queued announcements immediately without waiting for the daily cron
// or running PowerShell against the secret-gated /worker/tick route.
//
// Three sibling worker entrypoints, each with its own auth model and
// purpose:
//
//   /worker/tick     POST + x-kk-internal-secret header
//                    Manual ops fallback. Designed for cron jobs that
//                    can set custom headers OR PowerShell-style
//                    disaster recovery.
//
//   /worker/cron     GET + Authorization: Bearer ${CRON_SECRET}
//                    Vercel Cron entrypoint. Daily on Hobby plan.
//                    No admin session involved.
//
//   /worker/run-now  POST + admin session cookie
//                    Admin UI button. Same runOnce() core; no
//                    headers/secrets required because the admin
//                    session is sufficient proof of authority.
//
// All three delegate to the same runOnce() function, so the worker's
// lease + cursor + push_logs writes + audience hard-block + send_push
// defense-in-depth + ANNOUNCEMENT_SEND_ENABLED gate apply identically
// regardless of trigger. workerId is recorded on the claimed job row
// for audit.
//
// Concurrency: the lease in admin_announcement_jobs prevents two
// triggers from processing the same job simultaneously. An admin
// spam-clicking "Send Queued Now" right after the cron tick will get
// { status: "no_jobs" } because the cron's claim is still active.
//
// One click = one batch. Admin must click again to process the next
// batch when a broadcast spans multiple batches. The UI surfaces the
// outcome (sent / remaining cursor) so the admin knows whether to
// re-click.

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED",
        message: "Admin session required.",
      },
      { status: 401 }
    );
  }

  let outcome: WorkerOutcome;
  try {
    outcome = await runOnce({ workerId: "admin-run-now" });
  } catch (err) {
    console.error("[announcements/worker/run-now] runOnce threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "WORKER_ERROR",
        message: "Worker tick failed.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, outcome });
}
