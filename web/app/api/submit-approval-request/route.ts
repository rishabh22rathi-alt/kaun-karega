import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

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

    const session = await getAuthSession({
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
    // Canonical storage: tasks.phone holds the last 10 digits only — see
    // /api/submit-request for the same normalization rationale.
    const ownerPhone10 = normalizePhone10(session.phone);
    const { data: taskData, error: taskError } = await adminSupabase
      .from("tasks")
      .insert({
        task_id: taskId,
        category: rawCategoryInput,
        area,
        details,
        phone: ownerPhone10,
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

    // Select the inserted row's id so the matching admin_notifications
    // row can carry it as `related_id` for dedupe.
    const { data: pcrInsertData, error: pcrError } = await adminSupabase
      .from("pending_category_requests")
      .insert(pcrPayload)
      .select("id")
      .maybeSingle();

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

      // 3. Admin in-app notification — Phase 1 bell feed. Dedupe is
      //    enforced two ways:
      //      a) explicit pre-existence check on (type, related_id) so
      //         a retry that races doesn't double-insert;
      //      b) the partial unique index added by
      //         supabase/migrations/20260515120000_admin_notifications.sql
      //         (type, related_id) where related_id is not null.
      //    Both are non-fatal on the user response path — the request
      //    is already queued; the notification is best-effort.
      const relatedId =
        (pcrInsertData as { id?: string } | null)?.id ?? taskId;
      if (relatedId) {
        try {
          const { count: existingCount } = await adminSupabase
            .from("admin_notifications")
            .select("id", { count: "exact", head: true })
            .eq("type", "new_category_request")
            .eq("related_id", relatedId);
          if (!existingCount) {
            const { error: notifErr } = await adminSupabase
              .from("admin_notifications")
              .insert({
                type: "new_category_request",
                title: "New service category requested",
                message: `${rawCategoryInput} was requested and needs admin review.`,
                severity: "warning",
                source: "pending_category_requests",
                related_id: relatedId,
                action_url: "/admin/dashboard?tab=category",
              });
            if (notifErr) {
              // Unique-constraint hits land in code 23505 — those mean
              // another request inserted a notification milliseconds
              // ago. Suppress the warn log so the path stays quiet
              // under concurrent retries.
              if (notifErr.code !== "23505") {
                console.warn(
                  "[submit-approval-request] admin_notifications insert failed",
                  notifErr.message
                );
              }
            }
          }
        } catch (notifException) {
          console.warn(
            "[submit-approval-request] admin_notifications path threw",
            notifException instanceof Error
              ? notifException.message
              : notifException
          );
        }
      }
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
