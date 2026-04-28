import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { autoCloseExpiredTasks } from "@/lib/admin/adminTaskMutations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Admin-triggered sweep that closes tasks with no progress after
// AUTO_CLOSE_AFTER_DAYS (currently 3) using closeTask(taskId, "system",
// "expired_no_progress"). Not run automatically on page load — must be
// invoked explicitly by an admin or a future cron job.
//
// Response:
//   { ok: true, closedCount, closedTaskIds }   on success
//   { ok: false, error, closedCount, closedTaskIds }   on failure
//     (closedTaskIds may be partial if the sweep was halted mid-batch)
//
// Usage (curl as a logged-in admin):
//   curl -X POST -H "Cookie: kk_auth_session=…" \
//     http://localhost:3000/api/admin/auto-close-tasks

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const result = await autoCloseExpiredTasks();
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        closedCount: result.closedCount,
        closedTaskIds: result.closedTaskIds,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    closedCount: result.closedCount,
    closedTaskIds: result.closedTaskIds,
  });
}
