import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

function normalizeDateOnly(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  return "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawCategoryInput =
      typeof body?.rawCategoryInput === "string" ? body.rawCategoryInput.trim() : "";
    const area = typeof body?.area === "string" ? body.area.trim() : "";
    const selectedTimeframe =
      typeof body?.time === "string"
        ? body.time.trim()
        : typeof body?.urgency === "string"
          ? body.urgency.trim()
          : "";
    const serviceDate =
      typeof body?.serviceDate === "string" ? body.serviceDate.trim() : "";
    const normalizedServiceDate = normalizeDateOnly(serviceDate);
    const timeSlot =
      typeof body?.timeSlot === "string" ? body.timeSlot.trim() : "";
    let details = (body?.details ?? body?.description ?? "").toString().trim();
    if (!details) details = "-";

    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!rawCategoryInput || !area) {
      return NextResponse.json(
        { error: "Required fields missing: Category or Area" },
        { status: 400 }
      );
    }

    // 1. Save the user-visible task with pending_category_review status so it
    //    surfaces in the user's dashboard (my-requests) and admin task views.
    const taskId = `TK-${Date.now()}`;
    const { data: taskData, error: taskError } = await adminSupabase
      .from("tasks")
      .insert({
        task_id: taskId,
        category: rawCategoryInput,
        area,
        details,
        phone: session.phone,
        selected_timeframe: selectedTimeframe,
        service_date: normalizedServiceDate || null,
        time_slot: timeSlot || null,
        status: "pending_category_review",
      })
      .select("display_id")
      .single();

    if (taskError) {
      console.error("[submit-approval-request] task insert failed", taskError.message || taskError);
      return NextResponse.json(
        { error: taskError.message || "Failed to save task" },
        { status: 500 }
      );
    }

    // 2. Queue the category for admin review. Always runs even when the task
    //    insert succeeds; failures here are logged but never block the user
    //    response — the task row is already saved and admin can also see the
    //    request in the tasks dashboard with status=pending_category_review.
    //    Uses adminSupabase (service role) so RLS cannot silently zero-row it.
    const pcrPayload = {
      user_phone: session.phone,
      requested_category: rawCategoryInput,
      area,
      details,
      status: "pending",
      created_at: new Date().toISOString(),
    };

    const { error: pcrError } = await adminSupabase
      .from("pending_category_requests")
      .insert(pcrPayload);

    if (pcrError) {
      // Surface every field of the Supabase error — message/details/hint/code
      // — so a failing constraint or schema mismatch is obvious in logs.
      console.error("PENDING CATEGORY INSERT ERROR:", {
        message: pcrError.message,
        details: pcrError.details,
        hint: pcrError.hint,
        code: pcrError.code,
        payload: pcrPayload,
      });
    } else {
      console.log("PENDING CATEGORY INSERT SUCCESS", {
        requested_category: pcrPayload.requested_category,
      });
    }

    const displayId =
      typeof taskData?.display_id === "string" || typeof taskData?.display_id === "number"
        ? String(taskData.display_id).trim()
        : "";

    return NextResponse.json({ ok: true, taskId, displayId });
  } catch (error: unknown) {
    console.error("[submit-approval-request] route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
