import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { autoCloseExpiredTasks } from "@/lib/admin/adminTaskMutations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Admin-triggered sweep that closes tasks with no progress after
// AUTO_CLOSE_AFTER_DAYS (7) using closeTask(taskId, "system",
// "expired_no_progress"). Not run automatically — invoked explicitly by an
// admin (a future cron is out of scope for this phase).
//
//   POST /api/admin/auto-close-tasks?dryRun=1  → preview eligible candidates,
//                                                closes NOTHING
//   POST /api/admin/auto-close-tasks           → close eligible stale tasks
//
// Response:
//   { ok, dryRun, candidateCount, candidates, closedCount, closedTaskIds }
//   on failure: same shape + { error } (lists may be partial mid-batch)

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const dryRun =
    new URL(request.url).searchParams.get("dryRun") === "1";

  const result = await autoCloseExpiredTasks({ dryRun });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        dryRun: result.dryRun,
        candidateCount: result.candidateCount,
        candidates: result.candidates,
        closedCount: result.closedCount,
        closedTaskIds: result.closedTaskIds,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    dryRun: result.dryRun,
    candidateCount: result.candidateCount,
    candidates: result.candidates,
    closedCount: result.closedCount,
    closedTaskIds: result.closedTaskIds,
  });
}
