import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/kaam/reprocess
//
// Admin manually re-runs matching + notification for an existing Kaam
// that originally hit `tasks.status = "pending_category_review"`. Used
// after the admin has approved the previously-unknown category in the
// Category tab; the row is otherwise stranded with no providers.
//
// Reuse contract:
//   - Matching + WhatsApp dispatch + provider_task_matches upsert are
//     entirely delegated to /api/process-task-notifications via a
//     server-to-server fetch. We do NOT duplicate that pipeline. See
//     web/app/api/process-task-notifications/route.ts.
//   - That endpoint already does the heavy lifting we need:
//       (a) gates on `categories.active = true` (extra safety net),
//       (b) upserts provider_task_matches with onConflict
//           "task_id,provider_id" — duplicate rows are physically
//           impossible,
//       (c) pre-checks provider_notifications by (provider_id, taskId)
//           before inserting the "job_matched" bell entries — no
//           double-fanout,
//       (d) sets tasks.status = "notified" or "no_providers_matched"
//           based on outcome.
//   - Authentication: the same admin session cookie is forwarded
//     verbatim so the downstream route's owner-or-admin gate sees the
//     real admin caller. No `force=true` is sent — for a task whose
//     status is "pending_category_review" the idempotency guard never
//     trips, so the first reprocess runs the full flow. A subsequent
//     reprocess on an already-notified task short-circuits cleanly via
//     the downstream route's `skipped` response — we surface that to
//     the admin instead of re-spamming providers.
//
// Pre-checks done locally before delegating:
//   1. tasks row exists for the given taskId.
//   2. The task's category is currently active in `categories` (the
//      whole point of letting admin trigger this manually).
// If (2) fails we return reason="category_not_approved" so the UI can
// surface a precise prompt rather than relying on the downstream
// "no_providers_matched" status flip.
//
// No mutations besides what /api/process-task-notifications already
// performs as part of its normal operation.

type TaskRow = {
  task_id: string;
  display_id: string | number | null;
  category: string | null;
  area: string | null;
  status: string | null;
};

type DownstreamPayload = {
  ok?: boolean;
  matchedProviders?: number;
  attemptedSends?: number;
  failedSends?: number;
  matchTier?: string;
  usedFallback?: boolean;
  skipped?: boolean;
  skippedReason?: string;
  error?: string;
};

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { taskId?: unknown };
  try {
    body = (await request.json()) as { taskId?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId is required" },
      { status: 400 }
    );
  }

  // 1. Load the task. We need the category to verify approval, and the
  //    display_id / area to echo back on success.
  const { data: taskRow, error: taskError } = await adminSupabase
    .from("tasks")
    .select("task_id, display_id, category, area, status")
    .eq("task_id", taskId)
    .maybeSingle<TaskRow>();

  if (taskError) {
    console.error("[admin/kaam/reprocess] task load failed:", taskError);
    return NextResponse.json(
      { success: false, error: "Failed to load task" },
      { status: 500 }
    );
  }
  if (!taskRow) {
    return NextResponse.json(
      { success: false, error: "Task not found" },
      { status: 404 }
    );
  }

  const category = String(taskRow.category || "").trim();
  const area = String(taskRow.area || "").trim();

  // 2. Category-approval gate — explicit, so the UI can render the
  //    precise "Category is still not approved" message. .ilike makes
  //    the lookup case-insensitive (the same pattern used by
  //    process-task-notifications' own gate).
  if (!category) {
    return NextResponse.json(
      {
        success: false,
        reason: "category_not_approved",
        message: "Category is still not approved.",
      },
      { status: 409 }
    );
  }

  const { data: categoryRow, error: categoryError } = await adminSupabase
    .from("categories")
    .select("name")
    .ilike("name", category)
    .eq("active", true)
    .maybeSingle();

  if (categoryError) {
    console.error(
      "[admin/kaam/reprocess] category lookup failed:",
      categoryError
    );
    return NextResponse.json(
      { success: false, error: "Failed to verify category approval" },
      { status: 500 }
    );
  }
  if (!categoryRow) {
    return NextResponse.json(
      {
        success: false,
        reason: "category_not_approved",
        message: "Category is still not approved.",
      },
      { status: 409 }
    );
  }

  // 3. Snapshot the existing provider_task_matches BEFORE delegating —
  //    lets us compute skippedExistingCount (rows that were already on
  //    record for this task and therefore re-upserted, not freshly
  //    inserted).
  const { data: existingMatchesBefore } = await adminSupabase
    .from("provider_task_matches")
    .select("provider_id")
    .eq("task_id", taskId);
  const existingProviderIds = new Set(
    (existingMatchesBefore ?? [])
      .map((row) => String(row.provider_id || "").trim())
      .filter(Boolean)
  );

  // 4. Delegate to /api/process-task-notifications. Forward the admin's
  //    session cookies so the downstream route authenticates the same
  //    caller. We construct the URL from the incoming request so this
  //    works under any Next deployment without a hardcoded host.
  const origin = new URL(request.url).origin;
  const downstreamUrl = `${origin}/api/process-task-notifications`;
  const cookieHeader = request.headers.get("cookie") ?? "";

  let downstream: DownstreamPayload;
  let downstreamStatus = 200;
  try {
    const downstreamRes = await fetch(downstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ taskId }),
      cache: "no-store",
    });
    downstreamStatus = downstreamRes.status;
    downstream = (await downstreamRes
      .json()
      .catch(() => ({}))) as DownstreamPayload;
  } catch (err) {
    console.error("[admin/kaam/reprocess] downstream fetch failed:", err);
    return NextResponse.json(
      { success: false, error: "Reprocess pipeline unavailable" },
      { status: 502 }
    );
  }

  if (downstreamStatus >= 400 || downstream.ok === false) {
    console.warn("[admin/kaam/reprocess] downstream returned error:", {
      downstreamStatus,
      downstream,
    });
    return NextResponse.json(
      {
        success: false,
        error: downstream.error || "Reprocess failed",
      },
      { status: downstreamStatus >= 400 ? downstreamStatus : 500 }
    );
  }

  // 5. Read tasks.status back — process-task-notifications writes
  //    "notified" or "no_providers_matched" depending on the matching
  //    outcome. We surface that to the admin so the UI can update the
  //    Status cell without waiting for the next refetch tick.
  const { data: refreshedTask } = await adminSupabase
    .from("tasks")
    .select("status")
    .eq("task_id", taskId)
    .maybeSingle<{ status: string | null }>();

  const finalStatus = strOrNull(refreshedTask?.status ?? taskRow.status);

  // 6. Compute the counts in the shape the UI/spec expects. The
  //    downstream `matchedProviders` is the total matched after the
  //    upsert. Subtracting the pre-existing set gives newly matched.
  //    `attemptedSends - failedSends` is the count actually notified
  //    in this call.
  const matchedCount = Number(downstream.matchedProviders ?? 0);
  const attempted = Number(downstream.attemptedSends ?? 0);
  const failed = Number(downstream.failedSends ?? 0);
  const notifiedCount = Math.max(0, attempted - failed);
  const skippedExistingCount = existingProviderIds.size;

  return NextResponse.json({
    success: true,
    taskId,
    kaamNo:
      taskRow.display_id !== null && taskRow.display_id !== undefined
        ? String(taskRow.display_id)
        : taskId,
    category,
    area,
    matchedCount,
    notifiedCount,
    skippedExistingCount,
    status: finalStatus,
    // Pass through the downstream skip signal so the UI can show
    // "Already processed" vs "Just processed" — read-only diagnostic.
    skipped: Boolean(downstream.skipped),
    skippedReason: strOrNull(downstream.skippedReason),
  });
}
